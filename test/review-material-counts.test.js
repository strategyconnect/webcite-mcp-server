const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require('../dist/index.js');

async function withClient(backend, check) {
  const server = createMcpServer(backend, 'public', true);
  const client = new Client({ name: 'material-count-qa', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try { await check(client); } finally { await client.close(); await server.close(); }
}

test('terminal job text retains known physical, material, duplicate, pending and failed counts', async () => {
  let calls = 0;
  const job = { job_id: 'a'.repeat(64), status: 'failed', progress: {
    total_claims: 65, material_claims: 57, completed_claims: 6, duplicate_claims: 8,
    pending_claims: 51, failed_claims: 4, rejected_claim_count: null } };
  await withClient({ getDocumentReviewJob: async () => { calls++; return job; } }, async client => {
    assert.match(client.getInstructions(), /material_claims \(physical rows excluding duplicates\)/);
    assert.match(client.getInstructions(), /pending_claims is unfinished work and includes failed_claims/);
    assert.match(client.getInstructions(), /Counts do not establish attempt history/);
    assert.match(client.getInstructions(), /provider access error does not rule out incomplete extraction/);
    const output = await client.callTool({ name: 'get_document_review_job', arguments: { job_id: job.job_id } });
    assert.equal(output.isError, true);
    assert.match(output.content[0].text, /6\/65 physical rows; material: 57; duplicates: 8; pending \(includes failed\): 51; failed: 4; rejected: unknown; uncovered: unknown/);
    assert.deepEqual(output.structuredContent.progress, job.progress);
    assert.equal(output.structuredContent.poll_after_ms, 0);
    assert.equal(calls, 1);
  });
});

test('legacy absent and null counts remain unknown, never zero', async () => {
  const job = { job_id: 'a'.repeat(64), status: 'failed', progress: { completed_claims: 0, total_claims: 1, material_claims: null } };
  await withClient({ getDocumentReviewJob: async () => job }, async client => {
    const output = await client.callTool({ name: 'get_document_review_job', arguments: { job_id: job.job_id } });
    assert.match(output.content[0].text, /0\/1 physical rows; material: unknown; duplicates: unknown; pending \(includes failed\): unknown; failed: unknown/);
    assert.equal(output.structuredContent.progress.material_claims, null);
    assert.equal(output.structuredContent.progress.pending_claims, undefined);
  });
});

test('compact alias rows preserve stored original identity and physical offsets with known material count', async () => {
  const id = 'b'.repeat(64); let calls = 0, invalid = false, corruptAlias = false;
  const canonical = { id: 'canonical', claim: 'An original source assertion.', result_state: 'pending',
    citations: [{ url: 'https://example.org/source', snippet: 'Retained details '.repeat(3000) }] };
  const alias = { id: 'canonical:duplicate:1', original_claim_id: 'canonical', claim: canonical.claim,
    result_state: 'duplicate', duplicate_of_id: 'canonical', duplicate_of_index: 0,
    duplicate_reason: 'same_source_assertion' };
  const data = { review_id: id, thread_id: 'same-input', prompt: 'Saved review', asset_ids: ['12345678-1234-4234-8234-123456789abc'],
    status: 'failed', total_claims: 2, material_claims: 1, completed_claims: 0, pending_claims: 1, failed_claims: 1,
    duplicate_claims: 1, claims: [canonical, alias], next_offset: null };
  await withClient({ getDocumentReview: async () => { calls++; return invalid ? { ...data, material_claims: 3 } : corruptAlias ? { ...data, claims: [canonical, { ...alias, original_claim_id: 'different-original' }] } : data; } }, async client => {
    const output = await client.callTool({ name: 'get_document_review', arguments: { review_id: id, detail_level: 'compact', limit: 50 } });
    assert.ok(!output.isError, JSON.stringify(output));
    assert.match(output.content[0].text, /material: 1; duplicates: 1/);
    assert.equal(output.structuredContent.material_claims, 1);
    assert.equal(output.structuredContent.claims[1].id, 'canonical:duplicate:1');
    assert.equal(output.structuredContent.claims[1].original_claim_id, 'canonical');
    assert.equal(output.structuredContent.claims[1].duplicate_of_index, 0);
    assert.equal(output.structuredContent.claims[1].duplicate_of_id, 'canonical');
    assert.equal(output.structuredContent.next_offset, null);
    invalid = true;
    const bad = await client.callTool({ name: 'get_document_review', arguments: { review_id: id } });
    assert.equal(bad.isError, true);
    assert.match(bad.content[0].text, /invalid material count/);
    invalid = false; corruptAlias = true;
    const wrongAlias = await client.callTool({ name: 'get_document_review', arguments: { review_id: id } });
    assert.equal(wrongAlias.isError, true);
    assert.match(wrongAlias.content[0].text, /duplicate.*invalid|invalid.*duplicate/);
    assert.equal(calls, 3);
  });
});

test('negative job count is rejected instead of becoming a reported number', async () => {
  await withClient({ getDocumentReviewJob: async () => ({ job_id: 'a'.repeat(64), status: 'failed', progress: { failed_claims: -1 } }) }, async client => {
    const output = await client.callTool({ name: 'get_document_review_job', arguments: { job_id: 'a'.repeat(64) } });
    assert.equal(output.isError, true); assert.match(output.content[0].text, /invalid failed_claims count/);
  });
});

for (const value of [true, false, null, undefined]) {
  test(`failed job text exposes canonical processing and source flags (${value})`, async () => {
    const job = { job_id: 'a'.repeat(64), status: 'failed', progress: {
      extraction_complete: value, source_read_complete: value, coverage_complete: value } };
    await withClient({ getDocumentReviewJob: async () => job }, async client => {
      const output = await client.callTool({ name: 'get_document_review_job', arguments: { job_id: job.job_id } });
      const shown = value ?? 'unknown';
      assert.ok(output.content[0].text.includes(`Extraction complete: ${shown}; source read complete: ${shown}; source coverage complete: ${shown}.`));
      assert.deepEqual(output.structuredContent.progress, job.progress);
      assert.equal(output.isError, true);
    });
  });
}

test('string processing flag is rejected rather than interpreted as a boolean', async () => {
  await withClient({ getDocumentReviewJob: async () => ({ job_id: 'a'.repeat(64), status: 'failed', progress: { extraction_complete: 'false' } }) }, async client => {
    const output = await client.callTool({ name: 'get_document_review_job', arguments: { job_id: 'a'.repeat(64) } });
    assert.equal(output.isError, true); assert.match(output.content[0].text, /invalid extraction_complete flag/);
  });
});
