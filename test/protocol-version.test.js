const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRemoteMcpApp } = require('../dist/http-server.js');
const { startAuthBackend } = require('./fixtures/auth-backend.js');
const { SUPPORTED_PROTOCOL_VERSIONS, LATEST_PROTOCOL_VERSION } = require('@modelcontextprotocol/sdk/types.js');

// Hosted logs, 11 to 24 November 2026: Claude sent MCP-Protocol-Version: 2026-07-28 and the
// SDK answered 400 "Unsupported protocol version" (a 198-byte body) on 621 of 2,054 requests.

async function withServer(fn) {
  const backend = await startAuthBackend();
  const { handler } = createRemoteMcpApp({ profile: 'public', apiBaseUrl: backend.url });
  const server = http.createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await backend.close();
  }
}

async function post(base, path, body, version) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer webcite_test_key',
      ...(version === undefined ? {} : { 'mcp-protocol-version': version }),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text.startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').find((l) => l.startsWith('data: ')).slice(6));
  return { status: res.status, json };
}

const listTools = { jsonrpc: '2.0', id: 2, method: 'tools/list' };
const initialize = (protocolVersion) => ({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion, capabilities: {}, clientInfo: { name: 'test', version: '1' } },
});

test('every protocol version the SDK supports is served exactly as before', async () => {
  await withServer(async (base) => {
    for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
      const r = await post(base, '/mcp', listTools, v);
      assert.equal(r.status, 200, v);
      assert.equal(r.json.result.tools.length, 34, v);
    }
    const noHeader = await post(base, '/mcp', listTools);
    assert.equal(noHeader.status, 200);
  });
});

test('a newer protocol revision in the header is served at the latest supported version', async () => {
  await withServer(async (base) => {
    for (const v of ['2026-07-28', '2027-01-15']) {
      const list = await post(base, '/mcp', listTools, v);
      assert.equal(list.status, 200, v);
      assert.equal(list.json.result.tools.length, 34, v);
      const init = await post(base, '/mcp', initialize(v), v);
      assert.equal(init.status, 200, v);
      // Version negotiation happens in initialize: the server answers with a version it supports.
      assert.equal(init.json.result.protocolVersion, LATEST_PROTOCOL_VERSION, v);
    }
  });
});

test('initialize asking for a supported version keeps it', async () => {
  await withServer(async (base) => {
    const init = await post(base, '/mcp', initialize('2025-06-18'), '2025-06-18');
    assert.equal(init.json.result.protocolVersion, '2025-06-18');
  });
});

test('a garbage or unknown older version still gets 400, as the 2025-11-25 spec requires', async () => {
  await withServer(async (base) => {
    for (const v of ['banana', '2026-7-28', '2026-07-28; drop', '2024-01-01']) {
      const r = await post(base, '/mcp', listTools, v);
      assert.equal(r.status, 400, v);
      assert.match(r.json.error.message, /Unsupported protocol version/, v);
    }
  });
});

test('/mcp/ with a trailing slash is served like /mcp', async () => {
  await withServer(async (base) => {
    const r = await post(base, '/mcp/', listTools, '2025-11-25');
    assert.equal(r.status, 200);
    assert.equal(r.json.result.tools.length, 34);
    const unauth = await fetch(`${base}/mcp/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(unauth.status, 401);
    const other = await fetch(`${base}/mcpx`, { method: 'POST' });
    assert.equal(other.status, 404);
  });
});
