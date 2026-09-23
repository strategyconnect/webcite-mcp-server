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
  for await (const event of stream) {
    events.push(event);
    const envelope = event.data && typeof event.data === 'object'
      ? event.data as Record<string, unknown> : undefined;
    const kind = event.event === 'message' ? envelope?.type : event.event;
    if (kind === 'error' || kind === 'accounting_error') {
      throw new ToolFailure('partial_result', `Verification stream reported ${kind}`, {
        details: { message: envelope?.message },
      });
    }
    if (kind === 'result' || kind === 'complete') {
      result = validateVerification(event.event === 'message' ? envelope?.data : event.data);
    }
    if (kind === 'usage' && envelope) usage = envelope;
    if (kind === 'done') {
      if (!result) throw new ToolFailure('partial_result', 'Stream completion arrived before its result');
      done = true;
    }
  }
  if (!result || !done) throw new ToolFailure('partial_result', 'Verification stream ended without a result and completion marker');
  return { result: { ...result, ...(usage ? { stream_usage: usage,
    ...(typeof usage.operation_id === 'string' && !result.operation_id ? { operation_id: usage.operation_id } : {}) } : {}) }, events };
}
