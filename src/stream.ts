/**
 * SSE stream assembly — collects the streaming verify events into a single result.
 */

import type { ClaimGroup, SSEEvent, VerifyClaimResponse } from './types.js';

export async function collectStreamEvents(
  stream: AsyncGenerator<SSEEvent>,
): Promise<{ result: VerifyClaimResponse | null; events: SSEEvent[] }> {
  const events: SSEEvent[] = [];
  let finalResult: VerifyClaimResponse | null = null;

  for await (const event of stream) {
    events.push(event);

    // The 'complete' or 'result' event typically contains the final assembled response
    if (event.event === 'complete' || event.event === 'result' || event.event === 'done') {
      if (event.data && typeof event.data === 'object') {
        finalResult = event.data as VerifyClaimResponse;
      }
    }
  }

  // If no explicit final event, try to assemble from accumulated events
  if (!finalResult) {
    const claimGroups: ClaimGroup[] = [];
    let creditUsage: VerifyClaimResponse['credit_usage'] | undefined;
    let threadId = '';

    for (const event of events) {
      const data = event.data as Record<string, unknown>;
      if (!data || typeof data !== 'object') continue;

      if (event.event === 'claim_group' && data) {
        claimGroups.push(data as unknown as ClaimGroup);
      }
      if (event.event === 'credit_usage' && data) {
        creditUsage = data as VerifyClaimResponse['credit_usage'];
      }
      if (data.thread_id) {
        threadId = data.thread_id as string;
      }
      // Some backends send the full result in the last data event
      if (data.claim_groups) {
        finalResult = data as unknown as VerifyClaimResponse;
      }
    }

    if (!finalResult && claimGroups.length > 0) {
      finalResult = {
        claim_groups: claimGroups,
        totalResults: claimGroups.reduce((sum, g) => sum + g.citation_count, 0),
        thread_id: threadId,
        credit_usage: creditUsage,
      };
    }
  }

  return { result: finalResult, events };
}
