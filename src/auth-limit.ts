import type { IncomingMessage } from 'node:http';

const isLoopback = (address: string) => /^(127\.|::1$|::ffff:127\.)/.test(address);

/**
 * The client address for a request. X-Forwarded-For is trusted only from a loopback peer (nginx on the
 * same host), and the rightmost non-loopback entry is the one nginx appended. A loopback peer with no
 * forwarded address gives undefined: the client is unknown, so it must not share one bucket with everyone.
 */
export function clientIp(req: Pick<IncomingMessage, 'headers'> & { socket?: { remoteAddress?: string } }): string | undefined {
  const peer = req.socket?.remoteAddress ?? '';
  if (!isLoopback(peer)) return peer || undefined;
  const raw = req.headers['x-forwarded-for'];
  const hops = (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map((hop) => hop.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i -= 1) if (!isLoopback(hops[i])) return hops[i];
  return undefined;
}

export type FailedAuthLimitOptions = { limit: number; windowMs: number };
const DEFAULTS: FailedAuthLimitOptions = { limit: 20, windowMs: 60_000 };
const MAX_TRACKED_IPS = 50_000;

/**
 * Limits credential checks per client IP that did not prove a valid credential. Each uncached check takes
 * one unit; a check that answers valid gives it back, so clients with working keys are never limited.
 */
export function createFailedAuthLimit(options: FailedAuthLimitOptions = DEFAULTS) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  const take = (ip: string): { ok: true } | { ok: false; retryAfterS: number } => {
    const now = Date.now();
    const current = windows.get(ip);
    const entry = current && current.resetAt > now ? current : { count: 0, resetAt: now + options.windowMs };
    if (entry.count >= options.limit) return { ok: false, retryAfterS: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    windows.delete(ip);
    if (windows.size >= MAX_TRACKED_IPS) windows.delete(windows.keys().next().value as string);
    windows.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
    return { ok: true };
  };

  const refund = (ip: string): void => {
    const entry = windows.get(ip);
    if (entry && entry.count > 0) windows.set(ip, { ...entry, count: entry.count - 1 });
  };

  return { take, refund };
}
