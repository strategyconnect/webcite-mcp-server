import { ToolFailure } from './errors.js';

export interface CreditUsage {
  credits_used: number | null;
  credits_remaining: number | null;
  monthly_allocation?: number | null;
  overage_enabled?: boolean | null;
  operation_id?: string | null;
}

export function creditUsage(value: unknown): CreditUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = (value as Record<string, unknown>).credit_usage;
  if (usage === undefined) return undefined;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage))
    throw new ToolFailure('invalid_api_output', 'Invalid request credit receipt');
  const row = usage as Record<string, unknown>;
  for (const field of ['credits_used', 'credits_remaining', 'monthly_allocation']) {
    const n = row[field];
    if (n !== undefined && n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0))
      throw new ToolFailure('invalid_api_output', 'Invalid request credit receipt');
  }
  if (!Object.hasOwn(row, 'credits_used') || !Object.hasOwn(row, 'credits_remaining') ||
      (row.overage_enabled != null && typeof row.overage_enabled !== 'boolean') ||
      (row.operation_id != null && (typeof row.operation_id !== 'string' || !row.operation_id.trim())))
    throw new ToolFailure('invalid_api_output', 'Incomplete request credit receipt');
  return usage as CreditUsage;
}

export function withCreditHeaders<T>(body: T, headers: Headers | undefined): T {
  if (!body || typeof body !== 'object' || creditUsage(body) || !headers) return body;
  const number = (name: string): number | null => {
    const raw = headers.get(name);
    return raw !== null && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : null;
  };
  if (!['X-Credits-Used', 'X-Credits-Remaining', 'X-Credits-Monthly-Allocation', 'X-Credits-Overage-Enabled'].some(name => headers.has(name))) return body;
  const overage = headers.get('X-Credits-Overage-Enabled');
  const usage: CreditUsage = { credits_used: number('X-Credits-Used'), credits_remaining: number('X-Credits-Remaining'), monthly_allocation: number('X-Credits-Monthly-Allocation'), overage_enabled: overage === 'true' ? true : overage === 'false' ? false : null, operation_id: typeof (body as Record<string, unknown>).operation_id === 'string' ? (body as Record<string, unknown>).operation_id as string : null };
  // Batch HTTP bodies remain arrays; the handler promotes this receipt to its envelope.
  return Object.assign(Array.isArray(body) ? [...body] : { ...body }, { credit_usage: usage }) as T;
}

export function creditUsageText(value: unknown): string {
  const usage = creditUsage(value);
  return usage ? `\nRequest credits used: ${usage.credits_used ?? 'unknown'}; remaining: ${usage.credits_remaining ?? 'unknown'}. This is the current HTTP request receipt, not accumulated review usage.` : '';
}

export function reviewUsageText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const usage = (value as Record<string, unknown>).review_usage;
  if (usage === undefined) return '';
  if (!usage || typeof usage !== 'object' || Array.isArray(usage))
    throw new ToolFailure('invalid_api_output', 'Invalid review operation usage');
  const row = usage as Record<string, unknown>;
  const validTotals = (totals: Record<string, unknown>) =>
    ['settled_credits', 'reserved_credits', 'released_operations', 'reconciliation_operations'].every(field =>
      totals[field] === null || typeof totals[field] === 'number' && Number.isFinite(totals[field]) && (totals[field] as number) >= 0);
  if (row.basis !== 'operation_ledger' || !validTotals(row) ||
      (row.current_attempt !== null && (!row.current_attempt || typeof row.current_attempt !== 'object' || Array.isArray(row.current_attempt) || !validTotals(row.current_attempt as Record<string, unknown>))))
    throw new ToolFailure('invalid_api_output', 'Invalid review operation usage');
  return `\nReview operation-ledger credits settled: ${row.settled_credits ?? 'unknown'}; reserved: ${row.reserved_credits ?? 'unknown'}. These are accumulated review totals, not this read request charge.`;
}
