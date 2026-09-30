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
  assert.match(guide, /get_document_review_job.*job_id at zero credits/);
  assert.match(guide, /review_document.*new idempotency_key/);
  assert.match(guide, /cannot read a local path or automatically access the attachment/);
  assert.match(guide, /Playground or through authenticated HTTP multipart\/resumable upload/);
  assert.match(guide, /parse_job_id.*wait for parsing.*parse_required.*parse_endpoint/);
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
  assert.deepEqual(requested, ['review-1', 0, 50, 0, 20, 0, 20, 0, 20]);
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

test('saved review fails closed when counted rejected candidates or dispositions are omitted', async () => {
  const snapshot = { review_id: 'review-1', thread_id: 'thread-1', prompt: 'Check',
    asset_ids: ['asset-1'], status: 'complete', total_claims: 0, completed_claims: 0,
    pending_claims: 0, claims: [] };
  await assert.rejects(() => handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => ({ ...snapshot, rejected_claim_count: 1 }),
  }), /omitted rejected claim candidates/);
  await assert.rejects(() => handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => ({ ...snapshot, nonclaim_disposition_count: 1 }),
  }), /omitted nonclaim dispositions/);
  await assert.rejects(() => handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => ({ ...snapshot, rejected_claim_count: 2,
      rejected_claims: [{ claim: 'One', reason: 'Missing quote' }] }),
  }), /omitted rejected candidate cursor/);
  await assert.rejects(() => handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => ({ ...snapshot, nonclaim_disposition_count: 2,
      nonclaim_dispositions: [{ asset_id: 'asset-1', start: 0, end: 8,
        source_quote: 'Contents', rationale: 'Navigation label', reviewer_id: 'user-1' }] }),
  }), /omitted nonclaim disposition cursor/);
  const positive = await handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => ({ ...snapshot, rejected_claim_count: 1,
      rejected_claims: [{ claim: 'Skipped claim', reason: 'Source quote missing' }],
      nonclaim_disposition_count: 1, nonclaim_dispositions: [{ asset_id: 'asset-1', start: 0, end: 8,
        source_quote: 'Contents', rationale: 'Navigation label', reviewer_id: 'user-1' }] }),
  });
  assert.match(positive.text, /Rejected candidate 1.*Skipped claim/);
  assert.match(positive.text, /Nonclaim disposition 1.*Navigation label/);
});

