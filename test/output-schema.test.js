const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require('../dist/index.js');
const { ApiClientError } = require('../dist/api-client.js');
const { TOOL_ERROR_OUTPUT } = require('../dist/output-schemas.js');

// Every default tool's structuredContent is checked against its declared outputSchema twice:
// by the MCP SDK client (which rejects a mismatch, as validating clients do) and by a strict
// Ajv instance. Success fixtures follow the API responses each handler accepts; error results
// must match the error branch and must not validate as a success result.

const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true });
const ASSET = '5b0e6f0e-0c43-4a43-9a52-7f0d2a8a1c11';
const JOB = '3f2b9c1e-7a4d-4e0b-9c55-2d1f0a6b8e42';
const HASH = 'a'.repeat(64);
const receipt = { credits_used: 1, credits_remaining: 99, monthly_allocation: 100, overage_enabled: false, operation_id: 'op-1' };
const citation = { id: 'c1', title: 'Census table', url: 'https://www.census.gov/table.html', snippet: 'Median income was $80,610.',
  stance: 'supports', stance_confidence: null, credibility_score: 0.9, evidence: { version: 1, state: 'quoted' } };
const verification = { claim_groups: [{ claim_id: 'g1', claim_index: 0, claim: 'Median income was $80,610', stance_summary: 'supported',
  citation_count: 1, citations: [citation], verdict: { claim: 'x', result: 'supported', confidence: null, summary: 'Supported.',
    stance_breakdown: { supports: 1, partially_supports: 0, contradicts: 0, neutral: 0 } } }],
  citations: [citation], verdict: null, totalResults: 1, thread_id: 't1', citation_id: 'cit-1', credit_usage: receipt };
const job = (status, extra = {}) => ({ job_id: JOB, status, ...extra });
const reviewPage = (claims, extra = {}) => ({ review_id: 'review-1', status: 'complete', prompt: 'Check all', thread_id: 'thread-1',
  asset_ids: [ASSET], total_claims: claims.length, completed_claims: claims.length, pending_claims: 0, material_claims: claims.length,
  duplicate_claims: 0, claims, uncovered_source_spans: null, rejected_claims: [], nonclaim_dispositions: [], ...extra });
const savedClaim = (i, sources = 1, snippet = 'retained evidence') => ({ id: `claim-${i}`, claim: `Claim ${i} is a factual assertion.`,
  result: 'verified', result_state: 'settled', citation_id: `cit-${i}`, summary: 'Supported.', original_result_hash: HASH,
  citations: Array.from({ length: sources }, (_, j) => ({ url: `https://example.org/source/${i}/${j}/${'p'.repeat(60)}`, snippet })) });
const revision = (() => {
  const { createHash } = require('node:crypto');
  return { id: createHash('sha256').update(`${HASH}:policy-2`).digest('hex'), origin: 'policy_re_evaluation', basis: 'retained_snippets',
    policy_version: 'policy-2', original_result_hash: HASH, created_at: '2026-11-01T00:00:00Z', assessment_status: 'complete',
    claim_result: { verdict: 'verified', confidence: 80, summary: 'Supported by one source.', supporting_count: 1, contradicting_count: 0 },
    citation_counts: { supports: 1, contradicts: 0, partially_supports: 0, neutral: 0 },
    citations: [{ url: 'https://example.org/a', snippet: 'evidence', stance: 'supports' }] };
})();
const representation = { sourceVersionId: 'version-1', representationId: 'rep-1', parserVersion: 'native-text/1',
  units: [{ sourceUnitId: 'unit-1', locator: { kind: 'page', page: 1 }, state: 'complete' }] };
const pdf = Buffer.from('%PDF-1.7\noriginal bytes').toString('base64');
const csv = Buffer.from('Revenue,20\n').toString('base64');

