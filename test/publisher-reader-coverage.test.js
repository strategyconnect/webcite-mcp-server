const test = require('node:test');
const assert = require('node:assert/strict');
const { handlers } = require('../dist/handlers.js');
const { formatCitation, formatVerifyResult } = require('../dist/formatters.js');
const { citationReaderCoverage } = require('../dist/publisher-reader-coverage.js');
const { renderWebciteGuide } = require('../dist/guide.js');
const retained = require('./fixtures/retained-publisher-reader-partial.json');

const read = (citations, large = false) => handlers.get_document_review({ review_id: 'reader-review' }, {
  getDocumentReview: async () => ({ review_id: 'reader-review', status: 'complete',
    prompt: 'Review the supplied figures', thread_id: 'reader-test', asset_ids: ['source'],
    total_claims: 1, completed_claims: 1, pending_claims: 0, coverage_complete: true,
    claims: [{ id: 'retained', claim: retained.claim, result: retained.result,
      confidence: null, citations: citations.map(citation => ({ ...citation,
        snippet: large ? 'retained source text '.repeat(2000) : citation.snippet })) }],
  }),
});

for (const compact of [false, true]) test(`retained partial publisher stays visible with complete input coverage, compact=${compact}`, async () => {
  const output = await read([retained.citation], compact);
  assert.match(output.text, /Input source coverage: complete/);
  assert.match(output.text, /Publisher reader coverage: partial/);
  assert.match(output.text, /page_limit/);
  assert.match(output.text, /\[verified\]/);
  assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 20_000);
  if (compact) {
    const qualifier = output.structuredContent.claims[0].citation_reader_coverage[0];
    assert.equal(qualifier.coverage, 'partial');
    assert.equal(qualifier.citation_index, 1);
    assert.ok(qualifier.omitted_limitation_count > 0);
  } else assert.equal(output.structuredContent.claims[0].citations[0].evidence.readerCoverage, 'partial');
});

test('legacy and missing publisher metadata remains unknown in mixed compact results', async () => {
  const sources = [retained.citation, { id: 'legacy', url: 'https://example.org/legacy' },
    { id: 'missing', url: 'https://example.org/missing', evidence: { version: 1, state: 'matched' } }];
  const output = await read(sources, true);
  assert.match(output.text, /Publisher reader coverage: partial/);
  assert.match(output.text, /2 unknown/);
  assert.deepEqual(output.structuredContent.claims[0].citation_reader_coverage.map(row => row.coverage), ['partial', 'unknown', 'unknown']);
  assert.doesNotMatch(output.text, /Publisher reader coverage: complete/);
});

test('unknown-only and absent citations never become complete publisher reads', async () => {
  for (const sources of [[], [{ url: 'https://example.org/source' }],
    [{ url: 'https://example.org/source', evidence: { readerCoverage: 'complete' } }]]) {
    const output = await read(sources);
    assert.match(output.text, /Publisher reader coverage: unknown/);
    assert.doesNotMatch(output.text, /Publisher reader coverage: complete/);
  }
});

test('live citation rendering preserves partial coverage and unknown confidence separately', () => {
  const text = formatCitation({ ...retained.citation, stance_confidence: null,
    stance_confidence_basis: 'unknown' }, 0);
  assert.match(text, /Publisher reader coverage: partial/);
  assert.match(text, /confidence unknown/);
  assert.match(text, /page_limit/);
});

test('actual two-source verification renderer attributes partial warnings to the second citation', () => {
  const text = formatVerifyResult(retained.claim, { citations: [
    { id: 'legacy', title: 'Legacy source', url: 'https://example.org/legacy', snippet: 'Legacy excerpt' },
    retained.citation,
  ] });
  assert.match(text, /Publisher reader coverage: unknown/);
  assert.match(text, /citation 2: page 1: embedded_raster_unread/);
  assert.match(text, /citation 2: page 23: page_limit/);
  assert.doesNotMatch(text, /citation 1: page/);
});

