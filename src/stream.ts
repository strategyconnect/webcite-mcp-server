import { creditUsage, type CreditUsage } from './credit-usage.js';
/** Consume the backend result and explicit terminal marker. Partial evidence is not a result. */
import type { SSEEvent, VerifyClaimResponse } from './types.js';
import { ToolFailure } from './errors.js';
import { validateVerification } from './verification-response.js';

export async function collectStreamEvents(
  stream: AsyncGenerator<SSEEvent>,
): Promise<{ result: VerifyClaimResponse; events: SSEEvent[] }> {
  const events: SSEEvent[] = [];
  let result: VerifyClaimResponse | undefined;
  let done = false;
  let usage: Record<string, unknown> | undefined;
  let receipt: CreditUsage | undefined;
  let streamReceipt: CreditUsage | undefined;
  let resultReceipt: CreditUsage | undefined;
  const currentReceipt = () => streamReceipt ?? resultReceipt ?? receipt;
  const incomplete = (reason: string, creditError = false): ToolFailure =>
    new ToolFailure(creditError ? 'credit_exhausted' : 'partial_result', reason, {
      details: {
        partial_events: events,
        ...(result ? { unconfirmed_result: result } : {}),
        ...(usage ? { stream_usage: usage } : {}),
        ...(currentReceipt() ? { credit_usage: currentReceipt() } : {}),
      },
      actionable: creditError
        ? 'Stop chargeable calls. Give the user completed results and unchecked items. An account owner can add credits or enable overage where available. Preserve partial events; do not repeat uncertain paid work.'
        : 'Keep the partial events and report only completed results. The result is unconfirmed without a done marker. Do not silently repeat a chargeable stream; check the saved operation or use a JSON verify_claim call with a stable idempotency key for the next claim.',
    });
  try {
    for await (const event of stream) {
      events.push(event);
      if (event.credit_usage !== undefined) receipt = creditUsage(event);
      const envelope = event.data && typeof event.data === 'object'
        ? event.data as Record<string, unknown> : undefined;
      const kind = event.event === 'message' ? envelope?.type : event.event;
      if (kind === 'error' || kind === 'accounting_error') {
        const reason = `Verification stream reported ${kind}${envelope?.message ? `: ${envelope.message}` : ''}`;
        const creditError = /insufficient credits|credit.balance.exhausted|INSUFFICIENT_CREDITS/i
          .test(JSON.stringify(envelope ?? {}));
        throw incomplete(reason, creditError);
      }
      if (kind === 'result' || kind === 'complete') {
        result = validateVerification(event.event === 'message' ? envelope?.data : event.data);
        resultReceipt = creditUsage(result);
      }
      if (kind === 'usage' && envelope) {
        streamReceipt = creditUsage(envelope);
        usage = envelope;
      }
      if (kind === 'done') {
        if (!result) throw incomplete('Stream completion arrived before its result');
        done = true;
      }
    }
  } catch (error) {
    if (error instanceof ToolFailure && error.code !== 'invalid_api_output') throw error;
    if (error instanceof ToolFailure) {
      throw new ToolFailure(error.code, error.message, {
        details: { ...error.details, partial_events: events,
          ...(currentReceipt() ? { credit_usage: currentReceipt() } : {}) }, actionable: error.actionable,
      });
    }
    if (!events.length) throw error;
    throw incomplete(`Verification stream disconnected: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  if (!result || !done) throw incomplete('Verification stream ended without a result and completion marker');
  return { result: { ...result, ...(currentReceipt() ? { credit_usage: currentReceipt() } : {}), ...(usage ? { stream_usage: usage,
    ...(typeof usage.operation_id === 'string' && !result.operation_id ? { operation_id: usage.operation_id } : {}) } : {}) }, events };
}
