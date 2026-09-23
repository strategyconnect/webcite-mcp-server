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
  // Must not advertise Bearer WWW-Authenticate — Claude OAuth auto-detect
  assert.equal(res.headers.get('www-authenticate'), null);
  const body = await res.json();
  assert.equal(body.error, 'unauthorized');
  assert.match(String(body.claude || ''), /No sign-in/);
  await new Promise((resolve) => server.close(resolve));
});

test('hosted upload advertises bytes and refuses server file paths', async () => {
  const { handler } = createRemoteMcpApp({ profile: 'public', apiBaseUrl: 'http://127.0.0.1:1' });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const headers = { authorization: 'Bearer test-key', 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  const rpc = async (id, method, params, session) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    const text = await response.text();
    const data = text.split('\n').find((line) => line.startsWith('data: '));
    return { response, body: JSON.parse(data.slice(6)) };
  };
  try {
    const init = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const session = init.response.headers.get('mcp-session-id');
    assert.ok(session);
    const listed = await rpc(2, 'tools/list', {}, session);
    const upload = listed.body.result.tools.find((tool) => tool.name === 'upload_file');
    assert.deepEqual(upload.inputSchema.required, ['filename', 'file_base64']);
    assert.equal(upload.inputSchema.properties.file_path, undefined);
    const rejected = await rpc(3, 'tools/call', { name: 'upload_file', arguments: { file_path: '/etc/passwd' } }, session);
    assert.equal(rejected.body.result.isError, true);
    assert.match(rejected.body.result.content[0].text, /not file_path/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