test('Claude starts a durable full review, then polls saved progress without waiting for claims', async () => {
  const jobId = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  let posted;
  const server = createMcpServer({
    startDocumentReviewJob: async (options, key) => {
      posted = { options, key };
      return { job_id: jobId, status: 'queued', progress: { completed_claims: 0, pending_claims: 0 } };
    },
    getDocumentReviewJob: async (id) => {
      assert.equal(id, jobId);
      return { job_id: jobId, status: 'partial_coverage', review_id: 'review-1',
        progress: { total_claims: 16, completed_claims: 16, pending_claims: 0,
          extraction_complete: true, coverage_complete: false, uncovered_source_span_count: 6 } };
    },
  }, 'public');
  const client = new Client({ name: 'claude-durable-review-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const input = { prompt: 'Check the document', asset_ids: ['asset-1'], thread_id: 'thread-1' };
    const started = await client.callTool({ name: 'review_document', arguments: input });
    assert.notEqual(started.isError, true);
    assert.equal(started.structuredContent.job_id, jobId);
    assert.match(started.content[0].text, /get_document_review_job/);
    assert.equal(posted.options.review_scope, 'full');
    assert.equal(posted.key.length, 64);
    const status = await client.callTool({ name: 'get_document_review_job', arguments: { job_id: jobId } });
    assert.equal(status.structuredContent.status, 'partial_coverage');
    assert.equal(status.structuredContent.progress.uncovered_source_span_count, 6);
    assert.match(status.content[0].text, /Coverage incomplete: 6 uncovered source spans/);
    assert.match(status.content[0].text, /get_document_review/);
  } finally {
    await client.close();
    await server.close();
  }
});

test('review job start uses a stable replay key and an explicit new retry key', async () => {
  const calls = [];
  const api = { startDocumentReviewJob: async (options, key) => {
    calls.push({ options, key });
    return { job_id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      status: 'queued' };
  } };
  const input = { prompt: 'Check', asset_ids: ['asset-1'], thread_id: 'thread-1',
    source_urls: ['https://example.test/official.pdf'], filters: { is_primary_source: true } };
  await handlers.review_document(input, api);
  await handlers.review_document(input, api);
  await handlers.review_document({ ...input, idempotency_key: 'retry-after-credits' }, api);
  assert.equal(calls[0].key, calls[1].key);
  assert.equal(calls[2].key, 'retry-after-credits');
  assert.deepEqual(calls[0].options, calls[2].options);
  await assert.rejects(() => handlers.review_document({ ...input, asset_ids: ['asset-1', 'asset-1'] }, api), /distinct asset_ids/);
  await assert.rejects(() => handlers.review_document({ ...input, review_scope: 'focused' }, api), /full review scope/);
  await assert.rejects(() => handlers.review_document({ ...input, idempotency_key: ' ' }, api), /idempotency_key/);
  assert.equal(calls.length, 3);
});

test('review job client posts without an SSE connection or a claim-count deadline', async () => {
  const previous = global.fetch;
  const requests = [];
  const jobId = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return Response.json({ job_id: jobId, status: 'queued' });
  };
  try {
    const client = new WebCiteApiClient('test-only', 'https://example.test');
    const result = await handlers.review_document({ prompt: 'Check', asset_ids: ['asset-1'], thread_id: 'thread-1' }, client);
    assert.equal(result.structuredContent.job_id, jobId);
    assert.equal(new URL(requests[0].url).pathname, '/api/v1/playground/chat/document-review-jobs');
    assert.equal(JSON.parse(requests[0].options.body).review_scope, undefined);
    assert.equal(JSON.parse(requests[0].options.body).idempotency_key.length, 64);
    assert.notEqual(requests[0].options.headers.Accept, 'text/event-stream');
  } finally { global.fetch = previous; }
});

