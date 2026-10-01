const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { handlers } = require('../dist/handlers.js');
const { validateAnalysisRevision, validateSavedRevision } = require('../dist/analysis-revision.js');
const { ALL_TOOLS } = require('../dist/tools.js');
const { filterToolsByProfile } = require('../dist/profiles.js');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { createMcpServer } = require('../dist/index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const hash = 'a'.repeat(64);
function revision() {
  return { id: createHash('sha256').update(hash + ':process-scope-v1').digest('hex'),
    origin: 'policy_re_evaluation', basis: 'retained_snippets', policy_version: 'process-scope-v1',
    original_result_hash: hash, created_at: '2026-10-01T00:00:00Z',
    assessment_status: 'missing_scope_assessment',
    citations: [{ url: 'https://official.example', snippet: 'A stage takes one week if licensed.',
      stance: 'inconclusive', evidence: { retention: 'hash_only', replayable: false } }],
    claim_result: { verdict: 'unverified', confidence: null, summary: 'Missing comparable scope assessment.',
      supporting_count: 0, contradicting_count: 0 },
    citation_counts: { supports: 0, contradicts: 0, partially_supports: 0, neutral: 1 } };
}
test('public discovery exposes the saved-analysis operation', () => {
  assert.ok(filterToolsByProfile(ALL_TOOLS, 'public').some((tool) => tool.name === 'revise_document_claim_analysis'));
});
test('the normal API client sends the owned route and exact revision body', async (t) => {
  const prior = global.fetch;
  t.after(() => { global.fetch = prior; });
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/api/v1/playground/chat/document-reviews/review/claims/claim/analysis-revisions');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { original_result_hash: hash });
    assert.equal(options.headers['x-api-key'], 'test-only');
    return new Response(JSON.stringify({ review_id: 'review', claim_id: 'claim', analysis_revision: revision() }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await new WebCiteApiClient('test-only', 'https://example.test').reviseDocumentClaimAnalysis('review', 'claim', hash);
  assert.equal(result.analysis_revision.original_result_hash, hash);
});
test('the public MCP transport reaches the equivalent owned operation', async () => {
  let calls = 0;
  const server = createMcpServer({ reviseDocumentClaimAnalysis: async () => {
    calls++; return { review_id: 'review', claim_id: 'claim', analysis_revision: revision() };
  } }, 'public');
  const client = new Client({ name: 'revision-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  try {
    const result = await client.callTool({ name: 'revise_document_claim_analysis', arguments: {
      review_id: 'review', claim_id: 'claim', original_result_hash: hash } });
    assert.equal(result.isError, undefined); assert.equal(calls, 1);
    assert.equal(result.structuredContent.analysis_revision.claim_result.verdict, 'unverified');
  } finally { await client.close(); await server.close(); }
});
test('operation uses exact original identity and reports unknown without new charge', async () => {
  let calls = 0;
  const result = await handlers.revise_document_claim_analysis({ review_id: 'review', claim_id: 'claim', original_result_hash: hash }, {
    reviseDocumentClaimAnalysis: async (...args) => { calls++; assert.deepEqual(args, ['review', 'claim', hash]);
      return { review_id: 'review', claim_id: 'claim', analysis_revision: revision() }; },
  });
  assert.equal(calls, 1); assert.equal(result.structuredContent.analysis_revision.assessment_status, 'missing_scope_assessment');
  assert.match(result.text, /no new research, model calls or credits/);
});
test('invalid identities fail before calling the backend', async () => {
  await assert.rejects(() => handlers.revise_document_claim_analysis({ review_id: ' review ', claim_id: 'claim', original_result_hash: hash }, {}), /exact saved/);
});
test('revision decoder rejects fabricated credits, unknown provenance and inconsistent outcomes', () => {
  for (const mutation of [{ credits_charged: 0 }, { origin: 'analyst_review' }, { basis: 'fresh_research' },
    { original_result_hash: 'b'.repeat(64) }, { citation_counts: { supports: 1, contradicts: 0, partially_supports: 0, neutral: 0 } }]) {
    assert.throws(() => validateAnalysisRevision({ ...revision(), ...mutation }, hash));
  }
});
test('reader preserves original paid result and exact retained evidence', () => {
  const r = revision();
  const claim = { result_state: 'settled', original_result_hash: hash, analysis_revision: r,
    analysis_revisions: [r], result: 'unverified', confidence: null, summary: r.claim_result.summary,
    citations: r.citations, original_analysis: { event: { result: 'contradicted' },
      citations: r.citations.map((source) => ({ ...source, stance: 'contradicts' })) } };
  validateSavedRevision(claim);
  assert.throws(() => validateSavedRevision({ ...claim, original_analysis: undefined }), /history/);
  assert.throws(() => validateSavedRevision({ ...claim, result: 'contradicted' }), /current/);
  assert.throws(() => validateSavedRevision({ ...claim, original_analysis: { ...claim.original_analysis,
    citations: [{ ...r.citations[0], snippet: 'Other evidence' }] } }), /retained/);
});
test('large evidence is saved and explicitly omitted from bounded tool output', async () => {
  const r = revision(); r.citations[0].snippet = 'Retained '.repeat(5000);
  const result = await handlers.revise_document_claim_analysis({ review_id: 'review', claim_id: 'claim', original_result_hash: hash }, {
    reviseDocumentClaimAnalysis: async () => ({ review_id: 'review', claim_id: 'claim', analysis_revision: r }),
  });
  assert.equal(result.structuredContent.citations_omitted, true);
  assert.equal(result.structuredContent.retained_citation_count, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 20_000);
});
