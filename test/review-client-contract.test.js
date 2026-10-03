const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require('../dist/index.js');

test('public MCP validates account caps before dispatch and retains execution identity', async () => {
  const calls = [];
  const backend = { startDocumentReviewJob: async (input, key) => {
    calls.push({ input, key });
    return { job_id: 'a'.repeat(64), status: 'queued',
      ...(input.max_account_credits !== undefined ? { max_account_credits: input.max_account_credits } : {}) };
  } };
  const server = createMcpServer(backend, 'public', true);
  const client = new Client({ name: 'review-budget-contract', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right); await client.connect(left);
  const input = { prompt: 'Check every claim', thread_id: 'budget-thread', asset_ids: ['asset-1'] };
  try {
    const schema = (await client.listTools()).tools.find(t => t.name === 'review_document').inputSchema.properties.max_account_credits;
    assert.equal(schema.type, 'integer'); assert.equal(schema.minimum, 1); assert.equal(schema.maximum, 2147483647);
    for (const cap of [0, -1, 1.5, '12', null, true, 2147483648, Number.MAX_SAFE_INTEGER]) {
      const out = await client.callTool({ name: 'review_document', arguments: { ...input, max_account_credits: cap } });
      assert.equal(out.isError, true, String(cap)); assert.equal(calls.length, 0);
    }
    for (const extra of [{}, { max_account_credits: 1 }, { max_account_credits: 12, retry_failed: true },
      { max_account_credits: 2147483647 }, { max_account_credits: 12, retry_failed: true, idempotency_key: 'explicit-retry' }]) {
      const out = await client.callTool({ name: 'review_document', arguments: { ...input, ...extra } });
      assert.ok(!out.isError); assert.equal(out.structuredContent.max_account_credits, extra.max_account_credits);
      assert.equal(calls.at(-1).input.max_account_credits, extra.max_account_credits);
    }
    assert.ok(calls.slice(0, 4).every(call => call.key === calls[0].key));
    assert.equal(Object.hasOwn(calls[0].input, 'max_account_credits'), false);
    assert.equal(calls[2].input.retry_failed, true); assert.equal(calls[4].key, 'explicit-retry');
  } finally { await client.close(); await server.close(); }
});

test('actual HTTP client transports account cap once and rejects missing or mismatched confirmation', async () => {
  const { WebCiteApiClient } = require('../dist/api-client.js');
  const { handlers } = require('../dist/handlers.js');
  const originalFetch = global.fetch;
  const calls = [];
  let echoed = 12;
  global.fetch = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ job_id: 'a'.repeat(64), status: 'queued',
      ...(echoed !== undefined ? { max_account_credits: echoed } : {}) }), { status: 200 });
  };
  try {
    const api = new WebCiteApiClient('fake-local-key', 'https://example.invalid');
    const input = { prompt: 'Check', thread_id: 'same', asset_ids: ['asset-1'], max_account_credits: 12 };
    for (const cap of [0, -1, 1.5, '12', null, true, NaN, Infinity, 2147483648]) {
      await assert.rejects(() => handlers.review_document({ ...input, max_account_credits: cap }, api),
        error => error.code === 'invalid_argument');
      assert.equal(calls.length, 0);
    }
    assert.equal((await handlers.review_document(input, api)).structuredContent.max_account_credits, 12);
    assert.equal(calls[0].method, 'POST');
    assert.equal(new URL(calls[0].url).pathname, '/api/v1/playground/chat/document-review-jobs');
    assert.equal(calls[0].body.max_account_credits, 12); assert.equal(Object.hasOwn(calls[0].body, 'review_scope'), false);
    for (echoed of [undefined, 13, '12', 0, null, 1.5]) {
      const before = calls.length;
      await assert.rejects(() => handlers.review_document(input, api), error => {
        assert.equal(error.code, 'invalid_api_output'); assert.equal(error.details.job_id, 'a'.repeat(64));
        assert.match(error.message, /do not resubmit/); return true;
      });
      assert.equal(calls.length, before + 1);
    }
    assert.ok(calls.every(call => call.body.idempotency_key === calls[0].body.idempotency_key));
  } finally { global.fetch = originalFetch; }
});

