const test = require('node:test');
const assert = require('node:assert/strict');
const { WebCiteApiClient, ApiClientError } = require('../dist/api-client.js');
const { createMcpServer } = require('../dist/index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

// Security audit 2026-11-26 (lane 4) M7: backend error bodies, 5xx included, reached the MCP client
// verbatim. The public API and MCP must never reveal models, providers, internal hosts or stack traces.

const LEAKS = ['gpt-4o', 'OpenAI', 'anthropic', 'claude-sonnet', '10.0.0.5', '4499', 'node_modules', 'at Object.<anonymous>'];
const leakyBody = JSON.stringify({
  statusCode: 500,
  message: 'OpenAI gpt-4o call failed: connect ECONNREFUSED http://10.0.0.5:4499 (fallback anthropic claude-sonnet)',
  stack: 'Error: boom\n    at Object.<anonymous> (/srv/app/node_modules/x.js:1:1)',
});

function assertNoLeak(value) {
  const text = JSON.stringify(value);
  for (const marker of LEAKS) assert.ok(!text.includes(marker), `leaked ${marker}: ${text}`);
}

async function callTool(reply, name, args) {
  const original = global.fetch;
  global.fetch = async () => reply();
  const server = createMcpServer(new WebCiteApiClient('synthetic-only', 'https://offline.invalid'), 'public', true);
  const client = new Client({ name: 'redaction', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const errors = console.error; console.error = () => {};
  try {
    await server.connect(st); await client.connect(ct);
    return await client.callTool({ name, arguments: args });
  } finally {
    console.error = errors; global.fetch = original;
    await client.close(); await server.close();
  }
}

test('a 5xx body naming a model, a provider and an internal host never reaches the MCP client', async () => {
  const result = await callTool(() => new Response(leakyBody, { status: 500, headers: { 'content-type': 'application/json' } }),
    'verify_claim', { claim: 'Water boils at 100 C at sea level.' });
  assert.equal(result.isError, true);
  assertNoLeak(result);
  assert.equal(result.structuredContent.code, 'api_error');
  assert.match(result.structuredContent.details.request_id, /^mcp_[0-9a-f]{16}$/);
  assert.match(result.content[0].text, /Reference: mcp_[0-9a-f]{16}/);
});

test('a 5xx message is never shown, even a harmless one', () => {
  const payload = new ApiClientError(503, JSON.stringify({ message: 'Storage unavailable' })).toToolFailure().toPayload();
  assert.ok(!JSON.stringify(payload).includes('Storage unavailable'));
  assert.match(payload.message, /Webcite API error \(503\)\. .*Reference: mcp_/);
});

test('a non-JSON 502 page is replaced, not shown', async () => {
  const result = await callTool(() => new Response('<html>nginx/1.22 upstream 10.0.0.5:4499 gpt-4o</html>', { status: 502 }),
    'verify_claim', { claim: 'Water boils at 100 C at sea level.' });
  assertNoLeak(result);
  assert.ok(!JSON.stringify(result).includes('nginx'));
});

test('a 4xx passes only its code and message; extra fields and stack traces are dropped', () => {
  const payload = new ApiClientError(400, JSON.stringify({
    statusCode: 400, code: 'INVALID_CLAIM', message: 'Claim must not be empty', error: 'Bad Request',
    provider: 'anthropic', stack: 'at Object.<anonymous> (node_modules/x.js:1:1)',
  })).toToolFailure().toPayload();
  assert.match(payload.message, /Claim must not be empty/);
  assert.equal(payload.details.error_code, 'INVALID_CLAIM');
  assert.equal(payload.details.body, undefined);
  assertNoLeak(payload);
});

test('a 4xx message naming a model or an internal host is replaced by a generic one', () => {
  for (const message of ['Model gpt-4o rejected the prompt', 'upstream http://10.0.0.5:4499 refused', 'OpenAI quota exceeded']) {
    const payload = new ApiClientError(422, JSON.stringify({ message })).toToolFailure().toPayload();
    assertNoLeak(payload);
    assert.match(payload.message, /Webcite API error \(422\)/);
  }
});

test('controls: a plain 4xx message and the credit fields still reach the client', () => {
  const invalid = new ApiClientError(400, JSON.stringify({ message: ['claim must be a string'] })).toToolFailure().toPayload();
  assert.match(invalid.message, /claim must be a string/);
  const credits = new ApiClientError(402, JSON.stringify({ message: 'Insufficient credits', credits_required: 3, credits_remaining: 1 }))
    .toToolFailure().toPayload();
  assert.equal(credits.code, 'credit_exhausted');
  assert.equal(credits.details.required, 3);
  assert.equal(credits.details.remaining, 1);
  assert.equal(credits.details.body, undefined);
});

test('an unexpected error (a failed fetch naming an internal host) is answered with a generic message and a reference', async () => {
  const result = await callTool(() => { throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.5:4499'); },
    'verify_claim', { claim: 'Water boils at 100 C at sea level.' });
  assert.equal(result.isError, true);
  assertNoLeak(result);
  assert.match(result.structuredContent.details.request_id, /^mcp_[0-9a-f]{16}$/);
});

test('a verification stream error event naming a provider is redacted', async () => {
  const sse = 'event: error\ndata: {"type":"error","message":"anthropic claude-sonnet overloaded at 10.0.0.5:4499"}\n\n';
  const result = await callTool(() => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    'verify_claim_stream', { claim: 'Water boils at 100 C at sea level.' });
  assert.equal(result.isError, true);
  assertNoLeak(result);
});
