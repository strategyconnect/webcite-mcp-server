const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiClientError, WebCiteApiClient } = require('../dist/api-client.js');
const { handlers } = require('../dist/handlers.js');
const { renderWebciteGuide } = require('../dist/guide.js');
const { createMcpServer } = require('../dist/index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

test('document and figure extraction preserve full backend data for Claude', async () => {
  const markdown = 'A'.repeat(18_000) + ' final figure 42';
  const document = { format: 'pdf', markdown, units: [
    { kind: 'page', index: 1, text: 'A'.repeat(18_000), provenance: { page: 1 } },
    { kind: 'page', index: 2, text: 'final figure 42', provenance: { page: 2 } },
  ], state: 'partial', reason: 'page 3 unreadable', lost: [{ kind: 'page', index: 3 }] };
  const extracted = await handlers.extract_document({ asset_id: 'asset-1' }, {
    extractDocument: async () => document,
  });
  assert.equal(extracted.structuredContent.markdown, markdown);
  assert.equal(extracted.structuredContent.units[1].text, 'final figure 42');
  assert.deepEqual(extracted.structuredContent.lost, document.lost);
  assert.match(extracted.text, /Display limit.*client omits structuredContent.*read_source_unit/);
  assert.match(extracted.text, /Unreturned units.*page 3/);

  const figures = { figures: [], state: 'partial', reason: 'OCR pending' };
  const found = await handlers.extract_figures({ asset_id: 'asset-1' }, {
    extractFigures: async () => figures,
  });
  assert.deepEqual(found.structuredContent, figures);
  assert.match(found.text, /does not mean the document has no numbers/);
});

test('Claude MCP transport exposes full extraction and balance', async () => {
  const server = createMcpServer({
    extractDocument: async () => ({ format: 'pdf', markdown: 'page one\npage two',
      units: [{ kind: 'page', index: 1, text: 'page one', provenance: { page: 1 } },
        { kind: 'page', index: 2, text: 'page two', provenance: { page: 2 } }],
      state: 'complete' }),
    getCreditBalance: async () => ({ credits: { used: 96, remaining: 4, total: 100 }, allow_overage: false }),
  }, 'public');
  const client = new Client({ name: 'claude-recovery-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const balance = await client.callTool({ name: 'get_credit_balance', arguments: {} });
    const extraction = await client.callTool({ name: 'extract_document', arguments: { asset_id: 'asset-1' } });
    assert.equal(balance.structuredContent.credits.remaining, 4);
    assert.equal(extraction.structuredContent.units[1].text, 'page two');
  } finally {
    await client.close();
    await server.close();
  }
});

test('credit refusal is explicit and retains required/remaining amounts', () => {
  const failure = new ApiClientError(400, JSON.stringify({
    message: 'Insufficient credits. Required: 4, Available: 1. Overage billing is disabled.',
    statusCode: 400,
  })).toToolFailure().toPayload();
  assert.equal(failure.code, 'credit_exhausted');
  assert.equal(failure.details.required, 4);
  assert.equal(failure.details.remaining, 1);
  assert.match(failure.actionable, /completed results.*unchecked items/);
  assert.equal(new ApiClientError(400, '{"message":"Invalid claim"}').toToolFailure().code, 'api_error');
});

test('Claude MCP shows credit exhaustion instead of a generic API error', async () => {
  const server = createMcpServer({ verifyClaim: async () => {
    throw new ApiClientError(400, '{"message":"Insufficient credits. Required: 4, Available: 1."}');
  } }, 'public');
  const client = new Client({ name: 'claude-credit-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: 'verify_claim', arguments: { claim: 'A test claim' } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'credit_exhausted');
    assert.equal(result.structuredContent.details.remaining, 1);
    assert.match(result.content[0].text, /Stop chargeable calls/);
  } finally {
    await client.close();
    await server.close();
  }
});

test('credit balance uses the authenticated read-only route', async () => {
  const previous = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ credits: { used: 96, remaining: 4, total: 100 }, allow_overage: false,
      monthly_allocation: '10', current_balance: '-342', consumed: '352', overage_amount: 342 }) };
  };
  try {
    const client = new WebCiteApiClient('test-only', 'https://example.test');
    const balance = await handlers.get_credit_balance({}, client);
    assert.equal(new URL(request.url).pathname, '/api/v1/payment/credits/balance');
    assert.equal(request.options.method, 'GET');
    assert.equal(balance.structuredContent.credits.remaining, 4);
    assert.equal(balance.structuredContent.current_balance, undefined);
    assert.equal(balance.structuredContent.overage_amount, undefined);
    assert.match(balance.text, /Credits remaining: 4 of 100/);
  } finally { global.fetch = previous; }
});

