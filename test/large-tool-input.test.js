const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRemoteMcpApp } = require('../dist/http-server.js');
const { startAuthBackend } = require('./fixtures/auth-backend.js');

// Security audit 2026-11-26 D2 (GHSA-46jr-4wx8-v453): a tools/call whose arguments hold millions of
// array elements must be refused as a tool error, without reaching the API, and the server keeps serving.

test('D2: a tools/call with 3 million array elements is refused and the server keeps serving', async () => {
  const backend = await startAuthBackend();
  const { handler } = createRemoteMcpApp({ profile: 'public', apiBaseUrl: backend.url });
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const post = (body) => fetch(`http://127.0.0.1:${server.address().port}/mcp`, {
    method: 'POST',
    headers: { authorization: 'Bearer webcite_valid', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  try {
    const big = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'verify_batch', arguments: { items: new Array(3_000_000).fill({}) } } });
    assert.equal(big.status, 200);
    const text = await big.text();
    assert.match(text, /"isError":true/);
    assert.match(text, /items holds 3000000 entries/);
    assert.deepEqual(backend.calls.map((c) => c.path), ['/api/v1/payment/credits/balance'], 'only the credential check reached the API');
    const after = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.equal(after.status, 200);
    assert.match(await after.text(), /verify_batch/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await backend.close();
  }
});