/** name -> [api mock, arguments] for one successful call. */
const SUCCESS = {
  get_credit_balance: [{ getCreditBalance: async () => ({ credits: { remaining: 90, used: 10, total: 100 }, allow_overage: false,
    billing_period_end: '2026-12-01T00:00:00Z', usage_breakdown: { verify: 10 } }) }, {}],
  verify_claim: [{ verifyClaim: async () => verification }, { claim: 'Median income was $80,610' }],
  verify_claim_stream: [{ verifyClaimStream: async function* () {
    yield { event: 'progress', data: { step: 'search' } };
    yield { event: 'result', data: verification };
    yield { event: 'done', data: {} };
  } }, { claim: 'Median income was $80,610' }],
  search_sources: [{ searchSources: async () => ({ citations: null, claim_groups: [{ claim: 'q', citations: [citation] }], totalResults: 1, thread_id: 't' }) }, { query: 'median income' }],
  get_source_preview: [{ sourcePreview: async () => ({ kind: 'web', url: citation.url, deep_link: `${citation.url}#:~:text=Median`,
    binding: { grounded: true, method: 'exact', matched_quote: 'Median income' }, text: 'Median income was $80,610.' }) }, { url: citation.url, quote: 'Median income' }],
  verify_batch: [{ verifyBatch: async () => [
    { id: 'a', quote: 'Revenue was 20', binding: { grounded: true, method: 'exact' }, verification: { layer: 'exact', band: 'high', confidence: 1, grounded: true }, feedback_token: 'tok' },
    { id: 'b', quote: 'Missing', error: 'source unavailable' }] }, { items: [{ quote: 'Revenue was 20', source_text: 'Revenue was 20' }, { quote: 'Missing', url: 'https://example.org' }] }],
  upload_file: [{ uploadBytes: async (bytes, filename) => ({ asset_id: ASSET, source_version_id: 'version-1', filename, size: bytes.length, credit_usage: receipt }) },
    { filename: 'report.pdf', file_base64: pdf }],
  extract_document: [{ extractDocument: async () => ({ format: 'pdf', markdown: '# Report', units: [{ kind: 'page', index: 1, text: '# Report', provenance: { page: 1 } }],
    state: 'complete', complete: true, credit_usage: receipt }) }, { asset_id: ASSET }],
  extract_figures: [{ extractFigures: async () => ({ figures: [{ metric: 'Revenue', value: 20, unit: 'currency', provenance: { assetId: ASSET, documentName: 'r.pdf', method: 'rule' } }], state: 'complete' }) }, { asset_id: ASSET }],
  list_citations: [{ listCitations: async () => ({ data: [{ id: 'cit-1', thread_id: 't', prompt: 'Claim', created_at: '2026-11-01T00:00:00Z' }],
    pagination: { total: 1, page: 1, limit: 10, totalPages: 1 } }) }, {}],
  get_citation: [{ getCitation: async () => ({ data: { id: 'cit-1', thread_id: 't', prompt: 'Claim', citation: JSON.stringify(verification) } }) }, { citation_id: 'cit-1' }],
  analyze_conflicts: [{ analyzeConflicts: async () => ({ conflicts: [], recomputations: [], review: { needs_review: false, reasons: [] } }) },
    { figures: [{ metric: 'Assets', value: 1, unit: 'currency', provenance: { assetId: ASSET, documentName: 'a', method: 'rule' } }] }],
  upload_url: [{ uploadUrl: async () => ({ asset_id: ASSET, source_version_id: 'version-1', asset_url: 'asset://x', filename: 'r.pdf', size: 10 }) },
    { url: 'https://93.184.215.14/report.pdf' }],
  analyze_document: [{ analyzeDocument: async () => ({ figures: [], conflicts: [], recomputations: [], review: { needs_review: true, reasons: ['scan'] } }) }, { asset_id: ASSET }],
  classify_document: [{ classifyDocument: async () => ({ category: 'financials', covers: ['income_statement'], confidence: 0.8 }) }, { asset_id: ASSET }],
  document_gaps: [{ documentGaps: async () => ({ items: [{ name: 'Audited accounts', present: false }] }) }, { category: 'financials' }],
  accuracy_report: [{ accuracyReport: async () => ({ pass: true, totals: { deals: 1, figures: 2, conflicts: { expected: 2, found: 2, flagged: 2, falsePositives: 0, detectionRate: 1, precision: 1 }, recompute: { checked: 1, correct: 1 } } }) }, {}],
  verify_feedback: [{ verifyFeedback: async () => ({ recorded: true }) }, { token: 'tok', verdict: 'correct' }],
  get_document_review: [{ getDocumentReview: async () => reviewPage([savedClaim(0)], { next_offset: null }) }, { review_id: 'review-1' }],
  get_document_review_job: [{ getDocumentReviewJob: async () => job('running', { progress: { completed_claims: 1, total_claims: null }, poll_after_ms: 4000 }) }, { job_id: JOB }],
  review_document: [{ startDocumentReviewJob: async () => job('queued', { max_account_credits: 50 }) },
    { prompt: 'Check every claim', thread_id: 'thread-1', asset_ids: [ASSET], max_account_credits: 50 }],
  get_review_source_span: [{ getDocumentReviewSourceSpan: async () => ({ asset_id: ASSET, start: 0, end: 8, source_quote: 'Contents', role: 'unknown', block_id: null }) },
    { review_id: 'review-1', asset_id: ASSET, start: 0, end: 8 }],
  record_review_nonclaim: [{ recordDocumentReviewNonclaim: async (_id, input) => ({ ...input, reviewer_id: 'user-1', reviewed_at: '2026-11-01T00:00:00Z' }) },
    { review_id: 'review-1', asset_id: ASSET, start: 0, end: 8, source_quote: 'Contents', rationale: 'A table of contents label' }],
  revise_document_claim_analysis: [{ reviseDocumentClaimAnalysis: async () => ({ review_id: 'review-1', claim_id: 'claim-0', analysis_revision: revision }) },
    { review_id: 'review-1', claim_id: 'claim-0', original_result_hash: HASH }],
  // Passthrough tools: shapes follow webcite-backend origin/development (source-version.controller,
  // source-representation.service, ocr-rescue.service, numeric-claim.controller, ask.service, chunk.ts).
  get_latest_representation: [{ getLatestRepresentation: async () => representation }, { source_version_id: 'version-1' }],
  publish_text_representation: [{ publishTextRepresentation: async () => representation }, { source_version_id: 'version-1' }],
  read_source_unit: [{ readSourceUnit: async () => ({ tokenMap: null, sourceVersionId: 'version-1', representationId: 'rep-1', sourceUnitId: 'unit-1',
    assetId: ASSET, identityHash: HASH, unitKey: 'page:1', locator: { kind: 'page', page: 1 }, content: 'Revenue,20', state: 'complete', contentHash: HASH }) },
    { source_version_id: 'version-1', representation_id: 'rep-1', source_unit_id: 'unit-1' }],
  register_source: [{ registerSourceBytes: async (assetId) => ({ sourceVersionId: 'version-2', assetId, bytesHash: HASH, fileName: 'data.csv',
    mediaType: 'text/csv', byteLength: 11, createdAt: '2026-11-01T00:00:00Z', state: 'available', publisherId: null, originFamilyId: null,
    derivedFromVersionIds: [], originAvailableAt: null, originAttestedAt: null, verifiedFinanceContext: null }) },
    { asset_id: ASSET, filename: 'data.csv', file_base64: csv }],
  prepare_ocr_rescue: [{ prepareOcrRescue: async () => ({ attempted: false, code: 'disabled', reason: 'Judged OCR rescue is disabled' }) },
    { source_version_id: 'version-1', representation_id: 'rep-1' }],
  verify_numeric_claim: [{ verifyNumericClaim: async () => ({ outcome: 'supported', reason: 'Values match', scope: 'arithmetic_only',
    limitation: 'Arithmetic only', arithmetic: { verdict: 'holds', computed: 20, tolerance: 0, reason: 'equal' }, comparability: null, claimKey: null,
    operands: [{ figure: { raw: '20', index: 8, value: 20 }, source: { source_version_id: 'version-1', representation_id: 'rep-1', source_unit_id: 'unit-1' },
      binding: 'retained_source_slice', facets: [] }], certificate: { status: 'proved' } }) },
    { claim: 'Revenue was 20', operands: [{ source_version_id: 'version-1', representation_id: 'rep-1', source_unit_id: 'unit-1', figure_index: 0 }] }],
  ask_document: [{ askDocument: async () => ({ id: 'ask-1', operation_id: null, usage: { credits: null }, billing_status: 'pending',
    credit_usage: { ...receipt, credits_used: null } }) }, { question: 'What was revenue?', documentText: 'Revenue was 20.' }],
  get_ask_result: [{ getAskResult: async () => ({ id: 'ask-1', status: 'done', billing: { state: 'settled', credits: 5, operation_id: 'op-1' },
    result: { answer: 20, checks: [{ field: 'answer', drafted: '20', verdict: 'verified' }], evidence: [{ field: 'answer', excerpt: 'Revenue was 20.' }], warnings: [] },
    credit_usage: { ...receipt, credits_used: 0, operation_id: null } }) }, { id: 'ask-1' }],
  extract_pages: [{ extractPages: async () => ({ state: 'complete', reason: null, code: null, chunks: [{ ordinal: 0, text: 'Revenue', page: 1, token_estimate: 2 }],
    operation_id: 'op-1', usage: { credits: 1, pages: 1 }, credit_usage: receipt }) }, { asset_id: ASSET }],
};