test('compact URL and qualifier producers share explicit-empty and top-citation fallback selection', async () => {
  for (const citations of [[], undefined, null]) {
    const output = await handlers.get_document_review({ review_id: 'fallback-review' }, {
      getDocumentReview: async () => ({ review_id: 'fallback-review', status: 'complete', prompt: 'Review',
        thread_id: 'test', asset_ids: ['source'], total_claims: 1, completed_claims: 1, pending_claims: 0,
        claims: [{ id: 'fallback', claim: retained.claim, result: 'verified',
          summary: 'retained '.repeat(4000), citations, top_citations: [retained.citation] }],
      }),
    });
    const row = output.structuredContent.claims[0];
    assert.equal(output.structuredContent.evidence_details_omitted, true);
    assert.deepEqual(row.citation_urls, citations ? [] : [retained.citation.url]);
    assert.deepEqual(row.citation_reader_coverage.map(item => item.coverage), citations ? [] : ['partial']);
    if (!citations) assert.equal(row.citation_reader_coverage[0].citation_index, 1);
  }
});

test('actual stream result renderer uses publisher qualifiers without adopting reader completeness', async () => {
  const result = { citations: [retained.citation], verdict: { result: 'supported', confidence: null,
    evidence_status: 'claim_evidence', summary: 'The selected cell supports this claim.' } };
  const output = await handlers.verify_claim_stream({ claim: retained.claim }, {
    verifyClaimStream: async function* () { yield { event: 'result', data: result }; yield { event: 'done', data: {} }; },
  });
  assert.match(output.text, /Publisher reader coverage: partial/);
  assert.match(output.text, /confidence unknown/);
  assert.equal(output.structuredContent.citations[0].evidence.readerCoverage, 'partial');
  assert.equal(output.structuredContent.verdict.result, 'supported');
});

test('limitation warnings remain bounded with explicit omissions and shortened text', () => {
  const evidence = { readerCoverage: 'partial', readerLimitations: ['x'.repeat(1000), 'second', 'third', 'tail'] };
  const rows = citationReaderCoverage([{ evidence }, { evidence: [] }]);
  assert.equal(rows[0].limitations.length, 3);
  assert.ok(rows[0].limitations.every(text => text.length <= 120));
  assert.equal(rows[0].omitted_limitation_count, 1);
  assert.equal(rows[0].limitations_truncated, true);
  assert.equal(rows[1].coverage, 'unknown');
});

test('coverage qualifiers preserve the compact assessed identity and original report description', async () => {
  const assessment = { version: 1, basis: 'source_table', claim: 'Output was 4.3% in 2023.',
    judgment_claim: 'Output was 4.3% in 2023.\nInterpretation context: retained table' };
  const output = await handlers.get_document_review({ review_id: 'assessed-review' }, {
    getDocumentReview: async () => ({ review_id: 'assessed-review', status: 'complete', prompt: 'Review',
      thread_id: 'test', asset_ids: ['source'], total_claims: 1, completed_claims: 1, pending_claims: 0,
      claims: [{ id: 'original', claim: retained.claim, result: 'verified', confidence: null,
        source_assessment: assessment, citations: [{ ...retained.citation, snippet: 'retained '.repeat(4000) }] }],
    }),
  });
  const row = output.structuredContent.claims[0];
  assert.equal(row.claim, retained.claim);
  assert.deepEqual(row.source_assessment_summary, assessment);
  assert.equal(row.citation_reader_coverage[0].coverage, 'partial');
  assert.equal(row.confidence, undefined);
  assert.match(output.text, /Assessed assertion: Output was 4.3% in 2023/);
});

test('guide separates uploaded input and publisher coverage and preserves cancellation uncertainty', () => {
  const guide = renderWebciteGuide({ workflow: 'document_review' });
  assert.match(guide, /Input source coverage describes the uploaded report/);
  assert.match(guide, /missing, legacy or unrecognized publisher coverage stays unknown/i);
  assert.match(guide, /omitted counts and text truncation marked/);
  assert.match(guide, /cancellation still leaves incomplete results and credit outcomes unconfirmed/);
});
