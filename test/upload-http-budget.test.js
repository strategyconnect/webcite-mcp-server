const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRemoteMcpApp } = require('../dist/http-server.js');

test('hosted JSON transport admits a 20MB base64 envelope and rejects bodies above 30MB', async () => {
  const app = createRemoteMcpApp({ profile: 'public' });
  const server = http.createServer((req, res) => { void app.handler(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/mcp`;
    for (const [size, expected] of [[26_667_000, 400], [30_000_001, 413]]) {
      // Invalid JSON proves the body reader passed its size gate without starting a tool or backend operation.
      const response = await fetch(endpoint, { method: 'POST',
        headers: { authorization: 'Bearer isolated-test-only', 'content-type': 'application/json' },
        body: 'x'.repeat(size) });
      assert.equal(response.status, expected);
      await response.text();
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