test('job polling preserves an account cap and rejects malformed budget metadata', async () => {
  const { handlers } = require('../dist/handlers.js');
  const job_id = 'a'.repeat(64);
  for (const cap of [1, 12, 2147483647]) {
    const out = await handlers.get_document_review_job({ job_id }, {
      getDocumentReviewJob: async () => ({ job_id, status: 'running', max_account_credits: cap }),
    });
    assert.equal(out.structuredContent.max_account_credits, cap);
    assert.match(out.text, new RegExp(`Account-credit cap for this execution: ${cap}`));
  }
  for (const cap of [0, -1, 1.5, '12', null, true, 2147483648]) {
    await assert.rejects(() => handlers.get_document_review_job({ job_id }, {
      getDocumentReviewJob: async () => ({ job_id, status: 'running', max_account_credits: cap,
        credit_usage: { credits_used: 0 } }),
    }), error => {
      assert.match(error.message, /invalid max_account_credits.*do not resubmit/);
      assert.equal(error.details.job_id, job_id); assert.equal(error.details.status, 'running');
      assert.deepEqual(error.toPayload().credit_usage, { credits_used: 0 }); return true;
    });
  }
});

test('public MCP explicitly retries a failed review without changing its input identity', async () => {
  const original = 'a'.repeat(64), child = 'b'.repeat(64), review = 'c'.repeat(64);
  const retryKey = `review-retry:${original}`;
  const calls = [];
  const failed = { job_id: original, review_id: review, status: 'failed',
    retry_idempotency_key: retryKey, progress: { completed_claims: 2, total_claims: 43 } };
  const backend = {
    startDocumentReviewJob: async (input, key) => {
      calls.push({ input, key });
      return input.retry_failed ? { job_id: child, review_id: review, status: 'queued' } : failed;
    },
    getDocumentReviewJob: async () => failed,
  };
  const server = createMcpServer(backend, 'public', true);
  const client = new Client({ name: 'retry-contract-qa', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const catalog = await client.listTools();
    assert.equal(catalog.tools.find(t => t.name === 'review_document').inputSchema.properties.retry_failed.type, 'boolean');
    const input = { prompt: 'Check every claim', thread_id: 'same-thread', asset_ids: ['12345678-1234-4234-8234-123456789abc'] };
    const first = await client.callTool({ name: 'review_document', arguments: input });
    assert.equal(first.isError, true);
    assert.equal(first.structuredContent.progress.completed_claims, 2);
    const retry = await client.callTool({ name: 'review_document', arguments: { ...input, retry_failed: true } });
    assert.ok(!retry.isError); assert.equal(retry.structuredContent.review_id, review);
    assert.equal(calls[0].key, calls[1].key);
    assert.deepEqual(calls[1].input, { ...calls[0].input, retry_failed: true });
    await client.callTool({ name: 'review_document', arguments: { ...input, retry_failed: true, idempotency_key: retryKey } });
    assert.equal(calls[2].key, retryKey);
    const invalid = await client.callTool({ name: 'review_document', arguments: { ...input, retry_failed: 'true' } });
    assert.equal(invalid.isError, true); assert.equal(calls.length, 3);
    const saved = await client.callTool({ name: 'get_document_review_job', arguments: { job_id: original } });
    assert.equal(saved.isError, true); assert.equal(saved.structuredContent.job_id, original);
    assert.equal(calls.length, 3);
  } finally { await client.close(); await server.close(); }
});

test('hosted public MCP exposes the bounded saved-review and source-gap journey', async () => {
  const reviewId = 'b'.repeat(64);
  const jobId = 'a'.repeat(64);
  const assetId = '12345678-1234-4234-8234-123456789abc';
  const originalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  const calls = [];
  const backend = {
    getDocumentReviewJob: async (id) => {
      calls.push('job'); assert.equal(id, jobId);
      return { job_id: jobId, review_id: reviewId, status: 'partial_coverage',
        progress: { total_claims: 1, completed_claims: 1, pending_claims: 0,
          extraction_complete: true, coverage_complete: false, uncovered_source_span_count: 1 } };
    },
    getDocumentReview: async (id, offset, limit, gapOffset, gapLimit, rejectedOffset, rejectedLimit,
      dispositionOffset, dispositionLimit) => {
      calls.push('review');
      assert.deepEqual([id, offset, limit, gapOffset, gapLimit, rejectedOffset, rejectedLimit,
        dispositionOffset, dispositionLimit], [reviewId, 0, 1, 0, 1, 0, 1, 0, 1]);
      return { review_id: reviewId, thread_id: 'thread-1', prompt: 'Check every claim',
        asset_ids: [assetId], status: 'complete', total_claims: 1, completed_claims: 1,
        pending_claims: 0, extraction_complete: true, coverage_complete: false,
        uncovered_source_span_count: 1, uncovered_source_spans: [{ asset_id: assetId,
          start: 0, end: 8, preview: 'Overview', role: 'heading',
          block_id: 'heading-1', role_basis: 'html:h1' }],
        rejected_claim_count: 1, rejected_claims: [{ claim: 'Candidate', reason: 'No source quote' }],
        nonclaim_disposition_count: 0, nonclaim_dispositions: [],
        claims: [{ id: 'claim-1', claim: 'Revenue increased', result_state: 'settled' }] };
    },
    getDocumentReviewSourceSpan: async (id, asset, start, end) => {
      calls.push('span'); assert.deepEqual([id, asset, start, end], [reviewId, assetId, 0, 8]);
      return { asset_id: assetId, start: 0, end: 8, source_quote: 'Overview',
        role: 'heading', block_id: 'heading-1', role_basis: 'html:h1' };
    },
    recordDocumentReviewNonclaim: async (id, input) => {
      calls.push('disposition'); assert.equal(id, reviewId);
      assert.equal(input.source_quote, 'Overview');
      return { ...input, reviewer_id: 'reviewer-1', reviewed_at: '2026-09-30T00:00:00Z' };
    },
    uploadBytes: async (bytes, filename) => {
      calls.push('upload'); assert.deepEqual(bytes, originalPng);
      assert.equal(filename, 'source.png');
      return { asset_id: assetId, filename, size: bytes.length };
    },
  };
  const server = createMcpServer(backend, 'public', true);
  const client = new Client({ name: 'review-contract-qa', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const catalog = await client.listTools();
    const names = new Set(catalog.tools.map((tool) => tool.name));
    for (const name of ['get_document_review_job', 'get_document_review', 'get_review_source_span',
      'record_review_nonclaim', 'upload_file']) assert.ok(names.has(name), name);
    const upload = catalog.tools.find((tool) => tool.name === 'upload_file');
    assert.equal(upload.inputSchema.properties.file_path, undefined);
    const job = await client.callTool({ name: 'get_document_review_job', arguments: { job_id: jobId } });
    assert.equal(job.structuredContent.progress.coverage_complete, false);
    const review = await client.callTool({ name: 'get_document_review', arguments: {
      review_id: reviewId, offset: 0, limit: 1, gap_offset: 0, gap_limit: 1,
      rejected_offset: 0, rejected_limit: 1, disposition_offset: 0, disposition_limit: 1 } });
    assert.equal(review.structuredContent.uncovered_source_spans[0].role, 'heading');
    assert.equal(review.structuredContent.rejected_claim_count, 1);
    const span = await client.callTool({ name: 'get_review_source_span', arguments: {
      review_id: reviewId, asset_id: assetId, start: 0, end: 8 } });
    assert.equal(span.structuredContent.source_quote, 'Overview');
    const disposition = await client.callTool({ name: 'record_review_nonclaim', arguments: {
      review_id: reviewId, asset_id: assetId, start: 0, end: 8,
      source_quote: 'Overview', rationale: 'This section title asserts no factual claim.' } });
    assert.equal(disposition.structuredContent.reviewer_id, 'reviewer-1');
    const uploaded = await client.callTool({ name: 'upload_file', arguments: {
      filename: 'source.png', file_base64: originalPng.toString('base64') } });
    assert.equal(uploaded.structuredContent.asset_id, assetId);
    assert.deepEqual(calls, ['job', 'review', 'span', 'disposition', 'upload']);
  } finally {
    await client.close();
    await server.close();
  }
});

test('review job polling is bounded and stops on a recorded terminal failure', async () => {
 const {handlers}=require('../dist/handlers.js');const job='a'.repeat(64);
 for(const [status,serverWait,expected] of [['queued',590000,30000],['running',1000,1000],['waiting_parse',undefined,30000],['failed',590000,0],['interrupted',30000,0]]) {
   const output=await handlers.get_document_review_job({job_id:job},{getDocumentReviewJob:async()=>({job_id:job,status,poll_after_ms:serverWait,error:status==='failed'?'Recorded provider failure':undefined})});
   assert.equal(output.structuredContent.poll_after_ms,expected);
   if(expected) {assert.match(output.text,new RegExp(`Wait ${expected} milliseconds`));assert.match(output.text,/Do not estimate one long sleep/);}
   else {assert.equal(output.isError,true);assert.doesNotMatch(output.text,/Wait \d+ milliseconds/);}
 }
});
