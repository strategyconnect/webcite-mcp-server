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
  assert.match(guide, /cannot read a local path or automatically access the attachment/);
  assert.match(guide, /Playground or with HTTP multipart/);
  assert.match(guide, /never reconstructed document text/);
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
      cited_source_urls: ['https://example.test/printed-in-report'],
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
  assert.match(result.text, /Found citations: https:\/\/example.test\/report.pdf, https:\/\/example.test\/second.pdf/);
  assert.match(result.text, /Links printed in document: https:\/\/example.test\/printed-in-report/);
  assert.deepEqual(result.structuredContent.claims[0].cited_source_urls, ['https://example.test/printed-in-report']);
  assert.match(result.text, /saved, settlement pending: supported/);
  assert.match(result.text, /https:\/\/example.test\/third.pdf/);
  assert.match(result.text, /Resume input: .*official.pdf/);

  const focused = await handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => ({ ...snapshot, review_scope: 'focused' }),
  });
  assert.equal(focused.structuredContent.resume_input.review_scope, 'focused');
  assert.match(focused.text, /API resume input: .*"review_scope":"focused"/);
  assert.match(focused.text, /resume this focused review through the API/i);
  assert.match(focused.text, /new thread_id/);
  assert.doesNotMatch(focused.text, /\nResume input:/);
  const full = await handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => ({ ...snapshot, review_scope: 'full' }),
  });
  assert.equal(full.structuredContent.resume_input.review_scope, 'full');
  assert.equal(result.structuredContent.resume_input.review_scope, undefined);

  let calls = 0;
  await assert.rejects(() => handlers.get_document_review({ review_id: ' review-1 ' }, {
    getDocumentReview: async () => { calls++; },
  }), /surrounding whitespace/);
  assert.equal(calls, 0);
});

test('saved review rejects malformed printed links instead of reporting them as citations', async () => {
  const snapshot = { review_id: 'review-1', thread_id: 'thread-1', prompt: 'Check',
    asset_ids: ['asset-1'], status: 'completed', total_claims: 1, completed_claims: 1,
    pending_claims: 0, claims: [{ id: 'claim-1', claim: 'Claim', cited_source_urls: [42] }] };
  await assert.rejects(() => handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => snapshot,
  }), /invalid printed links/);
});

