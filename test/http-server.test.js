const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { extractApiKey, createRemoteMcpApp } = require('../dist/http-server.js');

test('extractApiKey reads bearer and x-api-key', () => {
  assert.equal(
    extractApiKey({ headers: { authorization: 'Bearer wc_test' } }),
    'wc_test',
  );
  assert.equal(
    extractApiKey({ headers: { 'x-api-key': 'wc_header' } }),
    'wc_header',
  );
  assert.equal(extractApiKey({ headers: {} }), undefined);
});

test('health endpoint does not require auth', async () => {
  const { handler } = createRemoteMcpApp({ profile: 'core' });
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.service, 'webcite-mcp');
  assert.equal(body.mcpPath, '/mcp');
  assert.ok(body.toolCount >= 1);
  await new Promise((resolve) => server.close(resolve));
});

test('mcp without key returns 401', async () => {
  const { handler } = createRemoteMcpApp({ profile: 'core' });
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, 'unauthorized');
  await new Promise((resolve) => server.close(resolve));
});
