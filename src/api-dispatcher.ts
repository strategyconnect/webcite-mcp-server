/**
 * HTTP dispatcher for WebCite API requests.
 *
 * Global fetch otherwise uses undici's default 300 s headers/body timeouts, which cut off
 * long verifications before the API finishes. WEBCITE_API_TIMEOUT_MS overrides the limit.
 */

import { Agent } from 'undici';

export const DEFAULT_API_TIMEOUT_MS = 900_000;

export function resolveApiTimeoutMs(raw: string | undefined = process.env.WEBCITE_API_TIMEOUT_MS): number {
  if (raw === undefined) return DEFAULT_API_TIMEOUT_MS;
  const value = Number(raw);
  if (Number.isSafeInteger(value) && value > 0) return value;
  process.stderr.write(
    `WEBCITE_API_TIMEOUT_MS must be a positive integer of milliseconds; using ${DEFAULT_API_TIMEOUT_MS}.\n`,
  );
  return DEFAULT_API_TIMEOUT_MS;
}

const agents = new Map<number, Agent>();

/** Shared dispatcher for the current timeout setting, reused across clients. */
export function apiDispatcher(): Agent {
  const timeoutMs = resolveApiTimeoutMs();
  const existing = agents.get(timeoutMs);
  if (existing) return existing;
  const agent = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
  agents.set(timeoutMs, agent);
  return agent;
}