test('document review guide tells Claude to resume with saved work and no count cap', () => {
  const guide = renderWebciteGuide({ workflow: 'document_review' });
  assert.match(guide, /no fixed claim count/i);
  assert.match(guide, /get_credit_balance/);
  assert.match(guide, /Completed claims replay without a new charge/);
  assert.match(guide, /connectors show only MCP text and omit structuredContent/);
  assert.match(guide, /16,000 characters and lists links beyond that limit/);
  assert.match(guide, /An asset_id is not a source_version_id/);
  assert.match(guide, /get_latest_representation.*read_source_unit/);
  assert.match(guide, /extract_pages.*costs 1 credit/);
  assert.match(guide, /get_document_review.*review_id.*zero credits/);
  assert.match(guide, /review_document.*exact resume_input/);
  assert.match(guide, /chat attachment is not automatically available/);
  assert.match(guide, /found with `search_sources` in source_urls/);
  assert.match(guide, /Repeating `extract_document` or `extract_figures` incurs the stated per-call credits/);
});

test('paginated citation history remains available as structured recovery data', async () => {
  const history = { data: [{ id: 'citation-1', prompt: 'Claim one' }],
    pagination: { page: 1, totalPages: 3, total: 101 } };
  let requested;
  const result = await handlers.list_citations({ thread_id: 'thread-1', page: 1, limit: 50 }, {
    listCitations: async (options) => { requested = options; return history; },
  });
  assert.deepEqual(requested, { page: 1, limit: 50, thread_id: 'thread-1' });
  assert.equal(result.structuredContent.pagination.totalPages, 3);
  assert.equal(result.structuredContent.data[0].id, 'citation-1');
});

test('saved review pages expose completed and pending work without a total claim cap', async () => {
  const snapshot = { review_id: 'review-1', thread_id: 'thread-1', prompt: 'Check the report',
    asset_ids: ['asset-1'], source_urls: ['https://example.test/official.pdf'],
    source_filters: { is_primary_source: true }, use_stance_analysis: true, use_verdict: false,
    status: 'credits_exhausted',
    total_claims: 101, completed_claims: 51, pending_claims: 50, credits_remaining: 0,
    credits_required_next: 4, extraction_cursor: 2, chunk_count: 3,
    next_offset: 50, claims: [{ id: 'claim-1', claim: 'Revenue was 10', page_number: 1,
      result: 'supported', summary: 'Source agrees.', citation_id: 'citation-1',
      top_citations: [{ url: 'https://example.test/report.pdf' }],
      citations: [{ url: 'https://example.test/report.pdf' }, { url: 'https://example.test/second.pdf' }] },
    { id: 'claim-2', claim: 'Profit grew', result: 'supported', result_state: 'result_saved',
      citations: [{ url: 'https://example.test/third.pdf' }] }] };
  let requested;
  const result = await handlers.get_document_review({ review_id: 'review-1', offset: 0, limit: 50 }, {
    getDocumentReview: async (...args) => { requested = args; return snapshot; },
  });
  assert.deepEqual(requested, ['review-1', 0, 50]);
  assert.equal(result.structuredContent.total_claims, 101);
  assert.equal(result.structuredContent.claims[0].citation_id, 'citation-1');
  assert.deepEqual(result.structuredContent.resume_input, {
    prompt: 'Check the report', asset_ids: ['asset-1'], thread_id: 'thread-1',
    source_urls: ['https://example.test/official.pdf'], filters: { is_primary_source: true },
    include_stance: true, include_verdict: false,
  });
  assert.match(result.text, /Completed: 51\/101; pending: 50/);
  assert.match(result.text, /Add credits or enable overage/);
  assert.match(result.text, /Next offset: 50/);
  assert.match(result.text, /Extraction chunks: 2\/3/);
  assert.match(result.text, /https:\/\/example.test\/report.pdf/);
  assert.match(result.text, /https:\/\/example.test\/second.pdf/);
  assert.match(result.text, /saved, settlement pending: supported/);
  assert.match(result.text, /https:\/\/example.test\/third.pdf/);
  assert.match(result.text, /Resume input: .*official.pdf/);

  let calls = 0;
  await assert.rejects(() => handlers.get_document_review({ review_id: ' review-1 ' }, {
    getDocumentReview: async () => { calls++; },
  }), /surrounding whitespace/);
  assert.equal(calls, 0);
});

