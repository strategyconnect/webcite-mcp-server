import type { CreditUsage } from './credit-usage.js';
/**
 * Typed failures for MCP tool results (isError:true) vs protocol errors.
 */

import type { ToolFailureCode, ToolFailurePayload } from './types.js';

export class ToolFailure extends Error {
  readonly code: ToolFailureCode;
  readonly details?: Record<string, unknown>;
  readonly actionable?: string;

  constructor(
    code: ToolFailureCode,
    message: string,
    options: { details?: Record<string, unknown>; actionable?: string } = {},
  ) {
    super(message);
    this.name = 'ToolFailure';
    this.code = code;
    this.details = options.details;
    this.actionable = options.actionable;
  }

  toPayload(): ToolFailurePayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
      ...(this.details?.credit_usage ? { credit_usage: this.details.credit_usage as CreditUsage } : {}),
      ...(this.actionable ? { actionable: this.actionable } : {}),
    };
  }
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string, readonly credit_usage?: CreditUsage) {
    super(`WebCite API error (${status}): ${body}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
  }

  toToolFailure(): ToolFailure {
    const failure = this.classifyFailure();
    return this.credit_usage ? new ToolFailure(failure.code, failure.message, {
      details: { ...failure.details, credit_usage: this.credit_usage }, actionable: failure.actionable,
    }) : failure;
  }

  private classifyFailure(): ToolFailure {
    if ((this.status === 400 || this.status === 402 || this.status === 429) && /insufficient credits|credit.balance.exhausted|credit limit exceeded|INSUFFICIENT_CREDITS/i.test(this.body)) {
      const required = /Required:\s*(\d+)|"credits_required"\s*:\s*(\d+)/i.exec(this.body);
      const remaining = /Available:\s*(\d+)|"credits_remaining"\s*:\s*(\d+)/i.exec(this.body);
      return new ToolFailure('credit_exhausted', 'Webcite credits are exhausted for this request.', {
        details: { status: this.status, body: this.body,
          ...(required ? { required: Number(required[1] ?? required[2]) } : {}),
          ...(remaining ? { remaining: Number(remaining[1] ?? remaining[2]) } : {}) },
        actionable: 'Stop chargeable calls. Give the user all completed results and the unchecked items. An account owner can add credits or enable overage if their plan allows it; resume only the unchecked work with the same idempotency keys for any uncertain retries.',
      });
    }
    if (this.status === 404) {
      return new ToolFailure('not_found', this.message, {
        details: { status: this.status, body: this.body },
        actionable: 'Confirm the ID exists and the API key is authorized for it.',
      });
    }
    if (this.status === 401 || this.status === 403) {
      return new ToolFailure('unauthorized', this.message, {
        details: { status: this.status, body: this.body },
        actionable: 'Check that the Webcite API key belongs to this environment. In Claude, choose No sign-in and set Authorization: Bearer <key> in Request headers. Scope is never taken from MCP annotations.',
      });
    }
    if (this.status === 503 && /integrity/i.test(this.body)) {
      return new ToolFailure('integrity_error', this.message, {
        details: { status: this.status, body: this.body },
        actionable: 'Stored content failed integrity checks; do not regenerate from a model.',
      });
    }
    // C3: CONTEXT_GRAPH_RESEARCH default-off — HTTP 400 refuse; never invent a run.
    if (/CONTEXT_GRAPH_RESEARCH is disabled/i.test(this.body)) {
      return new ToolFailure('api_error', this.message, {
        details: {
          status: this.status,
          body: this.body,
          flag: 'CONTEXT_GRAPH_RESEARCH',
          default_off: true,
        },
        actionable:
          'CONTEXT_GRAPH_RESEARCH is default-off; enable only for intentional C3 cutover. Do not invent a research run or checkpoint.',
      });
    }
    return new ToolFailure('api_error', this.message, {
      details: { status: this.status, body: this.body },
      actionable: 'Inspect the API body and any saved operation before repeating a chargeable call. For a JSON verification retry, reuse the original Idempotency-Key and identical inputs.',
    });
  }
}