test('document review requests full scope and retains it when credits stop the stream', async () => {
  const claims = Array.from({ length: 101 }, (_, i) => ({ id: `claim-${i}`, claim: `Claim ${i}` }));
  const frames = [
    { type: 'claims-extracted', data: { review_id: 'review-1', total_claims: 101, claims } },
    { type: 'claim-verification-result', data: { review_id: 'review-1', claim_id: 'claim-0', claim: 'Claim 0', result: 'supported', summary: 'Official source.' } },
    { type: 'claim-verification-result', data: { review_id: 'review-1', claim_id: 'claim-1', claim: 'Claim 1', result: 'contradicted', summary: 'Official source differs.' } },
    { type: 'error', review_id: 'review-1', code: 'INSUFFICIENT_CREDITS', message: 'Insufficient credits', credits_required: 4, credits_remaining: 1 },
  ];
  let sentOptions;
  const server = createMcpServer({ reviewDocumentStream: async function* (options) {
    sentOptions = options;
    for (const data of frames) yield { event: 'message', data };
  } }, 'public');
  const client = new Client({ name: 'claude-review-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const reviewTool = (await client.listTools()).tools.find((tool) => tool.name === 'review_document');
    assert.deepEqual(reviewTool.inputSchema.properties.review_scope.enum, ['full']);
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
    assert.equal(sentOptions.review_scope, 'full');
    assert.deepEqual(result.structuredContent.resume_input, {
      prompt: 'Check the slide', asset_ids: ['asset-1'], thread_id: 'thread-1',
      review_scope: 'full',
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

test('long review stops at a saved checkpoint and releases the backend lock before a safe resume', async () => {
  const realNow = Date.now;
  let reads = 0;
  let aborted = false;
  Date.now = () => reads++ === 0 ? 0 : 115_001;
  try {
    const result = await handlers.review_document({ prompt: 'Check all', asset_ids: ['asset-1'], thread_id: 'thread-1' }, {
      reviewDocumentStream: async function* (_options, signal) {
        try {
          yield { event: 'message', data: { type: 'document-review-progress', data: {
            review_id: 'review-1', status: 'running', total_claims: 30, completed_claims: 5,
            pending_claims: 25,
          } } };
        } finally { aborted = signal.aborted; }
      },
      getDocumentReview: async (id, offset, limit) => {
        assert.deepEqual([id, offset, limit], ['review-1', 0, 1]);
        return { status: 'interrupted' };
      },
    });
    assert.equal(aborted, true);
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.checkpoint, true);
    assert.equal(result.structuredContent.saved_status, 'interrupted');
    assert.equal(result.structuredContent.review_id, 'review-1');
    assert.match(result.text, /repeat the exact resume input until complete/);
  } finally { Date.now = realNow; }
});

test('silent in-flight claim is aborted before the 180-second client deadline', { timeout: 1_000 }, async () => {
  const realSetTimeout = global.setTimeout;
  let aborted = false;
  global.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms === 130_000 ? 0 : ms, ...args);
  try {
    const result = await handlers.review_document({ prompt: 'Check all', asset_ids: ['asset-1'], thread_id: 'thread-1' }, {
      reviewDocumentStream: async function* (_options, signal) {
        yield { event: 'message', data: { type: 'document-review-progress', data: { review_id: 'review-1' } } };
        try {
          await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
        } finally { aborted = signal.aborted; }
      },
      getDocumentReview: async () => ({ status: 'interrupted' }),
    });
    assert.equal(aborted, true);
    assert.equal(result.structuredContent.review_id, 'review-1');
    assert.equal(result.structuredContent.checkpoint, true);
    assert.equal(result.isError, false);
  } finally { global.setTimeout = realSetTimeout; }
});

test('a timed review with an unreleased backend lock remains an error', async () => {
  const realNow = Date.now;
  let reads = 0;
  Date.now = () => reads++ === 0 ? 0 : reads < 4 ? 115_001 : 300_000;
  try {
    const result = await handlers.review_document({ prompt: 'Check all', asset_ids: ['asset-1'], thread_id: 'thread-1' }, {
      reviewDocumentStream: async function* () {
        yield { event: 'message', data: { type: 'document-review-progress', data: { review_id: 'review-1' } } };
      },
      getDocumentReview: async () => ({ status: 'running' }),
    });
    assert.equal(result.isError, true);
    assert.match(result.text, /could not confirm a released lock/);
  } finally { Date.now = realNow; }
});

test('credit exhaustion after a time budget remains an error with credit guidance', async () => {
  const realNow = Date.now;
  let reads = 0;
  Date.now = () => reads++ === 0 ? 0 : 115_001;
  try {
    const result = await handlers.review_document({ prompt: 'Check all', asset_ids: ['asset-1'], thread_id: 'thread-1' }, {
      reviewDocumentStream: async function* () {
        yield { event: 'message', data: { type: 'document-review-progress', data: { review_id: 'review-1' } } };
      },
      getDocumentReview: async () => ({ status: 'credits_exhausted' }),
    });
    assert.equal(result.isError, true);
    assert.match(result.text, /credits were exhausted/);
    assert.doesNotMatch(result.text, /could not confirm a released lock/);
  } finally { Date.now = realNow; }
});

test('a completed saved review is distinguished from an incomplete stream capture', async () => {
  const realNow = Date.now;
  let reads = 0;
  Date.now = () => reads++ === 0 ? 0 : 115_001;
  try {
    const result = await handlers.review_document({ prompt: 'Check all', asset_ids: ['asset-1'], thread_id: 'thread-1' }, {
      reviewDocumentStream: async function* () {
        yield { event: 'message', data: { type: 'document-review-progress', data: { review_id: 'review-1' } } };
      },
      getDocumentReview: async () => ({ status: 'complete' }),
    });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.saved_status, 'complete');
    assert.match(result.text, /Stream capture: partial/);
    assert.match(result.text, /Saved review status: complete/);
    assert.doesNotMatch(result.text, /repeat the exact resume input until complete/);
  } finally { Date.now = realNow; }
});

test('oversized review responses retain a saved recovery ID within the tool size budget', async () => {
  const longCitation = 'https://example.test/' + 'a'.repeat(3_000);
  const frames = [
    { event: 'message', data: { type: 'claims-extracted', data: { review_id: 'review-1',
      total_claims: 30, claims: Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, claim: `Claim ${index}` })) } } },
    ...Array.from({ length: 30 }, (_, index) => ({ event: 'message', data: {
      type: 'claim-verification-result', data: { review_id: 'review-1', claim_id: `c${index}`,
        claim: `Claim ${index}`, result: 'supported', top_citations: [{ url: longCitation }] },
    } })),
    { event: 'message', data: { type: 'done' } },
  ];
  const result = await handlers.review_document({ prompt: 'Check all', asset_ids: ['asset-1'], thread_id: 'thread-1' }, {
    reviewDocumentStream: async function* () { yield* frames; },
  });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.review_id, 'review-1');
  assert.equal(result.structuredContent.results_omitted, 30);
  assert.match(result.text, /get_document_review/);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 20_000);

  const saved = await handlers.get_document_review({ review_id: 'review-1', offset: 0, limit: 30 }, {
    getDocumentReview: async () => ({ review_id: 'review-1', thread_id: 'thread-1', prompt: 'Check all',
      asset_ids: ['asset-1'], status: 'complete', total_claims: 30, completed_claims: 30,
      pending_claims: 0, claims: Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`,
        claim: `Claim ${index}`, result: 'supported', citation_id: `citation-${index}`,
        citations: [{ url: longCitation, snippet: 'b'.repeat(3_000) }] })) }),
  });
  assert.equal(saved.structuredContent.review_id, 'review-1');
  assert.equal(saved.structuredContent.claims.length, 3);
  assert.equal(saved.structuredContent.next_offset, 3);
  assert.equal(saved.structuredContent.claims_omitted, 27);
  assert.match(saved.text, /Full saved evidence remains in Webcite/);
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) <= 20_000);
});

test('extreme prompt and citation fields cannot overflow compact review responses', async () => {
  const huge = 'x'.repeat(100_000);
  const stream = await handlers.review_document({ prompt: huge, asset_ids: ['asset-1'], thread_id: 'thread-1' }, {
    reviewDocumentStream: async function* () {
      yield { event: 'message', data: { type: 'document-review-progress', data: {
        review_id: 'review-1', total_claims: 1, completed_claims: 0, pending_claims: 1,
      } } };
    },
  });
  assert.equal(stream.structuredContent.review_id, 'review-1');
  assert.ok(Buffer.byteLength(JSON.stringify(stream)) <= 20_000);
  assert.match(stream.text, /original input/);

  const saved = await handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => ({ review_id: 'review-1', thread_id: 'thread-1', prompt: huge,
      asset_ids: ['asset-1'], status: 'complete', total_claims: 1, completed_claims: 1,
      pending_claims: 0, claims: [{ id: 'c1', claim: huge, result: 'supported',
        citations: [{ url: `https://example.test/${huge}` }] }] }),
  });
  assert.equal(saved.structuredContent.review_id, 'review-1');
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) <= 20_000);
  assert.match(saved.text, /use the Webcite API for full citation objects/);
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

  await assert.rejects(() => handlers.review_document({ prompt: 'Check', asset_ids: ['asset-1'],
    thread_id: 'thread-1', review_scope: 'focused' }, {
    reviewDocumentStream: async function* () { called = true; },
  }), /full review scope/);
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
    const result = await handlers.review_document({
      prompt: 'Check the slide', asset_ids: ['asset-1'], thread_id: 'thread-1',
      source_urls: ['https://example.test/official.pdf'], filters: { is_primary_source: true },
      include_stance: true, include_verdict: true,
    }, client);
    assert.equal(new URL(request.url).pathname, '/api/v1/playground/chat/stream');
    assert.deepEqual(JSON.parse(request.options.body), {
      prompt: 'Check the slide', asset_ids: ['asset-1'], thread_id: 'thread-1',
      review_scope: 'full',
      source_urls: ['https://example.test/official.pdf'], filters: { is_primary_source: true },
      include_stance: true, include_verdict: true,
    });
    assert.equal(result.structuredContent.resume_input.review_scope, 'full');
    assert.deepEqual(result.structuredContent.events.map((event) => event.data), [{ type: 'done' }]);
  } finally { global.fetch = previous; }
});