async function connect(api) {
  const server = createMcpServer(api, 'public');
  const client = new Client({ name: 'output-schema-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools(); // caches each outputSchema validator in the SDK client
  return { client, tools, close: async () => { await client.close(); await server.close(); } };
}

async function call(api, name, args) {
  const session = await connect(api);
  try {
    const tool = session.tools.find((t) => t.name === name);
    const result = await session.client.callTool({ name, arguments: args }); // throws on a schema mismatch
    return { tool, result };
  } finally { await session.close(); }
}

const successBranch = (tool) => ajv.compile(tool.outputSchema.anyOf[0]);
const errorBranch = ajv.compile(TOOL_ERROR_OUTPUT);

test('every default tool except webcite_guide declares a valid object outputSchema with result and error branches', async () => {
  const session = await connect({});
  try {
    assert.equal(session.tools.length, 34);
    for (const tool of session.tools) {
      if (tool.name === 'webcite_guide') { assert.equal(tool.outputSchema, undefined); continue; }
      assert.equal(tool.outputSchema?.type, 'object', tool.name);
      assert.equal(tool.outputSchema.anyOf.length, 2, tool.name);
      assert.deepEqual(tool.outputSchema.anyOf[1], TOOL_ERROR_OUTPUT, tool.name);
      assert.ok(tool.outputSchema.anyOf[0].required?.length || tool.outputSchema.anyOf[0].anyOf, `${tool.name} result requires a field`);
      ajv.compile(tool.outputSchema);
    }
    assert.deepEqual(Object.keys(SUCCESS).sort(), session.tools.map((t) => t.name).filter((n) => n !== 'webcite_guide').sort());
  } finally { await session.close(); }
});

for (const [name, [api, args]] of Object.entries(SUCCESS)) {
  test(`${name}: success structuredContent conforms to its outputSchema`, async () => {
    const { tool, result } = await call(api, name, args);
    assert.ok(!result.isError, JSON.stringify(result).slice(0, 500));
    assert.ok(result.structuredContent, name);
    assert.ok(result.content[0].text.length > 0, 'text content kept for clients that ignore structuredContent');
    const valid = successBranch(tool);
    assert.ok(valid(result.structuredContent), JSON.stringify(valid.errors));
    assert.equal(errorBranch(result.structuredContent), false, 'a success result must not look like an error');
  });

  test(`${name}: error result matches the error branch and does not claim structured success`, async () => {
    const failing = Object.fromEntries(Object.keys(api).map((method) => [method, method === 'verifyClaimStream'
      ? async function* () { throw new ApiClientError(404, '{"message":"Source not found"}'); }
      : async () => { throw new ApiClientError(404, '{"message":"Source not found"}'); }]));
    const { tool, result } = await call(failing, name, args);
    assert.equal(result.isError, true, name);
    assert.ok(errorBranch(result.structuredContent), JSON.stringify(errorBranch.errors));
    assert.equal(result.structuredContent.code, 'not_found');
    assert.equal(successBranch(tool)(result.structuredContent), false, 'an error must not validate as a success result');
  });
}

test('invalid arguments and unexpected failures also return the error branch', async () => {
  const bad = await call({}, 'get_document_review_job', { job_id: 'not-a-job' });
  assert.equal(bad.result.isError, true);
  assert.equal(bad.result.structuredContent.code, 'invalid_argument');
  const crash = await call({ getCreditBalance: async () => { throw new TypeError('boom'); } }, 'get_credit_balance', {});
  assert.equal(crash.result.isError, true);
  assert.equal(crash.result.structuredContent.code, 'api_error');
  assert.equal(successBranch(crash.tool)(crash.result.structuredContent), false);
});

test('isError results that keep a result shape carry an explicit failure marker', async () => {
  const failedJob = await call({ getDocumentReviewJob: async () => job('failed', { review_id: 'review-1', error: 'parse failed',
    retry_idempotency_key: `review-retry:${JOB}` }) }, 'get_document_review_job', { job_id: JOB });
  assert.equal(failedJob.result.isError, true);
  assert.equal(failedJob.result.structuredContent.status, 'failed');
  assert.equal(failedJob.result.structuredContent.poll_after_ms, 0);
  const failedRead = await call({ extractDocument: async () => ({ format: 'docx', markdown: '', units: [], state: 'error', reason: 'unreadable', code: 'extraction_error' }) },
    'extract_document', { asset_id: ASSET });
  assert.equal(failedRead.result.isError, true);
  assert.equal(failedRead.result.structuredContent.state, 'error');
});

test('get_document_review compact and oversized pages conform', async () => {
  const many = Array.from({ length: 16 }, (_, i) => savedClaim(i, 12, 'retained evidence '.repeat(200)));
  const compact = await call({ getDocumentReview: async () => reviewPage(many, { uncovered_source_spans: [{ asset_id: ASSET, start: 0, end: 8, preview: 'Contents' }],
    uncovered_source_span_count: 1, rejected_claim_count: 0, nonclaim_disposition_count: 0, next_offset: null }) }, 'get_document_review', { review_id: 'review-1' });
  assert.ok(!compact.result.isError);
  assert.equal(compact.result.structuredContent.evidence_details_omitted, true);
  const huge = [savedClaim(0, 400)];
  const oversized = await call({ getDocumentReview: async () => reviewPage(huge, { next_offset: null }) }, 'get_document_review', { review_id: 'review-1' });
  assert.equal(oversized.result.isError, true);
  assert.equal(oversized.result.structuredContent.code, 'response_limit_exceeded');
});

test('positive control: the validators reject a result that breaks its schema', async () => {
  const { tool } = await call(...SUCCESS.get_credit_balance.slice(0, 1), 'get_credit_balance', {});
  const valid = ajv.compile(tool.outputSchema);
  assert.equal(valid({ credits: { remaining: '90', used: 10, total: 100 } }), false);
  assert.equal(valid({ code: 'not_a_code', message: 'x' }), false);
  // The SDK client itself rejects a mismatching structuredContent.
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
  const server = new Server({ name: 'mismatch', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'get_credit_balance', inputSchema: { type: 'object' }, outputSchema: tool.outputSchema }] }));
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'x' }], structuredContent: { credits: { remaining: 'many' } } }));
  const client = new Client({ name: 'mismatch-client', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    await client.listTools();
    await assert.rejects(client.callTool({ name: 'get_credit_balance', arguments: {} }), /does not match the tool's output schema/);
  } finally { await client.close(); await server.close(); }
});