test('document review returns saved progress when credits stop the stream', async () => {
  const claims = Array.from({ length: 101 }, (_, i) => ({ id: `claim-${i}`, claim: `Claim ${i}` }));
  const frames = [
    { type: 'claims-extracted', data: { review_id: 'review-1', total_claims: 101, claims } },
    { type: 'claim-verification-result', data: { review_id: 'review-1', claim_id: 'claim-0', claim: 'Claim 0', result: 'supported', summary: 'Official source.' } },
    { type: 'claim-verification-result', data: { review_id: 'review-1', claim_id: 'claim-1', claim: 'Claim 1', result: 'contradicted', summary: 'Official source differs.' } },
    { type: 'error', review_id: 'review-1', code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits', credits_required: 4, credits_remaining: 1 },
  ];
  const server = createMcpServer({ reviewDocumentStream: async function* () {
    for (const data of frames) yield { event: 'message', data };
  } }, 'public');
  const client = new Client({ name: 'claude-review-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: 'review_document', arguments: {
      prompt: 'Check the slide', asset_ids: ['asset-1'], thread_id: 'thread-1',
    } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.status, 'credit_exhausted');
    assert.match(result.content[0].text, /Add credits or enable overage/);
    assert.equal(result.structuredContent.review_id, 'review-1');
    assert.equal(result.structuredContent.total_claims, 101);
    assert.equal(result.structuredContent.completed_claims, 2);
    assert.equal(result.structuredContent.pending_claims, 99);
    assert.equal(result.structuredContent.results[1].result, 'contradicted');
    assert.deepEqual(result.structuredContent.resume_input, {
      prompt: 'Check the slide', asset_ids: ['asset-1'], thread_id: 'thread-1',
      include_stance: true, include_verdict: true,
    });
    assert.match(result.content[0].text, /Credits needed for next claim: 4/);
    assert.match(result.content[0].text, /Resume input: .*thread-1/);
    assert.match(result.content[0].text, /\[unchecked\] Claim 2/);
  } finally {
    await client.close();
    await server.close();
  }
});

