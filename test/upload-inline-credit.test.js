const test = require('node:test');
const assert = require('node:assert/strict');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { handlers } = require('../dist/handlers.js');
const receipt = { credits_used: 1, credits_remaining: 87, monthly_allocation: 729, overage_enabled: null, operation_id: null };

async function upload(body, headers = {}) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, method: options.method });
    return new Response(JSON.stringify(body), { headers });
  };
  try {
    const result = await handlers.upload_file({ filename: 'subset.txt', file_base64: Buffer.from('Original text').toString('base64') }, new WebCiteApiClient('test', 'http://localhost'));
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/v1\/upload$/);
    return result;
  } finally { global.fetch = original; }
}

test('upload retains native receipt and renders charge without another endpoint', async () => {
  const result = await upload({ successCode: 200, data: { asset_id: 'owned' }, credit_usage: receipt }, { 'X-Credits-Used': '999' });
  assert.deepEqual(result.structuredContent.credit_usage, receipt);
  assert.match(result.text, /Request credits used: 1; remaining: 87/);
});

test('upload retains header receipt and missing receipt explicitly stays unknown', async () => {
  const body = { successCode: 200, data: { asset_id: 'owned' } };
  const known = await upload(body, { 'X-Credits-Used': '1', 'X-Credits-Remaining': '87' });
  assert.equal(known.structuredContent.credit_usage.credits_used, 1);
  assert.match(known.text, /Request credits used: 1; remaining: 87/);
  const unknown = await upload(body);
  assert.equal(unknown.structuredContent.credit_usage, undefined);
  assert.match(unknown.text, /Request credit usage: unknown/);
  assert.doesNotMatch(unknown.text, /Request credits used: 0/);
});

test('upload malformed receipt fails closed rather than dropping known provenance', async () => {
  await assert.rejects(upload({ successCode: 200, data: { asset_id: 'owned' }, credit_usage: { ...receipt, credits_used: -1 } }), /credit receipt/);
});

test('actual public MCP upload exposes receipt in text and structured content', async () => {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const { createMcpServer } = require('../dist/index.js');
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return new Response(JSON.stringify({ successCode: 200, data: { asset_id: 'owned' }, credit_usage: receipt })); };
  const server = createMcpServer(new WebCiteApiClient('test', 'http://localhost'), 'public', true);
  const client = new Client({ name: 'upload-receipt-proof', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st); await client.connect(ct);
    const result = await client.callTool({ name: 'upload_file', arguments: { filename: 'subset.txt', file_base64: Buffer.from('Original text').toString('base64') } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.structuredContent.credit_usage, receipt);
    assert.match(result.content[0].text, /Request credits used: 1; remaining: 87/);
    assert.equal(calls, 1);
  } finally { global.fetch = original; await client.close(); await server.close(); }
});
