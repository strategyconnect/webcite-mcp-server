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

test('an MCP session stays bound to its initializing API key', async () => {
  const { handler } = createRemoteMcpApp({ profile: 'public' });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const post = (id, method, params, key, session) => fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  try {
    const conflicting = await fetch(endpoint, { method: 'POST',
      headers: { authorization: 'Bearer account-a', 'x-api-key': 'account-b',
        'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' },
      } }),
    });
    assert.equal(conflicting.status, 400);
    assert.equal((await conflicting.json()).error, 'conflicting_api_keys');
    const init = await post(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'session-key-test', version: '1' } }, 'account-a');
    const session = init.headers.get('mcp-session-id');
    assert.equal(init.status, 200);
    assert.ok(session);
    const wrong = await post(2, 'tools/list', {}, 'account-b', session);
    assert.equal(wrong.status, 403);
    assert.equal((await wrong.json()).error, 'session_key_mismatch');
    for (const method of ['GET', 'DELETE']) {
      const wrongSessionAction = await fetch(endpoint, { method,
        headers: { authorization: 'Bearer account-b', 'mcp-session-id': session,
          accept: 'application/json, text/event-stream' } });
      assert.equal(wrongSessionAction.status, 403, method);
      assert.equal((await wrongSessionAction.json()).error, 'session_key_mismatch');
    }
    const same = await post(3, 'tools/list', {}, 'account-a', session);
    assert.equal(same.status, 200);
    assert.match(await same.text(), /get_document_review/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
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
    assert.match(upload.description, /attachment is not automatically sent/);
    assert.match(upload.description, /Playground or HTTP multipart/);
    assert.match(upload.description, /Do not generate base64 from document text/);
    const rejected = await rpc(3, 'tools/call', { name: 'upload_file', arguments: { file_path: '/etc/passwd' } }, session);
    assert.equal(rejected.body.result.isError, true);
    assert.match(rejected.body.result.content[0].text, /not file_path/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('hosted upload accepts explicit raw bytes and returns an asset ID', async () => {
  let uploadedBytes = false;
  const originalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  const backend = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    uploadedBytes = Buffer.concat(chunks).includes(originalPng);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ successCode: 200, data: { asset_id: 'asset-1' } }));
  });
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
  const { handler } = createRemoteMcpApp({ profile: 'public', apiBaseUrl: `http://127.0.0.1:${backend.address().port}` });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
  const headers = { authorization: 'Bearer account-a', 'content-type': 'application/json',
    accept: 'application/json, text/event-stream' };
  const rpc = async (id, method, params, session) => {
    const response = await fetch(endpoint, { method: 'POST',
      headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    const text = await response.text();
    return { response, body: JSON.parse(text.split('\n').find((line) => line.startsWith('data: ')).slice(6)) };
  };
  try {
    const init = await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {},
      clientInfo: { name: 'hosted-bytes-test', version: '1' } });
    const session = init.response.headers.get('mcp-session-id');
    const upload = await rpc(2, 'tools/call', { name: 'upload_file', arguments: {
      filename: 'slide.png', file_base64: originalPng.toString('base64'),
    } }, session);
    assert.equal(upload.body.result.structuredContent.asset_id, 'asset-1');
    assert.equal(uploadedBytes, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => backend.close(resolve));
  }
});
