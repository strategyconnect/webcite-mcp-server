const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require('../dist/index.js');

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