test('document review names retryable failed claims without reporting a complete verdict', async () => {
  const frames = [
    { type: 'claims-extracted', data: { review_id: 'review-1', total_claims: 2,
      claims: [{ id: 'c1', claim: 'Assets were 10' }, { id: 'c2', claim: 'Assets were 20' }] } },
    { type: 'claim-verification-failed', data: { claim_id: 'c1', claim: 'Assets were 10',
      code: 'SOURCE_SEARCH_TIMEOUT', message: 'Source search timed out; retry this claim.', attempt: 1 } },
    { type: 'claim-verification-result', data: { claim_id: 'c2', claim: 'Assets were 20', result: 'supported' } },
    { type: 'document-review-progress', data: { review_id: 'review-1', total_claims: 2,
      completed_claims: 1, pending_claims: 1, failed_claims: 1 } },
    { type: 'error', review_id: 'review-1', code: 'PARTIAL_REVIEW', message: 'One claim needs retry.' },
  ];
  const result = await handlers.review_document({ prompt: 'Check', asset_ids: ['asset-1'], thread_id: 'thread-1' }, {
    reviewDocumentStream: async function* () { for (const data of frames) yield { event: 'message', data }; },
  });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, 'partial');
  assert.equal(result.structuredContent.completed_claims, 1);
  assert.equal(result.structuredContent.failed_claims, 1);
  assert.equal(result.structuredContent.failed_results[0].code, 'SOURCE_SEARCH_TIMEOUT');
  assert.match(result.text, /\[failed, retryable\] Assets were 10/);
  assert.doesNotMatch(result.text, /\[unchecked\] Assets were 10/);

  const saved = await handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => ({ review_id: 'review-1', thread_id: 'thread-1', prompt: 'Check',
      asset_ids: ['asset-1'], status: 'failed', total_claims: 2, completed_claims: 1,
      pending_claims: 1, failed_claims: 1, claims: [
        { id: 'c1', claim: 'Assets were 10', result_state: 'failed', error_code: 'SOURCE_SEARCH_TIMEOUT',
          error: 'Source search timed out; retry this claim.' },
        { id: 'c2', claim: 'Assets were 20', result_state: 'settled', result: 'supported' },
      ] }),
  });
  assert.match(saved.text, /pending: 1; failed: 1/);
  assert.match(saved.text, /\[failed, retryable: SOURCE_SEARCH_TIMEOUT\] Assets were 10/);
  assert.match(saved.text, /Source search timed out; retry this claim/);
});

test('document review resumes as complete only after every result and done', async () => {
  const officialSources = Array.from({ length: 6 }, (_, index) => `https://example.test/report-${index}.pdf`);
  const frames = [
    { type: 'claims-extracted', data: { review_id: 'review-1', claims: [{ id: 'c1', claim: 'One' }] } },
    { type: 'claim-verification-result', data: { claim_id: 'c1', claim: 'One', result: 'supported' } },
    { type: 'done' },
  ];
  const result = await handlers.review_document({ prompt: 'Check', asset_ids: ['asset-1'], thread_id: 'thread-1', source_urls: officialSources }, {
    reviewDocumentStream: async function* () { for (const data of frames) yield { event: 'message', data }; },
  });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, 'complete');
  assert.equal(result.structuredContent.pending_claims, 0);
  assert.deepEqual(result.structuredContent.resume_input.source_urls, officialSources);

  let called = false;
  await assert.rejects(() => handlers.review_document({ prompt: 'Check', asset_ids: ['asset-1', 'asset-1'], thread_id: 'thread-1' }, {
    reviewDocumentStream: async function* () { called = true; },
  }), /distinct asset_ids/);
  assert.equal(called, false);

  const incomplete = await handlers.review_document({ prompt: 'Check', asset_ids: ['asset-1'], thread_id: 'thread-1' }, {
    reviewDocumentStream: async function* () {
      yield { event: 'message', data: { type: 'document-review-progress', data: {
        review_id: 'review-1', total_claims: 1, extraction_complete: false,
        extraction_cursor: 1, chunk_count: 2,
      } } };
      for (const data of frames) yield { event: 'message', data };
    },
  });
  assert.equal(incomplete.structuredContent.status, 'partial');
  assert.match(incomplete.text, /Extraction chunks: 1\/2/);
});

test('document review stream posts the stable replay identity to the API', async () => {
  const previous = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response('data: {"type":"done"}\n\n', { status: 200,
      headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const client = new WebCiteApiClient('test-only', 'https://example.test');
    const frames = [];
    for await (const event of client.reviewDocumentStream({
      prompt: 'Check the slide', asset_ids: ['asset-1'], thread_id: 'thread-1',
      source_urls: ['https://example.test/official.pdf'], filters: { is_primary_source: true },
      include_stance: true, include_verdict: true,
    })) frames.push(event.data);
    assert.equal(new URL(request.url).pathname, '/api/v1/playground/chat/stream');
    assert.deepEqual(JSON.parse(request.options.body), {
      prompt: 'Check the slide', asset_ids: ['asset-1'], thread_id: 'thread-1',
      source_urls: ['https://example.test/official.pdf'], filters: { is_primary_source: true },
      include_stance: true, include_verdict: true,
    });
    assert.deepEqual(frames, [{ type: 'done' }]);
  } finally { global.fetch = previous; }
});