test('malformed review job status fails closed and saved coverage is visible', async () => {
  const parsing = await handlers.get_document_review_job({ job_id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, {
    getDocumentReviewJob: async () => ({ job_id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      status: 'waiting_parse', progress: { completed_claims: 0, total_claims: 0 } }),
  });
  assert.notEqual(parsing.isError, true);
  assert.match(parsing.text, /Call get_document_review_job/);
  await assert.rejects(() => handlers.get_document_review_job({ job_id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, {
    getDocumentReviewJob: async () => ({ status: 'complete' }),
  }), /incomplete/);
  await assert.rejects(() => handlers.get_document_review_job({ job_id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, {
    getDocumentReviewJob: async () => ({ job_id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      status: 'complete', review_id: 'review-1', progress: { extraction_complete: true,
        pending_claims: 0, coverage_complete: false } }),
  }), /inconsistent coverage/);
  const saved = await handlers.get_document_review({ review_id: 'review-1' }, {
    getDocumentReview: async () => ({ review_id: 'review-1', thread_id: 'thread-1', prompt: 'Check',
      asset_ids: ['asset-1'], status: 'complete', total_claims: 1, completed_claims: 1,
      pending_claims: 0, extraction_complete: true, coverage_complete: false,
      uncovered_source_span_count: 1, ungrounded_claims: 0,
      uncovered_source_spans: [{ asset_id: 'asset-1', start: 20, end: 40, preview: 'Missing claim' }],
      claims: [{ id: 'c1', claim: 'Present claim', result: 'verified' }] }),
  });
  assert.match(saved.text, /Source coverage: incomplete; 1 uncovered spans/);
  assert.equal(saved.structuredContent.uncovered_source_spans[0].preview, 'Missing claim');
});

test('saved review pages uncovered passages independently of checked claims', async () => {
  const previous = global.fetch;
  let requestUrl;
  global.fetch = async (url) => {
    requestUrl = new URL(url);
    return Response.json({ review_id: 'review-1', thread_id: 'thread-1', prompt: 'Check',
      asset_ids: ['asset-1'], status: 'complete', total_claims: 1, completed_claims: 1,
      pending_claims: 0, extraction_complete: true, coverage_complete: false,
      uncovered_source_span_count: 2, ungrounded_claims: 0, next_gap_offset: 2,
      uncovered_source_spans: [{ asset_id: 'asset-1', start: 12, end: 20, preview: 'Gap two' }],
      rejected_claim_count: 2, next_rejected_offset: 2,
      rejected_claims: [{ claim: 'Rejected two', reason: 'Unbound source quote' }],
      claims: [{ id: 'c1', claim: 'Present claim', result: 'verified' }] });
  };
  try {
    const result = await handlers.get_document_review({ review_id: 'review-1', offset: 0, limit: 1,
      gap_offset: 1, gap_limit: 1, rejected_offset: 1, rejected_limit: 1,
      disposition_offset: 1, disposition_limit: 1 },
    new WebCiteApiClient('test-only', 'https://example.test'));
    assert.equal(requestUrl.searchParams.get('gap_offset'), '1');
    assert.equal(requestUrl.searchParams.get('gap_limit'), '1');
    assert.equal(requestUrl.searchParams.get('rejected_offset'), '1');
    assert.equal(requestUrl.searchParams.get('rejected_limit'), '1');
    assert.equal(requestUrl.searchParams.get('disposition_offset'), '1');
    assert.equal(requestUrl.searchParams.get('disposition_limit'), '1');
    assert.equal(result.structuredContent.next_gap_offset, 2);
    assert.equal(result.structuredContent.next_rejected_offset, 2);
    assert.match(result.text, /Uncovered passage 2.*Gap two/);
    assert.match(result.text, /Rejected candidate 2.*Unbound source quote/);
  } finally { global.fetch = previous; }
});

test('compact review output keeps an exact cursor for hidden gaps', async () => {
  const gaps = Array.from({ length: 5 }, (_, index) => ({
    asset_id: 'asset-1', start: index, end: index + 1, preview: `Gap ${index + 1}`,
  }));
  const result = await handlers.get_document_review({ review_id: 'review-1', gap_limit: 5 }, {
    getDocumentReview: async () => ({ review_id: 'review-1', thread_id: 'thread-1', prompt: 'Check',
      asset_ids: ['asset-1'], status: 'complete', total_claims: 4, completed_claims: 4,
      pending_claims: 0, extraction_complete: true, coverage_complete: false,
      uncovered_source_span_count: 5, ungrounded_claims: 0, next_gap_offset: 5,
      uncovered_source_spans: gaps,
      rejected_claim_count: 5, next_rejected_offset: 5,
      rejected_claims: Array.from({ length: 5 }, (_, index) => ({
        claim: `Rejected ${index + 1}`, reason: 'Not grounded' })),
      nonclaim_disposition_count: 5, next_disposition_offset: 5,
      nonclaim_dispositions: Array.from({ length: 5 }, (_, index) => ({
        asset_id: 'asset-1', start: index, end: index + 1, source_quote: 'x',
        rationale: `Navigation label ${index + 1}`, reviewer_id: 'user-1' })),
      claims: Array.from({ length: 4 }, (_, index) => ({ id: `c${index}`,
        claim: `Claim ${index} ${'x'.repeat(6000)}`, result: 'unverified' })) }),
  });
  assert.equal(result.structuredContent.next_gap_offset, 3);
  assert.equal(result.structuredContent.uncovered_source_spans.length, 3);
  assert.match(result.text, /Next gap offset: 3/);
  assert.equal(result.structuredContent.next_rejected_offset, 3);
  assert.equal(result.structuredContent.rejected_claims.length, 3);
  assert.match(result.text, /Next rejected offset: 3/);
  assert.equal(result.structuredContent.next_disposition_offset, 3);
  assert.equal(result.structuredContent.nonclaim_dispositions.length, 3);
  assert.match(result.text, /Next disposition offset: 3/);
});
