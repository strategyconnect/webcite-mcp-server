const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { TOOLS } = require('../dist/tools.js');

test('verification and source search forward hard source constraints', async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body: JSON.parse(body) });
    if (req.url.endsWith('/stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"type":"done"}\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const api = new WebCiteApiClient('test-only', `http://127.0.0.1:${server.address().port}`);
  const filters = { is_primary_source: true, official_country: 'ae', domain: ['centralbank.ae'] };
  const source_urls = ['https://centralbank.ae/report.pdf'];
  await api.verifyClaim({ claim: 'GWP 2025 was AED74.84bn', filters, source_urls });
  for await (const _ of api.verifyClaimStream({ claim: 'GWP 2025 was AED74.84bn', filters, source_urls })) {}
  await api.searchSources({ query: 'UAE GWP', filters });
  assert.deepEqual(requests.map(({ path }) => path), ['/api/v1/verify', '/api/v1/verify/stream', '/api/v1/sources/search']);
  assert.deepEqual(requests[0].body.filters, filters);
  assert.deepEqual(requests[0].body.source_urls, source_urls);
  assert.deepEqual(requests[1].body.source_urls, source_urls);
  assert.deepEqual(requests[2].body.filters, filters);
  for (const name of ['verify_claim', 'verify_claim_stream']) {
    const schema = TOOLS.find((tool) => tool.name === name).inputSchema.properties;
    assert.ok(schema.filters && schema.source_urls);
  }
});
