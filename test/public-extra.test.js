const test = require('node:test');
const assert = require('node:assert/strict');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { handlers } = require('../dist/handlers.js');

test('public MCP tools forward validated inputs to the matching API routes', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    return { ok: true, json: async () => ({ status: 'queued', id: 'job-1' }) };
  };
  try {
    const client = new WebCiteApiClient('test-key', 'https://example.test');
    await handlers.ask_document({ question: 'Revenue?', documentText: 'Revenue was 10.' }, client);
    await handlers.get_ask_result({ id: 'job/1' }, client);
    await handlers.extract_pages({ asset_id: 'asset-1' }, client);
    await handlers.prepare_ocr_rescue({ source_version_id: 'version-1', representation_id: 'rep-1' }, client);
    await handlers.verify_numeric_claim({ claim: 'Revenue was 10', operands: [{
      source_version_id: 'version-1', representation_id: 'rep-1', source_unit_id: 'unit-1', figure_index: 0,
    }] }, client);
    assert.deepEqual(calls.map(({ url, method }) => [method, new URL(url).pathname]), [
      ['POST', '/api/v1/ask'], ['GET', '/api/v1/ask/job%2F1'],
      ['POST', '/api/v1/extract/pages'],
      ['POST', '/api/v2/sources/version-1/representations/rep-1/prepare-ocr-rescue'],
      ['POST', '/api/v2/verify/numeric'],
    ]);
    assert.deepEqual(calls[2].body, { asset_id: 'asset-1' });
    assert.deepEqual(calls[4].body.operands[0], {
      source_version_id: 'version-1', representation_id: 'rep-1', source_unit_id: 'unit-1', figure_index: 0,
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('invalid numeric references fail before any paid API call', async () => {
  let calls = 0;
  const client = { verifyNumericClaim: async () => { calls++; } };
  await assert.rejects(() => handlers.verify_numeric_claim({
    claim: 'Revenue was 10', operands: [{ source_version_id: ' version-1 ', figure_index: 0 }],
  }, client), /Expected one or two owned source figure references/);
  assert.equal(calls, 0);
});
