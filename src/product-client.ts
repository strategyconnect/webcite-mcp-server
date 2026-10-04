import { createHash, createHmac, randomUUID } from 'node:crypto';
import { creditUsage, withCreditHeaders } from './credit-usage.js';
import { ApiClientError, ToolFailure } from './errors.js';
import type { ProductClientOptions, ProductWorkspace, ProductContextQueryOptions, ProductContextQueryResponse, ProductSourcePreviewOptions, ProductSourcePreviewResponse } from './product-types.js';
import { productCanonicalJson, productContextQueryBody, productSourcePreviewBody, validateProductContextQuery, validateProductSourcePreview, validateProductWorkspace } from './product-validate.js';
import { productContextReceiptBody, validateProductContextReceipt } from './product-validate.js';
import type { ProductContextReceiptOptions, ProductContextReceiptResponse } from './product-types.js';

const productHash = (value: unknown) =>
  createHash('sha256').update(productCanonicalJson(value)).digest('hex');

/**
 * Server-side client for the delegated product routes (/api/v2/integrations/product/sources).
 * Every request is signed for one product workspace, one audience and the exact body hash, and
 * every answer is checked against that workspace, case and request before it is returned.
 * It holds a delegation secret: never ship it to a browser or expose it as a public MCP tool.
 */
export class WebCiteProductClient {
  private readonly apiKey: string;
  private readonly secret: string;
  private readonly workspace: ProductWorkspace;
  private readonly base: string;

  constructor(options: ProductClientOptions) {
    if (!options || typeof options.apiKey !== 'string' || !options.apiKey ||
      typeof options.delegationSecret !== 'string' || options.delegationSecret.length < 32)
      throw new ToolFailure('invalid_argument', 'Product client needs an API key and a delegation secret of at least 32 characters');
    this.apiKey = options.apiKey;
    this.secret = options.delegationSecret;
    this.workspace = validateProductWorkspace(options.workspace);
    const root = (options.baseUrl ?? 'https://api.webcite.co').replace(/\/+$/, '').replace(/\/api(?:\/v\d+)?$/, '');
    this.base = `${root}/api/v2/integrations/product/sources`;
  }

  private token(aud: string, fields: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify({ aud, ...this.workspace, method: 'POST', ...fields,
      expiresAt: Math.floor(Date.now() / 1000) + 30, nonce: randomUUID() })).toString('base64url');
    return `${encoded}.${createHmac('sha256', this.secret).update(encoded).digest('base64url')}`;
  }

  private async post(route: string, aud: string, fields: Record<string, unknown>,
    body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.base}/${route}`, {
      method: 'POST', redirect: 'error', body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey,
        'x-webcite-delegation': this.token(aud, fields) },
    });
    if (!response.ok) throw new ApiClientError(response.status, await response.text(),
      creditUsage(withCreditHeaders({}, response.headers)));
    try { return await response.json(); } catch {
      throw new ApiClientError(response.status, 'API response did not contain valid JSON',
        creditUsage(withCreditHeaders({}, response.headers)));
    }
  }

  /** Product context/query, including the opt-in evidence block (composedEvidence) and contextScopes. */
  async queryContext(options: ProductContextQueryOptions): Promise<ProductContextQueryResponse> {
    const body = productContextQueryBody(options);
    const raw = await this.post('context/query', 'webcite-product-context-query',
      { caseKind: body.caseKind, caseId: body.caseId, queryHash: productHash(body) }, body);
    return validateProductContextQuery(raw, this.workspace, body);
  }

  /** Product source preview. A quote or selector opts in to the exact sub-unit `target`. */
  async previewSource(options: ProductSourcePreviewOptions): Promise<ProductSourcePreviewResponse> {
    const body = productSourcePreviewBody(options);
    const { sourceVersionId } = options;
    const raw = await this.post(`${encodeURIComponent(sourceVersionId)}/preview`,
      'webcite-product-source-preview', { caseKind: body.caseKind, caseId: body.caseId,
        previewHash: productHash({ sourceVersionId, ...body }) }, body);
    return validateProductSourcePreview(raw, this.workspace, options);
  }

  /** Read retained input evidence; never certifies the application's resulting claims. Requires B2. */
  async readContextReceipt(options: ProductContextReceiptOptions): Promise<ProductContextReceiptResponse> {
    const body = productContextReceiptBody(options);
    const raw = await this.post('context/receipt', 'webcite-product-context-receipt',
      { caseKind: body.caseKind, caseId: body.caseId, requestHash: productHash(body) }, body);
    return validateProductContextReceipt(raw, this.workspace, options);
  }
}
