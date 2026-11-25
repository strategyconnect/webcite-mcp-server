import { createHash } from 'node:crypto';

/** Access tokens from Webcite's OAuth server; plain API keys never take this path. */
const OAUTH_TOKEN_PREFIX = 'webcite_oat_';
/** A live credential is trusted this long, so a revocation takes effect within this window. */
export const VALID_CACHE_MS = 60_000;
/** A revoked or invalid answer is remembered this long, also through an API outage. */
export const INVALID_CACHE_MS = 30_000;
const CHECK_TIMEOUT_MS = 5000;

export type CredentialCheck =
  | { status: 'valid' | 'invalid' }
  /** The API could not answer; `reason` never contains the credential. */
  | { status: 'unavailable'; reason: string };

type Answer = { status: 'valid'; until: number } | { status: 'invalid' } | { status: 'unavailable'; reason: string };

/**
 * Is this credential live? OAuth access tokens go to the API's introspection endpoint (live and issued
 * for this MCP endpoint); API keys go to the read-only credit balance route, where the API's auth guard
 * answers 401 for an unknown, revoked or expired key and 5xx when it could not look the key up.
 * Answers are cached under a sha256 of the credential, never the raw value.
 */
export function createCredentialCheck(apiBaseUrl: string) {
  const base = apiBaseUrl.replace(/\/$/, '');
  const audience = `${new URL(apiBaseUrl).origin}/mcp`;
  const cache = new Map<string, { status: 'valid' | 'invalid'; until: number }>();

  const call = async (path: string, init: RequestInit): Promise<Response | string> => {
    try {
      return await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
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

  return async (credential: string): Promise<CredentialCheck> => {
    const id = createHash('sha256').update(credential).digest('hex');
    const hit = cache.get(id);
    if (hit && hit.until > Date.now()) return { status: hit.status };
    const answer = await (credential.startsWith(OAUTH_TOKEN_PREFIX) ? introspect(credential) : checkKey(credential));
    if (answer.status === 'unavailable') return answer;
    // ponytail: unbounded only in theory; sweep when the map grows.
    if (cache.size > 10_000) cache.clear();
    cache.set(id, answer.status === 'valid' ? answer : { status: 'invalid', until: Date.now() + INVALID_CACHE_MS });
    return { status: answer.status };
  };
}
