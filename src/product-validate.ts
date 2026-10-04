import { ToolFailure } from './errors.js';
import { PRODUCT_EVIDENCE_INCLUDES } from './product-types.js';
import type { ProductWorkspace, ProductContextQueryOptions, ProductContextQueryResponse, ProductSourcePreviewOptions, ProductSourcePreviewResponse } from './product-types.js';
import type { ProductContextReceiptOptions, ProductContextReceiptResponse } from './product-types.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new ToolFailure('invalid_api_output', `${label} must be an object`, {
      actionable: 'Do not invent a substitute response; retry or report the API contract drift.',
    });
  }
  return value;
}

/* ---------------------------------------------------------- product client */
// Mirrors webcite-backend product-source.controller.ts (context/query, :versionId/preview),
// product-query-evidence.schema.ts and source-preview/preview-target.schema.ts.

const PRODUCT_HASH = /^[a-f0-9]{64}$/;
const PRODUCT_KIND = /^[a-z][a-z0-9_]{0,31}$/;
const isProductId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 191;
const isHash = (v: unknown): v is string => typeof v === 'string' && PRODUCT_HASH.test(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isIdList = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every(isProductId);
const oneOf = (v: unknown, values: readonly string[]) => typeof v === 'string' && values.includes(v);

function productArgument(message: string): never {
  throw new ToolFailure('invalid_argument', `Product request: ${message}`, {
    actionable: 'Fix the request; the server rejects it and its signed hash would not match.',
  });
}

function productOutput(message: string): never {
  throw new ToolFailure('invalid_api_output', `Product response: ${message}`, {
    actionable: 'Reject the response; do not substitute evidence from another route, workspace or case.',
  });
}

/** Canonical JSON (sorted keys, finite numbers only): the input of the server's contentHash. */
export function productCanonicalJson(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (isFiniteNumber(v)) return v;
    if (Array.isArray(v)) return v.map(canonical);
    if (isObject(v) && Object.getPrototypeOf(v) === Object.prototype)
      return Object.fromEntries(Object.keys(v).sort().map((key) => [key, canonical(v[key])]));
    return productArgument('values must be finite JSON (no undefined, NaN or class instances)');
  };
  return JSON.stringify(canonical(value));
}

const sameJson = (a: unknown, b: unknown) => productCanonicalJson(a ?? null) === productCanonicalJson(b ?? null);

function onlyKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length) productArgument(`${label} has unknown fields: ${extra.join(', ')}`);
}

export function validateProductWorkspace(raw: unknown): ProductWorkspace {
  if (!isObject(raw)) return productArgument('workspace is required');
  onlyKeys(raw, ['product', 'workspaceKind', 'workspaceId', 'actorId'], 'workspace');
  const { product, workspaceKind, workspaceId, actorId } = raw;
  if (!oneOf(product, ['dd', 'diligence', 'marvin_vault']) || !oneOf(workspaceKind, ['user', 'organization']) ||
    !isProductId(workspaceId) || !isProductId(actorId))
    productArgument('workspace needs product, workspaceKind, workspaceId and actorId');
  if ((product === 'diligence' && workspaceKind !== 'user') ||
    (workspaceKind === 'user' && actorId !== workspaceId))
    productArgument('a user workspace is the actor; diligence workspaces are user workspaces');
  return { product, workspaceKind, workspaceId, actorId } as ProductWorkspace;
}

function checkContextPath(path: unknown, fail: (message: string) => never): void {
  if (!Array.isArray(path) || path.length < 1 || path.length > 8) fail('contextPath must hold 1 to 8 nodes');
  for (const node of path) {
    if (!isObject(node) || typeof node.kind !== 'string' || !PRODUCT_KIND.test(node.kind) ||
      !isProductId(node.id) || (node.objectType !== undefined &&
        (typeof node.objectType !== 'string' || !PRODUCT_KIND.test(node.objectType))) ||
      Object.keys(node).some((key) => !['kind', 'id', 'objectType'].includes(key)))
      fail('contextPath node must be { kind, id, objectType? }');
  }
  const keys = path.map((n: Record<string, unknown>) => `${n.kind}\u0000${n.objectType ?? ''}\u0000${n.id}`);
  if (new Set(keys).size !== keys.length) fail('contextPath repeats a node');
}

