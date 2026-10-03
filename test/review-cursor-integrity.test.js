const test = require('node:test');
const assert = require('node:assert/strict');
const { handlers } = require('../dist/handlers.js');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require('../dist/index.js');

const streams = [
  ['claims', 'total_claims', 'next_offset', 'offset', { id: 'claim-0', claim: 'A retained factual assertion.', result: 'unverified', citations: [] }],
  ['uncovered_source_spans', 'uncovered_source_span_count', 'next_gap_offset', 'gap_offset', { asset_id: 'asset', start: 500, end: 501, preview: 'x' }],
  ['rejected_claims', 'rejected_claim_count', 'next_rejected_offset', 'rejected_offset', { claim: 'Rejected assertion', reason: 'source_grounding' }],
  ['nonclaim_dispositions', 'nonclaim_disposition_count', 'next_disposition_offset', 'disposition_offset', { asset_id: 'asset', start: 100, end: 107, source_quote: 'Heading', origin: 'model_extraction', reason: 'heading' }],
];
function page(stream, cursor = 1, total = 3) {
  const value = { review_id: 'review', status: 'failed', prompt: 'Review all claims', thread_id: 'stable', asset_ids: ['asset'],
    total_claims: 0, completed_claims: 0, pending_claims: 0, claims: [],
    uncovered_source_span_count: 0, uncovered_source_spans: [], rejected_claim_count: 0, rejected_claims: [],
    nonclaim_disposition_count: 0, nonclaim_dispositions: [], coverage_complete: false };
  value[stream[0]] = [{ ...stream[4] }];
  value[stream[1]] = total;
  value[stream[2]] = cursor;
  if (stream === streams[0]) { value.completed_claims = 1; value.pending_claims = Math.max(0, total - 1); }
  return value;
}
async function read(value, args = {}) {
  const original = global.fetch;
  let calls = 0;
  global.fetch = async (url, options) => {
    assert.ok(url.startsWith('https://offline.invalid/'));
    assert.equal(options.method, 'GET');
    calls++;
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const output = await handlers.get_document_review({ review_id: 'review', limit: 1, gap_limit: 1,
      rejected_limit: 1, disposition_limit: 1, ...args }, new WebCiteApiClient('OFFLINE_TEST_KEY', 'https://offline.invalid'));
    assert.equal(calls, 1);
    return output;
  } finally { global.fetch = original; }
}

