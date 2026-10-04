/* ---------------------------------------------------------- product client */

/** The signed product workspace every delegated product read is bound to. */
export interface ProductWorkspace {
  product: 'dd' | 'diligence' | 'marvin_vault';
  workspaceKind: 'user' | 'organization';
  workspaceId: string;
  actorId: string;
}

export interface ProductClientOptions {
  apiKey: string;
  /** Per-product delegation secret (at least 32 characters). Server-side only. */
  delegationSecret: string;
  workspace: ProductWorkspace;
  baseUrl?: string;
}

export interface ProductContextPathNode { kind: string; id: string; objectType?: string }

export interface ProductContextReceiptOptions {
  caseKind: string; caseId: string; contextPath: ProductContextPathNode[]; receiptHash: string;
  usedItemIds?: string[]; requireCurrent?: boolean;
}

export interface ProductContextReceiptResponse {
  receipt: { hash: string; contentHash: string; certification: 'input_evidence_only' };
  inputs: Record<string, unknown>;
  offeredItemIds: string[]; usedItemIds: string[] | null;
  evidence: Omit<ProductComposedEvidence, 'receipt'>;
  freshness: { status: 'current' | 'historical'; reasons: string[] };
  configurationStatus: 'pinned'; applicationPolicyStatus: 'not_assessed';
}

export const PRODUCT_EVIDENCE_INCLUDES = [
  'passages', 'readings', 'findings', 'notes', 'source_diagnostics',
] as const;
export type ProductEvidenceInclude = typeof PRODUCT_EVIDENCE_INCLUDES[number];

/** Opt-in composed evidence block of a product context query. Requires contextPath. */
export interface ProductEvidenceRequest {
  include: ProductEvidenceInclude[];
  maxItems?: number;
  maxChars?: number;
}

export interface ProductContextQueryOptions {
  caseKind: string;
  caseId: string;
  contextPath?: ProductContextPathNode[];
  sourceVersionIds?: string[];
  text?: string;
  memoryOnly?: boolean;
  /** Passed through unchanged; the server validates these producer-owned blocks. */
  automaticExtractionContext?: Record<string, unknown>;
  automaticExtractionSelections?: Record<string, unknown>[];
  sourceFindingsContext?: { request: Record<string, unknown>; read?: Record<string, unknown> };
  evidence?: ProductEvidenceRequest;
  /** Defaults to 1. Always sent, so the signed hash covers the parsed body. */
  maxHops?: 0 | 1 | 2;
  /** Defaults to 10. Always sent, so the signed hash covers the parsed body. */
  limit?: number;
}

export type ProductContextScopeLabel = 'meeting' | 'company';

export interface ProductGraphRef {
  sourceVersionId: string;
  kind: 'passage' | 'number';
  nodeId: string;
  snippet?: string;
  sourceUnitId: string;
  representationId: string;
  locator: Record<string, unknown>;
  contextScope?: ProductContextScopeLabel;
}

/** Meeting-path queries only: the binding scope of each queried source. */
export interface ProductContextScope {
  bindingId: string;
  sourceVersionId: string;
  revisionId: string;
  scope: ProductContextScopeLabel;
  contextPath: ProductContextPathNode[];
}

export type ProductComposedOrigin =
  | 'source_statement' | 'automatic_interpretation' | 'source_reconciliation'
  | 'user_assertion' | 'source_diagnostic';

/** One composed evidence item. Payloads (reading, finding, note, value) are producer-owned. */
export interface ProductComposedItem {
  id: string;
  origin: ProductComposedOrigin;
  ref?: ProductGraphRef & { analysisReceiptId: string; quoteBinding: 'physical_source_only' };
  snippet?: string;
  sourceVersionId?: string;
  analysisReceiptId?: string;
  ledgerManifestHash?: string;
  readingKind?: 'figure' | 'observation';
  readingId?: string;
  reading?: Record<string, unknown>;
  findingId?: string;
  findingsManifestHash?: string;
  corpusHash?: string;
  finding?: Record<string, unknown>;
  noteId?: string;
  revisionId?: string;
  note?: Record<string, unknown>;
  diagnosticKind?: 'automatic_unavailable' | 'automatic_failure';
  value?: Record<string, unknown>;
}

