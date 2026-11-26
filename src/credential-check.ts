import { createHash } from 'node:crypto';

/** Access tokens from Webcite's OAuth server; plain API keys never take this path. */
const OAUTH_TOKEN_PREFIX = 'webcite_oat_';
/** A live credential is trusted this long, so a revocation takes effect within this window. */
export const VALID_CACHE_MS = 60_000;
/** A revoked or invalid answer is remembered this long, also through an API outage. */
export const INVALID_CACHE_MS = 30_000;
/**
 * A request waits at most this long for its credential check. Measured from the PROD and DEV VMs: a live
 * key answers in 30-100 ms; an unknown or deleted key in 0.6-1.9 s (the API guard bcrypt-scans legacy keys).
 */
const CHECK_DEADLINE_MS = 5000;
/** The check itself keeps running this long, so a late answer still fills the cache for the next request. */
const CHECK_TIMEOUT_MS = 30_000;
/** Each side of the cache (valid, invalid) holds at most this many answers; the oldest goes first. */
const MAX_CACHE_ENTRIES = 10_000;
/** Lets the API key its rate limit per credential for MCP traffic (see the API's throttler). */
const SURFACE_HEADER = { 'x-webcite-surface': 'mcp' } as const;

export type CredentialCheck =
  | { status: 'valid' | 'invalid' }
  /** The API could not answer; `reason` never contains the credential. */
  | { status: 'unavailable'; reason: string };

type Answer = { status: 'valid'; until: number } | { status: 'invalid' } | { status: 'unavailable'; reason: string };
type Cached = { status: 'valid' | 'invalid'; until: number };

/** A Map that drops its oldest entry once it holds `max`; re-setting a key makes it the newest. */
function boundedSet(map: Map<string, Cached>, max: number, id: string, value: Cached): void {
  map.delete(id);
  if (map.size >= max) map.delete(map.keys().next().value as string);
  map.set(id, value);
}

/**
 * Is this credential live? OAuth access tokens go to the API's introspection endpoint (live and issued
 * for this MCP endpoint); API keys go to the read-only credit balance route, where the API's auth guard
 * answers 401 for an unknown, revoked or expired key and 5xx when it could not look the key up.
 * Answers are cached under a sha256 of the credential, never the raw value.
 */
export function createCredentialCheck(apiBaseUrl: string, options?: { deadlineMs?: number; maxCacheEntries?: number }) {
  const base = apiBaseUrl.replace(/\/$/, '');
  const audience = `${new URL(apiBaseUrl).origin}/mcp`;
  const deadlineMs = options?.deadlineMs ?? CHECK_DEADLINE_MS;
  const maxEntries = options?.maxCacheEntries ?? MAX_CACHE_ENTRIES;
  // Separate sides: a flood of junk keys can only push out other invalid answers, never a valid one.
  const validCache = new Map<string, Cached>();
  const invalidCache = new Map<string, Cached>();
  /** One check per credential at a time; concurrent requests share it. */
  const inflight = new Map<string, Promise<Answer>>();

  const call = async (path: string, init: RequestInit): Promise<Response | string> => {
    try {
      return await fetch(`${base}${path}`, {
        ...init, headers: { ...(init.headers as Record<string, string>), ...SURFACE_HEADER }, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      return `${path} unreachable (${code ?? (error as Error)?.name ?? 'error'})`;
    }
  };

  const introspect = async (token: string): Promise<Answer> => {
    const res = await call('/api/v1/oauth/introspect', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
    if (typeof res === 'string') return { status: 'unavailable', reason: res };
    if (!res.ok) return { status: 'unavailable', reason: `introspection answered HTTP ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { active?: boolean; aud?: string; exp?: number };
    if (body.active !== true || body.aud !== audience) return { status: 'invalid' };
    return { status: 'valid', until: Math.min(Date.now() + VALID_CACHE_MS, (body.exp ?? 0) * 1000) };
  };

  const checkKey = async (key: string): Promise<Answer> => {
    const res = await call('/api/v1/payment/credits/balance', { method: 'GET', headers: { 'x-api-key': key } });
    if (typeof res === 'string') return { status: 'unavailable', reason: res };
    void res.body?.cancel().catch(() => undefined);
    if (res.status === 401) return { status: 'invalid' };
    if (res.status >= 500 || res.status === 429) return { status: 'unavailable', reason: `key check answered HTTP ${res.status}` };
    // 2xx, 404 (no active subscription) and 403 (app-scoped key) all mean the guard accepted the key.
    return { status: 'valid', until: Date.now() + VALID_CACHE_MS };
  };

  const check = (id: string, credential: string): Promise<Answer> => {
    const running = inflight.get(id);
    if (running) return running;
    const started = (credential.startsWith(OAUTH_TOKEN_PREFIX) ? introspect(credential) : checkKey(credential)).then((answer) => {
      inflight.delete(id);
      if (answer.status === 'unavailable') return answer;
      if (answer.status === 'valid') {
        invalidCache.delete(id);
        boundedSet(validCache, maxEntries, id, answer);
      } else {
        validCache.delete(id);
        boundedSet(invalidCache, maxEntries, id, { status: 'invalid', until: Date.now() + INVALID_CACHE_MS });
      }
      return answer;
    });
    inflight.set(id, started);
    return started;
  };

  const idOf = (credential: string) => createHash('sha256').update(credential).digest('hex');
  const cachedAnswer = (id: string): Cached | undefined => {
    const hit = validCache.get(id) ?? invalidCache.get(id);
    return hit && hit.until > Date.now() ? hit : undefined;
  };

  /**
   * `wait: true` skips the deadline and waits for the check itself (at most CHECK_TIMEOUT_MS): a tool call
   * never runs on an undecided credential, and a slow valid key is not refused (see http-server.ts).
   */
  const checkCredential = async (credential: string, opts?: { wait?: boolean }): Promise<CredentialCheck> => {
    const id = idOf(credential);
    const hit = cachedAnswer(id);
    if (hit) return { status: hit.status };
    if (opts?.wait) {
      const answer = await check(id, credential);
      return answer.status === 'unavailable' ? answer : { status: answer.status };
    }
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<Answer>((resolve) => {
      timer = setTimeout(() => resolve({ status: 'unavailable', reason: `credential check did not answer within ${deadlineMs} ms` }), deadlineMs);
    });
    const answer = await Promise.race([check(id, credential), late]).finally(() => clearTimeout(timer));
    return answer.status === 'unavailable' ? answer : { status: answer.status };
  };
  /** True when a cached answer decides this credential without asking the API. */
  const isCached = (credential: string): boolean => cachedAnswer(idOf(credential)) !== undefined;
  return Object.assign(checkCredential, { isCached });
}
