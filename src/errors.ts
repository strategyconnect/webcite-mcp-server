import { randomBytes } from 'node:crypto';
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

/**
 * Text that may name a model, a provider, an internal host or a stack frame. The public API and MCP never
 * reveal these, so a backend message that matches is replaced, not shown. Webcite's own public URLs are fine.
 */
const UNSAFE_TEXT = new RegExp([
  String.raw`\b(gpt-?\d|o[134]-|text-embedding|embed-)`, String.raw`\b(open\s?ai|anthropic|claude|chatgpt|gemini|vertex|palm|bard|mistral|mixtral|llama|cohere|groq|deepseek|bedrock|azure|perplexity|grok|qwen|sonnet|opus|haiku|fable|fireworks|together\.ai|replicate|hugging\s?face|voyage|jina|unstructured|llamaparse|reducto|textract|document\s?ai)\b`,
  String.raw`https?:\/\/`, String.raw`\b\d{1,3}(\.\d{1,3}){3}\b`, String.raw`\[?[0-9a-f]{0,4}:[0-9a-f]{0,4}:[0-9a-f:]+\]?`,
  String.raw`\blocalhost\b`, String.raw`\.(internal|local)\b`, String.raw`:\d{2,5}\b`, String.raw`\n\s*at\s`, String.raw`node_modules`,
  String.raw`\b(ECONN\w*|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|stack)\b`,
].join('|'), 'i');
const WEBCITE_URL = /https:\/\/(www\.|api\.)?webcite\.co(\/[^\s)"']*)?/gi;

/** A short id that joins a client-visible error to the full server log line. */
export function errorReference(): string {
  return `mcp_${randomBytes(8).toString('hex')}`;
}

/** The message if it is safe to show and short enough, else undefined. */
export function safeErrorText(message: unknown): string | undefined {
  const text = Array.isArray(message) && message.every((m) => typeof m === 'string') ? message.join('; ') : message;
  if (typeof text !== 'string' || !text.trim() || text.length > 500) return undefined;
  return UNSAFE_TEXT.test(text.replace(WEBCITE_URL, '')) ? undefined : text.trim();
}

/** Only the documented `code` and `message` of a 4xx body; anything else in the body is dropped. */
function clientFields(status: number, body: string): { message?: string; code?: string } {
  if (status >= 500) return {};
  let data: unknown;
  try { data = JSON.parse(body); } catch { return {}; }
  if (!data || typeof data !== 'object') return {};
  const { code, message } = data as { code?: unknown; message?: unknown };
  return {
    message: safeErrorText(message),
    code: typeof code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : undefined,
  };
}

export class ApiClientError extends Error {
  readonly status: number;
  /** The raw API body. Used only to classify the failure and in the server log; never sent to the client. */
  readonly body: string;
  readonly request_id: string;
  readonly error_code?: string;
  readonly credit_usage?: CreditUsage;

  /** `local` marks a message written by this server (safe to show); otherwise `body` came from the API. */
  constructor(status: number, body: string, credit_usage?: CreditUsage, options: { local?: boolean } = {}) {
    const request_id = errorReference();
    const fields = options.local ? { message: body } : clientFields(status, body);
    super(fields.message
      ? `Webcite API error (${status}): ${fields.message}`
      : `Webcite API error (${status}). ${status >= 500 ? 'The service could not complete this request. ' : ''}Reference: ${request_id}.`);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
    this.request_id = request_id;
    this.error_code = fields.code;
    this.credit_usage = credit_usage;
    if (!fields.message) console.error(`Webcite API error ${status} (reference ${request_id}): ${body.slice(0, 2000)}`);
  }

  private publicDetails(): Record<string, unknown> {
    return { status: this.status, request_id: this.request_id, ...(this.error_code ? { error_code: this.error_code } : {}) };
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
        details: { ...this.publicDetails(),
          ...(required ? { required: Number(required[1] ?? required[2]) } : {}),
          ...(remaining ? { remaining: Number(remaining[1] ?? remaining[2]) } : {}) },
        actionable: 'Stop chargeable calls. Give the user all completed results and the unchecked items. An account owner can add credits or enable overage if their plan allows it; resume only the unchecked work with the same idempotency keys for any uncertain retries.',
      });
    }
    if (this.status === 404) {
      return new ToolFailure('not_found', this.message, {
        details: this.publicDetails(),
        actionable: 'Confirm the ID exists and the API key is authorized for it.',
      });
    }
    if (this.status === 401 || this.status === 403) {
      return new ToolFailure('unauthorized', this.message, {
        details: this.publicDetails(),
        actionable: 'Ask the user to reconnect: sign in with OAuth at https://api.webcite.co/mcp, or create an API key at https://webcite.co/api-keys and send it as Authorization: Bearer <key>. A key must belong to this environment. Docs: https://webcite.co/api-docs/mcp. Scope is never taken from MCP annotations.',
      });
    }
    if (this.status === 503 && /integrity/i.test(this.body)) {
      return new ToolFailure('integrity_error', this.message, {
        details: this.publicDetails(),
        actionable: 'Stored content failed integrity checks; do not regenerate from a model.',
      });
    }
    // C3: CONTEXT_GRAPH_RESEARCH default-off — HTTP 400 refuse; never invent a run.
    if (/CONTEXT_GRAPH_RESEARCH is disabled/i.test(this.body)) {
      return new ToolFailure('api_error', this.message, {
        details: {
          ...this.publicDetails(),
          flag: 'CONTEXT_GRAPH_RESEARCH',
          default_off: true,
        },
        actionable:
          'CONTEXT_GRAPH_RESEARCH is default-off; enable only for intentional C3 cutover. Do not invent a research run or checkpoint.',
      });
    }
    return new ToolFailure('api_error', this.message, {
      details: this.publicDetails(),
      actionable: 'Check any saved operation before repeating a chargeable call, and quote the reference if you contact support. For a JSON verification retry, reuse the original Idempotency-Key and identical inputs.',
    });
  }
}
