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
    await assert.rejects(handlers.upload_url({url:'https://example.org/report.pdf'},api), /Storage unavailable/);
    assert.equal(calls.length,1);
  });
});