for (const stream of streams) {
  test(`${stream[0]} valid dense page boundary retains original row and continuation`, async () => {
    const output = await read(page(stream));
    assert.deepEqual(output.structuredContent[stream[0]], [stream[4]]);
    assert.equal(output.structuredContent.next_page_input[stream[3]], 1);
  });
  for (const cursor of [0, -1, 2, 99, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    test(`${stream[0]} rejects malformed response cursor ${JSON.stringify(cursor)}`, async () => {
      await assert.rejects(read(page(stream, cursor)), error => error.code === 'invalid_api_output');
    });
  }
  for (const cursor of [null, undefined]) {
    test(`${stream[0]} refuses exhausted presentation while known rows remain, cursor=${cursor}`, async () => {
      const value = page(stream, cursor);
      if (cursor === undefined) delete value[stream[2]];
      await assert.rejects(read(value), error => error.code === 'invalid_api_output');
    });
  }
  test(`${stream[0]} accepts exact terminal boundary without a next cursor`, async () => {
    const output = await read(page(stream, null, 1));
    assert.equal(output.structuredContent.next_page_input, null);
  });
  test(`${stream[0]} refuses continuation from an empty page with known remaining rows`, async () => {
    const value = page(stream, 0); value[stream[0]] = [];
    await assert.rejects(read(value), error => error.code === 'invalid_api_output');
  });
  test(`${stream[0]} rejects a returned offset belonging to another page`, async () => {
    const value = page(stream); value[stream[3]] = 7;
    await assert.rejects(read(value), error => error.code === 'invalid_api_output');
  });
}

for (const stream of streams.slice(1)) {
  test(`${stream[0]} unknown legacy total still permits an attested forward cursor`, async () => {
    const output = await read(page(stream, 1, null));
    assert.equal(output.structuredContent.next_page_input[stream[3]], 1);
    assert.equal(output.structuredContent[stream[1]], null);
  });
  test(`${stream[0]} unknown total without cursor is not certified exhausted`, async () => {
    const output = await read(page(stream, null, null));
    assert.equal(output.structuredContent.next_page_input, null);
    assert.doesNotMatch(output.text, /All four result streams are exhausted/);
  });
}

test('pending stream coverage with unknown gap count remains pending', async () => {
  const value = page(streams[0], null, 1);
  value.coverage_state = 'pending'; value.uncovered_source_span_count = null;
  const output = await read(value);
  assert.equal(output.structuredContent.coverage_state, 'pending');
  assert.equal(output.structuredContent.uncovered_source_span_count, null);
  assert.doesNotMatch(output.text, /All four result streams are exhausted/);
});

test('source span positions can be sparse while external page offsets remain dense', async () => {
  const value = page(streams[1], 6, 9);
  value.uncovered_source_spans[0].start = 10_000;
  value.uncovered_source_spans[0].end = 10_001;
  const output = await read(value, { gap_offset: 5 });
  assert.equal(output.structuredContent.next_page_input.gap_offset, 6);
  assert.equal(output.structuredContent.uncovered_source_spans[0].start, 10_000);
});

test('a read beyond the known terminal position returns empty without inventing continuation', async () => {
  const value = page(streams[0], null, 1); value.claims = [];
  const output = await read(value, { offset: 5 });
  assert.equal(output.structuredContent.next_page_input, null);
});

test('an active empty review has no current continuation but is not certified exhausted', async () => {
  const value = page(streams[0], null, 0); value.claims = [];
  value.status = 'running'; value.completed_claims = 0; value.pending_claims = 0;
  value.extraction_complete = false;
  const output = await read(value);
  assert.equal(output.structuredContent.next_page_input, null);
  assert.doesNotMatch(output.text, /All four result streams are exhausted/);
});

test('cursor refusal preserves the known read request receipt without inventing a new charge', async () => {
  const value = page(streams[0], 0);
  value.credit_usage = { credits_used: 0, credits_remaining: 123, operation_id: 'saved-read-operation' };
  await assert.rejects(read(value), error => {
    assert.equal(error.code, 'invalid_api_output');
    assert.deepEqual(error.toPayload().credit_usage, value.credit_usage);
    return true;
  });
});

test('actual public MCP returns a cursor contract error after a valid page, without creating a new review', async () => {
  let reads = 0, creates = 0;
  const backend = {
    getDocumentReview: async () => {
      reads++;
      return { ...page(streams[0], 1), credit_usage: { credits_used: 0, credits_remaining: 123 } };
    },
    reviewDocument: async () => { creates++; throw new Error('UNEXPECTED_CHARGEABLE_CREATE'); },
  };
  const server = createMcpServer(backend, 'public', true);
  const client = new Client({ name: 'cursor-integrity-control', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    const good = await client.callTool({ name: 'get_document_review', arguments: { review_id: 'review', limit: 1 } });
    assert.notEqual(good.isError, true);
    assert.equal(good.structuredContent.next_page_input.offset, 1);
    const bad = await client.callTool({ name: 'get_document_review', arguments: good.structuredContent.next_page_input });
    assert.equal(bad.isError, true);
    assert.equal(bad.structuredContent.code, 'invalid_api_output');
    assert.deepEqual(bad.structuredContent.credit_usage, { credits_used: 0, credits_remaining: 123 });
    assert.match(bad.content[0].text, /Do not invent a continuation/);
    assert.equal(reads, 2); assert.equal(creates, 0);
  } finally { await client.close(); await server.close(); }
});

for (const stream of streams) {
  test(`${stream[0]} rejects unsafe request offset before any API call`, async () => {
    const backend = { getDocumentReview: async () => { throw new Error('UNEXPECTED_API_READ'); } };
    await assert.rejects(handlers.get_document_review({ review_id: 'review', [stream[3]]: Number.MAX_SAFE_INTEGER + 1 }, backend),
      error => error.code === 'invalid_argument');
  });
  test(`${stream[0]} refuses overflowing row end even without a server continuation`, async () => {
    const value = page(stream, null, Number.MAX_SAFE_INTEGER);
    if (stream !== streams[0]) value[stream[1]] = null;
    await assert.rejects(read(value, { [stream[3]]: Number.MAX_SAFE_INTEGER }), error => error.code === 'invalid_api_output');
  });
}
test('an unknown review status cannot certify all streams exhausted', async () => {
  const value = page(streams[0], null, 0); value.claims = []; value.completed_claims = 0; value.status = 'future_state';
  const output = await read(value);
  assert.doesNotMatch(output.text, /All four result streams are exhausted/);
});
test('a missing review status is incomplete API output, not an exhausted review', async () => {
  const value = page(streams[0], null, 0); value.claims = []; value.completed_claims = 0; delete value.status;
  await assert.rejects(read(value), error => error.code === 'invalid_api_output');
});
