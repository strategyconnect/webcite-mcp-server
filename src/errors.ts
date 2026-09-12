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
      ...(this.actionable ? { actionable: this.actionable } : {}),
    };
  }
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`WebCite API error (${status}): ${body}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
  }

  toToolFailure(): ToolFailure {
    if (this.status === 404) {
      return new ToolFailure('not_found', this.message, {
        details: { status: this.status, body: this.body },
        actionable: 'Confirm the ID exists and the API key is authorized for it.',
      });
    }
    if (this.status === 401 || this.status === 403) {
      return new ToolFailure('unauthorized', this.message, {
        details: { status: this.status, body: this.body },
        actionable: 'Check WEBCITE_API_KEY and tenant permissions. Scope is never taken from MCP annotations.',
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
      actionable: 'Retry with the same Idempotency-Key if the call was chargeable; inspect the API body.',
    });
  }
}