function checkEvidenceRequest(evidence: unknown): void {
  if (!isObject(evidence)) return productArgument('evidence must be an object');
  onlyKeys(evidence, ['include', 'maxItems', 'maxChars'], 'evidence');
  const { include, maxItems, maxChars } = evidence;
  if (!Array.isArray(include) || include.length < 1 || include.length > 5 ||
    new Set(include).size !== include.length || !include.every((v) => oneOf(v, PRODUCT_EVIDENCE_INCLUDES)))
    productArgument(`evidence.include must list 1 to 5 distinct kinds of ${PRODUCT_EVIDENCE_INCLUDES.join(', ')}`);
  if (maxItems !== undefined && !(Number.isInteger(maxItems) && (maxItems as number) >= 1 && (maxItems as number) <= 2000))
    productArgument('evidence.maxItems must be an integer from 1 to 2000');
  if (maxChars !== undefined && !(Number.isInteger(maxChars) && (maxChars as number) >= 1 && (maxChars as number) <= 200_000))
    productArgument('evidence.maxChars must be an integer from 1 to 200000');
}

const QUERY_KEYS = ['caseKind', 'caseId', 'contextPath', 'sourceVersionIds', 'text', 'memoryOnly',
  'automaticExtractionContext', 'automaticExtractionSelections', 'sourceFindingsContext', 'evidence',
  'maxHops', 'limit'] as const;

function checkCase(caseKind: unknown, caseId: unknown): void {
  if (typeof caseKind !== 'string' || !PRODUCT_KIND.test(caseKind) || !isProductId(caseId))
    productArgument('caseKind (lowercase identifier) and caseId are required');
}

function checkQuerySelections(options: ProductContextQueryOptions): void {
  const { automaticExtractionSelections: selections, sourceVersionIds, sourceFindingsContext: findings } = options;
  if (selections !== undefined && (!Array.isArray(selections) || !selections.every(isObject)))
    productArgument('automaticExtractionSelections must be an array of objects');
  if (selections?.length && (options.automaticExtractionContext !== undefined || !sourceVersionIds ||
    !selections.every((s) => sourceVersionIds.includes(s.sourceVersionId as string))))
    productArgument('automaticExtractionSelections need sourceVersionIds covering each selection and no automaticExtractionContext');
  if (findings === undefined) return;
  if (!isObject(findings) || !isObject(findings.request)) productArgument('sourceFindingsContext.request is required');
  if (findings.request.caseKind !== options.caseKind || findings.request.caseId !== options.caseId)
    productArgument('source findings case must match the context query');
  if (options.contextPath && !sameJson(findings.request.contextPath, options.contextPath))
    productArgument('source findings context path must match the context query');
}

/** The exact context/query body. maxHops and limit are explicit so the signed hash covers parsed defaults. */
export function productContextQueryBody(options: ProductContextQueryOptions): Record<string, unknown> {
  if (!isObject(options)) return productArgument('context query options are required');
  onlyKeys(options, QUERY_KEYS, 'context query');
  const { caseKind, caseId, contextPath, sourceVersionIds, text, memoryOnly, evidence } = options;
  checkCase(caseKind, caseId);
  if (contextPath !== undefined) checkContextPath(contextPath, productArgument);
  if (sourceVersionIds !== undefined && (!isIdList(sourceVersionIds, 200) || !sourceVersionIds.length ||
    new Set(sourceVersionIds).size !== sourceVersionIds.length))
    productArgument('sourceVersionIds must hold 1 to 200 distinct ids');
  if (text !== undefined && (typeof text !== 'string' || !text || text !== text.trim() || text.length > 2000))
    productArgument('text must be 1 to 2000 characters without surrounding whitespace');
  if (memoryOnly !== undefined && typeof memoryOnly !== 'boolean') productArgument('memoryOnly must be boolean');
  if (!contextPath && !sourceVersionIds) productArgument('contextPath or sourceVersionIds is required');
  if (memoryOnly !== true && !text) productArgument('text is required unless memoryOnly is true');
  if (evidence !== undefined) checkEvidenceRequest(evidence);
  if (evidence !== undefined && !contextPath) productArgument('evidence requires contextPath');
  checkQuerySelections(options);
  const maxHops = options.maxHops ?? 1;
  const limit = options.limit ?? 10;
  if (maxHops !== 0 && maxHops !== 1 && maxHops !== 2) productArgument('maxHops must be 0, 1 or 2');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) productArgument('limit must be an integer from 1 to 20');
  return Object.fromEntries(Object.entries({ ...options, maxHops, limit }).filter(([, v]) => v !== undefined));
}

