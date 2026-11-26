const test = require('node:test');
const assert = require('node:assert/strict');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { handlers } = require('../dist/handlers.js');
const { createMcpServer } = require('../dist/index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const stored = { successCode: 200, data: { asset_id: 'owned-asset', asset_url: 'evidence://owned', source_version_id: 'owned-version', filename: 'report.pdf', size: 42 }, usage: { credits: 1 } };

async function withFetch(reply, run) {
  const original = global.fetch; const calls = [];
  global.fetch = async (url, init) => { calls.push({ url, init }); return reply(); };
  try { await run(new WebCiteApiClient('synthetic-only', 'https://offline.invalid'), calls); }
  finally { global.fetch = original; }
}

test('actual hosted MCP upload_url stores URL via API, preserves owned references and credit receipt', async () => {
  await withFetch(() => new Response(JSON.stringify(stored)), async (api, calls) => {
    const server = createMcpServer(api, 'public', true);
    const client = new Client({ name: 'synthetic-url-control', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st); await client.connect(ct);
    try {
      assert.ok((await client.listTools()).tools.some(tool => tool.name === 'upload_url'));
      const result = await client.callTool({ name: 'upload_url', arguments: { url: 'https://example.org/report.pdf' } });
      assert.notEqual(result.isError, true);
      assert.equal(result.structuredContent.asset_id, 'owned-asset');
      assert.equal(result.structuredContent.source_version_id, 'owned-version');
      assert.equal(result.structuredContent.asset_url, 'evidence://owned');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://offline.invalid/api/v1/upload/url');
      assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'https://example.org/report.pdf' });
    } finally { await client.close(); await server.close(); }
  });
});

for (const args of [{url:'http://example.org/report.pdf'}, {url:'https://user:secret@example.org/report.pdf'}, {url:'https://example.org:8443/report.pdf'}, {url:'https://example.org/report.pdf',file_path:'/private/file'}, {url:'https://example.org/report.pdf',filename:''}]) {
  test('invalid URL upload refuses before API dispatch: ' + Object.keys(args).join(','), async () => {
    await withFetch(() => { throw new Error('must not dispatch'); }, async (api, calls) => {
      await assert.rejects(handlers.upload_url(args, api), /HTTPS|filename/);
      assert.equal(calls.length, 0);
    });
  });
}

test('malformed stored response remains failure with its known upload receipt', async () => {
  await withFetch(() => new Response(JSON.stringify({...stored, data:{...stored.data,source_version_id:null}}), {headers:{'X-Credits-Used':'1'}}), async api => {
    await assert.rejects(api.uploadUrl({url:'https://example.org/report.pdf'}), error => {
      assert.equal(error.status,502); assert.ok(error.credit_usage); return true;
    });
  });
});

test('uncertain storage refusal is not retried or turned into upload success', async () => {
  await withFetch(() => new Response(JSON.stringify({message:'Storage unavailable'}), {status:503}), async (api,calls) => {
    // A 5xx body is never shown (audit M7); the client gets the status and a reference instead.
    await assert.rejects(handlers.upload_url({url:'https://example.org/report.pdf'},api), /Webcite API error \(503\)/);
    assert.equal(calls.length,1);
  });
});

// Security audit 2026-11-26 (lane 4) L2: private, loopback, link-local and metadata hosts reached the
// backend guard. The backend guard stays; this is defence in depth at the MCP layer.
const dns = require('node:dns');
for (const url of ['https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.5/x', 'https://169.254.169.254/latest/meta-data',
  'https://metadata.google.internal/x', 'https://localhost/x', 'https://[::ffff:127.0.0.1]/x', 'https://192.168.1.10/x',
  'https://172.16.0.1/x', 'https://100.64.0.1/x', 'https://[fd00::1]/x', 'https://[fe80::1]/x', 'https://0.0.0.0/x',
  'https://2130706433/x', 'https://svc.cluster.local/x']) {
  test('private or metadata host refused before API dispatch: ' + url, async () => {
    await withFetch(() => { throw new Error('must not dispatch'); }, async (api, calls) => {
      await assert.rejects(handlers.upload_url({ url }, api), /public/);
      assert.equal(calls.length, 0);
    });
  });
}

test('a hostname that resolves to a private address is refused; one that resolves publicly is sent (control)', async (t) => {
  const answers = { 'rebind.example': [{ address: '10.1.2.3', family: 4 }], 'public.example': [{ address: '93.184.215.14', family: 4 }],
    'mixed.example': [{ address: '93.184.215.14', family: 4 }, { address: '::1', family: 6 }] };
  t.mock.method(dns.promises, 'lookup', async (host) => answers[host] ?? []);
  await withFetch(() => { throw new Error('must not dispatch'); }, async (api, calls) => {
    await assert.rejects(handlers.upload_url({ url: 'https://rebind.example/x.pdf' }, api), /public/);
    await assert.rejects(handlers.upload_url({ url: 'https://mixed.example/x.pdf' }, api), /public/);
    assert.equal(calls.length, 0);
  });
  await withFetch(() => new Response(JSON.stringify(stored)), async (api, calls) => {
    await handlers.upload_url({ url: 'https://public.example/x.pdf' }, api);
    assert.equal(calls.length, 1);
  });
});

test('a DNS failure at the MCP layer leaves the decision to the backend guard (no new rejection)', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); });
  await withFetch(() => new Response(JSON.stringify(stored)), async (api, calls) => {
    await handlers.upload_url({ url: 'https://unresolvable.example/x.pdf' }, api);
    assert.equal(calls.length, 1);
  });
});
