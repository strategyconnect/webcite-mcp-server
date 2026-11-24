const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WebCiteApiClient, SURFACE_HEADER } = require('../dist/api-client.js');

/** A stand-in Webcite API that records the headers of every request it receives. */
function recordingApi() {
  const seen = [];
  const server = http.createServer((req, res) => {
    req.resume();
    seen.push({ path: req.url, headers: req.headers });
    if (req.headers.accept === 'text/event-stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"type":"done"}\n\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: {} }));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    seen, url: `http://127.0.0.1:${server.address().port}`,
    close: () => { server.closeAllConnections(); return new Promise(r => server.close(r)); },
  })));
}

test('every call to the Webcite API is labelled as coming through MCP', async () => {
  assert.deepEqual(SURFACE_HEADER, { 'x-webcite-surface': 'mcp' });
  const api = await recordingApi();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'surface-')), 'note.txt');
  fs.writeFileSync(file, 'Revenue was 12.');
  try {
    const client = new WebCiteApiClient('webcite_test_key', api.url);
    await client.request('/api/v1/verify', { method: 'POST', body: '{}' });
    await client.request('/api/v1/verify', { method: 'POST', body: '{}', headers: { 'x-extra': '1' } }, { idempotencyKey: 'k-1' });
    for await (const _event of client.streamRequest('/api/v1/verify/stream', '{}')) { /* drain */ }
    await client.uploadFile(file).catch(() => undefined);
    assert.ok(api.seen.length >= 4, `expected the JSON, idempotent, stream and upload calls, saw ${api.seen.length}`);
    for (const call of api.seen) {
      assert.equal(call.headers['x-webcite-surface'], 'mcp', `${call.path} carries the surface label`);
      assert.equal(call.headers['x-api-key'], 'webcite_test_key', `${call.path} still authenticates with the caller's key`);
    }
    assert.equal(api.seen[1].headers['idempotency-key'], 'k-1');
  } finally {
    await api.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});