function polygonArea(points: number[][]): number {
  return points.reduce((sum, [x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    return sum + x * ny - nx * y;
  }, 0);
}

function checkImageSelector(s: Record<string, unknown>): void {
  const { polygon, pixelWidth: w, pixelHeight: h, parentTransform: t } = s;
  const width = w as number;
  const height = h as number;
  if (!isProductId(s.imageId) || (s.warpMapId !== undefined && !isProductId(s.warpMapId)) ||
    !Number.isInteger(w) || width <= 0 || !Number.isInteger(h) || height <= 0 ||
    !Array.isArray(polygon) || polygon.length < 3 || polygon.length > 1000 ||
    !polygon.every((p) => Array.isArray(p) && p.length === 2 && p.every(isFiniteNumber) &&
      p[0] >= 0 && p[1] >= 0 && p[0] <= width && p[1] <= height) ||
    !Array.isArray(t) || t.length !== 9 || !t.every(isFiniteNumber))
    productArgument('image selector needs imageId, a 3 to 1000 point polygon inside the image and a 9-value transform');
  const [a, b, c, d, e, f, g, hh, i] = t as number[];
  if (polygonArea(polygon as number[][]) === 0 || a * (e * i - f * hh) - b * (d * i - f * g) + c * (d * hh - e * g) === 0)
    productArgument('image selector polygon is degenerate or its transform is singular');
}

function checkPreviewSelector(s: unknown): void {
  if (!isObject(s) || !isProductId(s.representationId)) return productArgument('selector.representationId is required');
  if (s.kind === 'tokens') {
    onlyKeys(s, ['kind', 'representationId', 'first', 'lastExclusive'], 'tokens selector');
    if (!isCount(s.first) || !Number.isInteger(s.lastExclusive) || (s.lastExclusive as number) <= s.first)
      productArgument('tokens selector needs integers 0 <= first < lastExclusive');
  } else if (s.kind === 'cells') {
    onlyKeys(s, ['kind', 'representationId', 'sheet', 'ranges'], 'cells selector');
    if (!isProductId(s.sheet) || !isIdList(s.ranges, 100) || !s.ranges.length)
      productArgument('cells selector needs a sheet and 1 to 100 ranges');
  } else if (s.kind === 'image') {
    onlyKeys(s, ['kind', 'representationId', 'imageId', 'polygon', 'pixelWidth', 'pixelHeight',
      'parentTransform', 'warpMapId'], 'image selector');
    checkImageSelector(s);
  } else productArgument('selector kind must be tokens, cells or image');
}

const PREVIEW_KEYS = ['caseKind', 'caseId', 'sourceVersionId', 'analysisReceiptId', 'representationId',
  'sourceUnitId', 'quote', 'selector', 'historical'] as const;

/** The exact :versionId/preview body; the signed previewHash covers { sourceVersionId, ...body }. */
export function productSourcePreviewBody(options: ProductSourcePreviewOptions): Record<string, unknown> {
  if (!isObject(options)) return productArgument('source preview options are required');
  onlyKeys(options, PREVIEW_KEYS, 'source preview');
  const { sourceVersionId: _route, quote, selector, historical, ...rest } = options;
  checkCase(options.caseKind, options.caseId);
  if (!isProductId(options.sourceVersionId) || !isHash(options.analysisReceiptId) ||
    !isProductId(options.representationId) || !isProductId(options.sourceUnitId))
    productArgument('sourceVersionId, analysisReceiptId (sha256 hex), representationId and sourceUnitId are required');
  if (quote !== undefined && (typeof quote !== 'string' || quote.length > 1000)) productArgument('quote must be at most 1000 characters');
  if (selector !== undefined) checkPreviewSelector(selector);
  if (selector?.kind === 'tokens' ? quote === undefined : quote !== undefined && selector !== undefined)
    productArgument('a tokens selector needs its quote; cells and image selectors take no quote');
  if (historical !== undefined && typeof historical !== 'boolean') productArgument('historical must be boolean');
  return Object.fromEntries(Object.entries({ ...rest, quote, selector, historical })
    .filter(([, v]) => v !== undefined));
}

function checkProductIdentity(root: Record<string, unknown>, workspace: ProductWorkspace,
  caseKind: unknown, caseId: unknown): void {
  if (root.product !== workspace.product || root.workspaceKind !== workspace.workspaceKind ||
    root.workspaceId !== workspace.workspaceId) productOutput('answered for another workspace');
  if (root.caseKind !== caseKind || root.caseId !== caseId) productOutput('answered for another case');
  const usage = root.usage;
  if (!isProductId(root.operationId) || !isObject(usage) || !Array.isArray(usage.operationIds) ||
    !usage.operationIds.includes(root.operationId) ||
    !oneOf(usage.completeness, ['complete', 'partial', 'unknown']) ||
    !(usage.knownCredits === null || (isFiniteNumber(usage.knownCredits) && usage.knownCredits >= 0)))
    productOutput('operationId is not in its usage receipt');
}

function isGraphRef(ref: unknown, sources: Set<string>): ref is Record<string, unknown> {
  return isObject(ref) && typeof ref.sourceVersionId === 'string' && sources.has(ref.sourceVersionId) &&
    oneOf(ref.kind, ['passage', 'number']) && typeof ref.nodeId === 'string' && ref.nodeId.length > 0 &&
    isProductId(ref.sourceUnitId) && isProductId(ref.representationId) && isObject(ref.locator) &&
    (ref.contextScope === undefined || ref.contextScope === null || oneOf(ref.contextScope, ['meeting', 'company']));
}

function checkContextScopes(root: Record<string, unknown>, sources: Set<string>,
  refs: Record<string, unknown>[]): void {
  const scopes = root.contextScopes;
  if (scopes === undefined) {
    if (refs.some((ref) => ref.contextScope !== undefined)) productOutput('refs carry scope labels without contextScopes');
    return;
  }
  if (!Array.isArray(scopes) || scopes.length > 200) productOutput('contextScopes must be an array of at most 200 rows');
  const bySource = new Map<string, unknown>();
  for (const row of scopes) {
    if (!isObject(row) || !isProductId(row.bindingId) || typeof row.sourceVersionId !== 'string' ||
      !sources.has(row.sourceVersionId) || bySource.has(row.sourceVersionId) || !isProductId(row.revisionId) ||
      !oneOf(row.scope, ['meeting', 'company'])) productOutput('contextScopes row is invalid or repeats a source');
    checkContextPath(row.contextPath, productOutput);
    bySource.set(row.sourceVersionId, row.scope);
  }
  if (bySource.size !== sources.size) productOutput('contextScopes must label every queried source');
  if (refs.some((ref) => ref.contextScope !== bySource.get(ref.sourceVersionId as string)))
    productOutput('ref contextScope differs from its source binding scope');
}

const ORIGIN_BY_INCLUDE: Record<string, string> = { passages: 'source_statement',
  readings: 'automatic_interpretation', findings: 'source_reconciliation', notes: 'user_assertion',
  source_diagnostics: 'source_diagnostic' };

function checkComposedItem(item: unknown, origins: Set<string>, sources: Set<string>,
  receipts: Record<string, unknown>): void {
  if (!isObject(item) || !isHash(item.id) || typeof item.origin !== 'string' || !origins.has(item.origin))
    return productOutput('composedEvidence item has an unrequested origin or invalid id');
  const witnessed = typeof item.sourceVersionId === 'string' && sources.has(item.sourceVersionId) &&
    isHash(item.analysisReceiptId) && receipts[item.sourceVersionId] === item.analysisReceiptId &&
    isHash(item.ledgerManifestHash);
  const ref = item.ref;
  const valid = item.origin === 'source_statement'
    ? isGraphRef(ref, sources) && isHash(ref.analysisReceiptId) && receipts[ref.sourceVersionId as string] === ref.analysisReceiptId &&
      ref.quoteBinding === 'physical_source_only' && typeof item.snippet === 'string'
    : item.origin === 'automatic_interpretation'
      ? witnessed && oneOf(item.readingKind, ['figure', 'observation']) && isHash(item.readingId) && isObject(item.reading)
      : item.origin === 'source_reconciliation'
        ? isHash(item.findingId) && isHash(item.findingsManifestHash) && isHash(item.corpusHash) && isObject(item.finding)
        : item.origin === 'user_assertion'
          ? isProductId(item.noteId) && isProductId(item.revisionId) && isObject(item.note) &&
            item.note.noteId === item.noteId && item.note.revisionId === item.revisionId &&
            item.note.evidenceStatus === 'unverified'
          : witnessed && oneOf(item.diagnosticKind, ['automatic_unavailable', 'automatic_failure']) &&
            isObject(item.value) && isProductId(item.value.reason);
  if (!valid) productOutput(`composedEvidence ${item.origin} item is not bound to a queried source receipt`);
}

function checkEvidenceCoverage(coverage: unknown): void {
  const c = isObject(coverage) ? coverage : {};
  const status = (part: unknown, values: string[]) => isObject(part) && oneOf(part.status, values);
  if (!status(c.inventory, ['complete', 'partial', 'not_checked']) ||
    !status(c.retrieval, ['ok', 'refuse', 'memory_only']) ||
    !status(c.ledger, ['not_requested', 'partial', 'available']) ||
    !status(c.findings, ['not_requested', 'unavailable', 'indeterminate', 'partial', 'available']) ||
    !isObject(c.notes) || c.notes.evidenceStatus !== 'unverified' || !isCount(c.coalescedDuplicates))
    productOutput('composedEvidence.coverage is incomplete');
}

function checkComposedEvidence(raw: unknown, request: Record<string, unknown>, sources: Set<string>,
  receipts: Record<string, unknown>): void {
  if (!isObject(raw) || raw.version !== 'product-query-evidence/1') return productOutput('composedEvidence version is not product-query-evidence/1');
  if (!sameJson(raw.include, request.include)) productOutput('composedEvidence.include differs from the request');
  const origins = new Set((request.include as string[]).map((kind) => ORIGIN_BY_INCLUDE[kind]));
  const items = raw.items;
  if (!Array.isArray(items) || items.length > 2000) return productOutput('composedEvidence.items must be an array');
  items.forEach((item) => checkComposedItem(item, origins, sources, receipts));
  if (new Set(items.map((item) => item.id)).size !== items.length) productOutput('composedEvidence repeats an item id');
  const b = isObject(raw.budgets) ? raw.budgets : {};
  if (b.maxItems !== (request.maxItems ?? 100) || b.maxChars !== (request.maxChars ?? 12_000) ||
    b.maxBytes !== 200_000 || b.usedItems !== items.length || !isCount(b.usedChars) ||
    b.usedChars > (b.maxChars as number) || !isCount(b.usedBytes) || b.usedBytes > 200_000)
    productOutput('composedEvidence.budgets do not match the request or the items');
  if (!Array.isArray(raw.omitted) || !raw.omitted.every((row) => isObject(row) &&
    typeof row.origin === 'string' && origins.has(row.origin) && Number.isInteger(row.count) &&
    (row.count as number) >= 1 && isIdList(row.sourceVersionIds, 200) &&
    Array.isArray(row.sampleItemIds) && row.sampleItemIds.every(isHash) &&
    oneOf(row.reason, ['max_items', 'max_chars', 'max_bytes', 'incomplete_witness_group'])))
    productOutput('composedEvidence.omitted is invalid');
  checkEvidenceCoverage(raw.coverage);
  const receipt = raw.receipt;
  if (receipt !== null && !(isObject(receipt) && isHash(receipt.hash) && isHash(receipt.contentHash) &&
    receipt.certification === 'input_evidence_only')) productOutput('composedEvidence.receipt is invalid');
}

/** Validates a product context/query answer against the signed workspace and the exact request body. */
export function validateProductContextQuery(raw: unknown, workspace: ProductWorkspace,
  body: Record<string, unknown>): ProductContextQueryResponse {
  const root = requireObject(raw, 'ProductContextQuery');
  checkProductIdentity(root, workspace, body.caseKind, body.caseId);
  if (!oneOf(root.status, ['ok', 'refuse', 'memory_only'])) productOutput('status must be ok, refuse or memory_only');
  const ids = root.sourceVersionIds;
  if (!isIdList(ids, 200)) return productOutput('sourceVersionIds must be an id array');
  if (body.sourceVersionIds && !sameJson(ids, body.sourceVersionIds)) productOutput('answered for other sources');
  if (body.contextPath && !sameJson(root.contextPath, body.contextPath)) productOutput('answered for another context path');
  const sources = new Set(ids);
  const receipts = root.analysisReceipts;
  if (!isObject(receipts) || !Object.entries(receipts).every(([id, receipt]) => sources.has(id) && isHash(receipt)))
    productOutput('analysisReceipts must map queried sources to receipt hashes');
  const pinned = body.automaticExtractionSelections as { sourceVersionId: string }[] | undefined;
  const requiredReceipts = body.memoryOnly === true && !body.automaticExtractionContext
    ? (pinned ?? []).map(selection => selection.sourceVersionId) : ids;
  if (requiredReceipts.some(id => !isHash(receipts[id])) || sources.size !== ids.length)
    productOutput('analysisReceipts must cover every source actually read');
  const refs = root.refs;
  if (!Array.isArray(refs) || !refs.every((ref) => isGraphRef(ref, sources)))
    return productOutput('refs must anchor queried sources');
  if (!Array.isArray(root.gaps) || !root.gaps.every((gap) => typeof gap === 'string')) productOutput('gaps must be strings');
  if (!isObject(root.memory) || !Array.isArray(root.memory.notes) || root.memory.evidenceStatus !== 'unverified')
    productOutput('memory must hold unverified notes');
  checkContextScopes(root, sources, refs);
  if (body.evidence === undefined && root.composedEvidence !== undefined) productOutput('composedEvidence was not requested');
  if (body.evidence !== undefined)
    checkComposedEvidence(root.composedEvidence, body.evidence as Record<string, unknown>, sources, receipts);
  return root as ProductContextQueryResponse;
}

const isSpan = (v: unknown): boolean => isObject(v) && isCount(v.startUtf16) && isCount(v.endUtf16) &&
  isCount(v.startCodePoint) && isCount(v.endCodePoint) && v.endUtf16 >= v.startUtf16 &&
  v.endCodePoint >= v.startCodePoint && (v.windowStartCodePoint === null || isCount(v.windowStartCodePoint)) &&
  (v.windowEndCodePoint === null || isCount(v.windowEndCodePoint)) && typeof v.excerpt === 'string';
const isBoxes = (v: unknown): boolean => Array.isArray(v) && v.length > 0 &&
  v.every((box) => Array.isArray(box) && box.length === 4 && box.every(isFiniteNumber));
const isPositive = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
const TARGET_MATCH: Record<string, (m: Record<string, unknown>) => boolean> = {
  text: (m) => isSpan(m.span) && (m.boxes === undefined || isBoxes(m.boxes)),
  cells: (m) => (m.span === null || isSpan(m.span)) && Array.isArray(m.ranges) && m.ranges.length > 0 &&
    m.ranges.every((r) => typeof r === 'string' && r.length > 0) &&
    Array.isArray(m.wholeRows) && m.wholeRows.every(isPositive),
  region: (m) => (m.span === null || isSpan(m.span)) && isBoxes(m.boxes) &&
    (m.polygon === undefined || (Array.isArray(m.polygon) && m.polygon.every((p) =>
      Array.isArray(p) && p.length === 2 && p.every(isFiniteNumber)))) &&
    (m.pixelWidth === undefined || isPositive(m.pixelWidth)) &&
    (m.pixelHeight === undefined || isPositive(m.pixelHeight)) &&
    (m.polygonSource === undefined || m.polygonSource === 'caller_supplied'),
};
const UNMATCHED = ['not_found', 'non_contiguous', 'unit_unreadable', 'normalization_unmappable',
  'selector_unverified', 'target_unavailable', 'no_stored_cells', 'selector_outside_unit'];
const BOXES_UNAVAILABLE = ['encrypted', 'unreadable_pdf', 'too_large', 'timeout', 'page_unavailable',
  'no_text_layer', 'not_aligned', 'original_unavailable', 'busy'];

function checkPreviewTarget(t: unknown, options: ProductSourcePreviewOptions): void {
  if (!isObject(t)) return productOutput('target must be an object');
  const source = options.selector === undefined ? 'quote' : options.quote === undefined ? 'selector' : null;
  if (!oneOf(t.source, ['quote', 'selector']) || (source !== null && t.source !== source))
    productOutput('target source differs from the request');
  if (t.kind === 'unmatched') {
    if (!oneOf(t.reason, UNMATCHED)) productOutput('unmatched target reason is unknown');
    return;
  }
  const matches = TARGET_MATCH[t.kind as string];
  if (!matches) return productOutput('target kind must be text, cells, region or unmatched');
  const kindValid = t.kind === 'text'
    ? (t.sourceTextStartUtf16 === undefined || isCount(t.sourceTextStartUtf16)) &&
      (t.frame === undefined || isObject(t.frame)) &&
      (t.boxes_unavailable === undefined || oneOf(t.boxes_unavailable, BOXES_UNAVAILABLE))
    : t.kind === 'cells' ? typeof t.sheet === 'string' && t.sheet.length > 0
      : isPositive(t.page) && (t.frame === undefined || isObject(t.frame));
  if (!kindValid || !oneOf(t.status, ['matched', 'ambiguous', 'unverified']) ||
    !oneOf(t.method, ['exact', 'normalized', 'fuzzy', 'reflowed', 'tokens', 'cells', 'image']) ||
    typeof t.truncated !== 'boolean' || !Array.isArray(t.matches) || !t.matches.length ||
    !t.matches.every((m) => isObject(m) && matches(m)))
    productOutput(`${t.kind} target is invalid`);
}

/** Validates a product preview against the signed workspace and the exact source unit requested. */
export function validateProductSourcePreview(raw: unknown, workspace: ProductWorkspace,
  options: ProductSourcePreviewOptions): ProductSourcePreviewResponse {
  const root = requireObject(raw, 'ProductSourcePreview');
  checkProductIdentity(root, workspace, options.caseKind, options.caseId);
  if (root.kind !== 'unit' || root.sourceVersionId !== options.sourceVersionId ||
    root.source_version_id !== options.sourceVersionId || root.analysisReceiptId !== options.analysisReceiptId ||
    root.representation_id !== options.representationId || root.source_unit_id !== options.sourceUnitId)
    productOutput('answered for another source unit');
  if (typeof root.selected !== 'boolean' || typeof root.text !== 'string' ||
    typeof root.state !== 'string' || !isObject(root.locator)) productOutput('unit preview is incomplete');
  if (!options.historical && !root.selected) productOutput('source analysis is no longer selected');
  if (root.target !== undefined) {
    if (options.quote === undefined && options.selector === undefined) productOutput('target was not requested');
    checkPreviewTarget(root.target, options);
  }
  return root as ProductSourcePreviewResponse;
}

/** Receipt reads have no defaults: their signed hash covers only the supplied keys. */
export function productContextReceiptBody(options: ProductContextReceiptOptions): Record<string, unknown> {
  if (!isObject(options)) return productArgument('receipt options are required');
  onlyKeys(options, ['caseKind', 'caseId', 'contextPath', 'receiptHash', 'usedItemIds', 'requireCurrent'], 'receipt');
  checkCase(options.caseKind, options.caseId);
  checkContextPath(options.contextPath, productArgument);
  if (!isHash(options.receiptHash)) productArgument('receiptHash must be a SHA-256 hash');
  const ids = options.usedItemIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length < 1 || ids.length > 2000 ||
    !ids.every(isHash) || new Set(ids).size !== ids.length)) productArgument('usedItemIds must hold 1 to 2000 distinct hashes');
  if (options.requireCurrent !== undefined && typeof options.requireCurrent !== 'boolean')
    productArgument('requireCurrent must be boolean');
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
}