export interface ProductComposedEvidence {
  version: 'product-query-evidence/1';
  include: ProductEvidenceInclude[];
  items: ProductComposedItem[];
  omitted: { origin: ProductComposedOrigin; sourceVersionIds: string[]; count: number;
    sampleItemIds: string[]; reason: 'max_items' | 'max_chars' | 'max_bytes' | 'incomplete_witness_group' }[];
  budgets: { maxItems: number; maxChars: number; maxBytes: number;
    usedItems: number; usedChars: number; usedBytes: number };
  coverage: Record<string, unknown>;
  /** Null until the receipt route (B2) retains it. */
  receipt: { hash: string; contentHash: string; certification: 'input_evidence_only' } | null;
}

export interface ProductUsage {
  operationIds: string[];
  knownCredits: number | null;
  completeness: 'complete' | 'partial' | 'unknown';
}

export interface ProductContextQueryResponse {
  status: 'ok' | 'refuse' | 'memory_only';
  product: ProductWorkspace['product'];
  workspaceKind: ProductWorkspace['workspaceKind'];
  workspaceId: string;
  caseKind: string;
  caseId: string;
  contextPath?: ProductContextPathNode[];
  bindingRevisions?: (string | null)[];
  sourceVersionIds: string[];
  analysisReceipts: Record<string, string>;
  refs: ProductGraphRef[];
  gaps: string[];
  contextScopes?: ProductContextScope[];
  composedEvidence?: ProductComposedEvidence;
  memory: { notes: Record<string, unknown>[]; excludedStale: number; evidenceStatus: 'unverified' };
  operationId: string;
  usage: ProductUsage;
  [key: string]: unknown;
}

export type ProductPreviewSelector =
  | { kind: 'tokens'; representationId: string; first: number; lastExclusive: number }
  | { kind: 'cells'; representationId: string; sheet: string; ranges: string[] }
  | { kind: 'image'; representationId: string; imageId: string; polygon: [number, number][];
    pixelWidth: number; pixelHeight: number; parentTransform: number[]; warpMapId?: string };

export interface ProductSourcePreviewOptions {
  caseKind: string;
  caseId: string;
  sourceVersionId: string;
  analysisReceiptId: string;
  representationId: string;
  sourceUnitId: string;
  /** Required with a tokens selector; not combined with cells or image selectors. */
  quote?: string;
  selector?: ProductPreviewSelector;
  historical?: boolean;
}

export interface ProductTextSpan {
  startUtf16: number; endUtf16: number; startCodePoint: number; endCodePoint: number;
  windowStartCodePoint: number | null; windowEndCodePoint: number | null; excerpt: string;
}
type ProductTargetLocated = {
  status: 'matched' | 'ambiguous' | 'unverified';
  source: 'quote' | 'selector';
  method: 'exact' | 'normalized' | 'fuzzy' | 'reflowed' | 'tokens' | 'cells' | 'image';
  truncated: boolean;
};
type ProductBox = [number, number, number, number];

/** The exact sub-unit target. Present only when the request carried a quote or selector. */
export type ProductPreviewTarget =
  | (ProductTargetLocated & { kind: 'text'; sourceTextStartUtf16?: number;
    frame?: Record<string, unknown>; boxes_unavailable?: string;
    matches: { span: ProductTextSpan; boxes?: ProductBox[] }[] })
  | (ProductTargetLocated & { kind: 'cells'; sheet: string;
    matches: { span: ProductTextSpan | null; ranges: string[]; wholeRows: number[] }[] })
  | (ProductTargetLocated & { kind: 'region'; page: number; frame?: Record<string, unknown>;
    matches: { span: ProductTextSpan | null; boxes: ProductBox[]; polygon?: [number, number][];
      pixelWidth?: number; pixelHeight?: number; polygonSource?: 'caller_supplied' }[] })
  | { kind: 'unmatched'; source: 'quote' | 'selector'; reason: string };

export interface ProductSourcePreviewResponse {
  kind: 'unit';
  product: ProductWorkspace['product'];
  workspaceKind: ProductWorkspace['workspaceKind'];
  workspaceId: string;
  caseKind: string;
  caseId: string;
  sourceVersionId: string;
  analysisReceiptId: string;
  source_version_id: string;
  representation_id: string;
  source_unit_id: string;
  locator: Record<string, unknown>;
  state: string;
  text: string;
  selected: boolean;
  target?: ProductPreviewTarget;
  operationId: string;
  usage: ProductUsage;
  [key: string]: unknown;
}