export function validateProductContextReceipt(raw: unknown, workspace: ProductWorkspace,
  options: ProductContextReceiptOptions): ProductContextReceiptResponse {
  const root = requireObject(raw, 'ProductContextReceipt');
  const receipt = requireObject(root.receipt, 'receipt');
  const inputs = requireObject(root.inputs, 'inputs');
  const identity = requireObject(inputs.identity, 'identity');
  if (receipt.hash !== options.receiptHash || !isHash(receipt.contentHash) || receipt.certification !== 'input_evidence_only' ||
    inputs.certification !== 'input_evidence_only' || identity.product !== workspace.product ||
    identity.workspaceKind !== workspace.workspaceKind || identity.workspaceId !== workspace.workspaceId ||
    identity.caseKind !== options.caseKind || identity.caseId !== options.caseId ||
    !sameJson(identity.contextPath, options.contextPath)) productOutput('receipt identity differs from the request');
  const offered = root.offeredItemIds;
  if (!Array.isArray(offered) || offered.length > 2000 || !offered.every(isHash) || new Set(offered).size !== offered.length ||
    !sameJson(root.usedItemIds, options.usedItemIds ?? null) || options.usedItemIds?.some(id => !offered.includes(id)))
    productOutput('receipt offered or used item identities are invalid');
  const evidence = requireObject(root.evidence, 'evidence');
  const items = evidence.items;
  const expected = new Set(options.usedItemIds ?? offered);
  if (!Array.isArray(items) || items.length !== expected.size || items.some(item => !isObject(item) || !expected.has(item.id as string)))
    productOutput('receipt evidence differs from the offered or used items');
  if (!Array.isArray(inputs.sources) || inputs.sources.length > 200 || !inputs.sources.every(row => isObject(row) &&
    isProductId(row.sourceVersionId) && ((isHash(row.analysisReceiptId) && isHash(row.analysisGraphHash)) ||
      (row.analysisReceiptId === null && row.analysisGraphHash === null)))) productOutput('receipt sources are invalid');
  const rows = inputs.sources as { sourceVersionId: string; analysisReceiptId: string | null }[];
  const receiptBySource = new Map(rows.map(row => [row.sourceVersionId, row.analysisReceiptId]));
  for (const item of items) {
    if (item.origin !== 'source_reconciliation') continue;
    const occurrences = isObject(item.finding) ? item.finding.occurrences : undefined;
    if (!Array.isArray(occurrences) || occurrences.length < 2 || occurrences.some(occurrence =>
      !isObject(occurrence) || !isObject(occurrence.anchor) || !isHash(occurrence.anchor.analysisReceiptId) ||
      receiptBySource.get(String(occurrence.anchor.sourceVersionId)) !== occurrence.anchor.analysisReceiptId))
      productOutput('receipt finding has no analyzed source custody');
  }
  const budgets = requireObject(evidence.budgets, 'budgets');
  if (budgets.usedItems !== offered.length || !isCount(budgets.maxItems) || budgets.maxItems < 1 || budgets.maxItems > 2000 ||
    !Array.isArray(evidence.include) || !evidence.include.length || evidence.include.length > 5 ||
    !evidence.include.every(kind => oneOf(kind, PRODUCT_EVIDENCE_INCLUDES)) ||
    new Set(evidence.include).size !== evidence.include.length || new Set(rows.map(row => row.sourceVersionId)).size !== rows.length)
    productOutput('receipt offered evidence budget or origin selection is invalid');
  // The producer retains offered budgets when the caller selects a subset of its items.
  checkComposedEvidence({ ...evidence, receipt: null, budgets: { ...budgets, usedItems: items.length } },
    { include: evidence.include, maxItems: budgets.maxItems, maxChars: budgets.maxChars },
    new Set(rows.map(row => row.sourceVersionId)), Object.fromEntries(rows.filter(row => row.analysisReceiptId !== null)
      .map(row => [row.sourceVersionId, row.analysisReceiptId])));
  const freshness = requireObject(root.freshness, 'freshness');
  if (!oneOf(freshness.status, ['current', 'historical']) || !Array.isArray(freshness.reasons) ||
    !freshness.reasons.every(reason => typeof reason === 'string') ||
    (freshness.status === 'current') !== (freshness.reasons.length === 0) ||
    (options.requireCurrent !== false && freshness.status !== 'current') ||
    root.configurationStatus !== 'pinned' || root.applicationPolicyStatus !== 'not_assessed')
    productOutput('receipt freshness or certification is invalid');
  return root as unknown as ProductContextReceiptResponse;
}
