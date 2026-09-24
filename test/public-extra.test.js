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
    await handlers.publish_text_representation({source_version_id:'version-1'}, client);
    await handlers.get_latest_representation({source_version_id:'version-1'}, client);
    await handlers.read_source_unit({source_version_id:'version-1',representation_id:'rep-1',source_unit_id:'unit-1'}, client);
    await handlers.extract_pages({ asset_id: 'asset-1' }, client);
    await handlers.prepare_ocr_rescue({ source_version_id: 'version-1', representation_id: 'rep-1' }, client);
    await handlers.verify_numeric_claim({ claim: 'Revenue was 10', operands: [{
      source_version_id: 'version-1', representation_id: 'rep-1', source_unit_id: 'unit-1', figure_index: 0,
    }] }, client);
    assert.deepEqual(calls.map(({ url, method }) => [method, new URL(url).pathname]), [
      ['POST', '/api/v1/ask'], ['GET', '/api/v1/ask/job%2F1'],
      ['POST', '/api/v2/sources/version-1/representations/text'],
      ['GET', '/api/v2/sources/version-1/representations/latest'],
      ['GET', '/api/v2/sources/version-1/representations/rep-1/units/unit-1'],
      ['POST', '/api/v1/extract/pages'],
      ['POST', '/api/v2/sources/version-1/representations/rep-1/prepare-ocr-rescue'],
      ['POST', '/api/v2/verify/numeric'],
    ]);
    assert.deepEqual(calls[5].body, { asset_id: 'asset-1' });
    assert.deepEqual(calls[7].body.operands[0], {
      source_version_id: 'version-1', representation_id: 'rep-1', source_unit_id: 'unit-1', figure_index: 0,
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('register_source posts owned bytes and validates retained source identity', async () => {
  const originalFetch = global.fetch;
  try {
    let sent;
    global.fetch = async (_url, options) => {
      sent = options.body;
      return {ok:true,json:async()=>({sourceVersionId:'source-1',assetId:'asset-1'})};
    };
    const client = new WebCiteApiClient('test-key','https://example.test');
    const args = {asset_id:'asset-1',filename:'evidence.csv',file_base64:Buffer.from('Revenue,20').toString('base64')};
    const result = await handlers.register_source(args,client);
    assert.equal(result.structuredContent.sourceVersionId,'source-1');
    assert.equal(sent.get('assetId'),'asset-1');
    assert.equal(sent.get('file').name,'evidence.csv');
    global.fetch = async () => ({ok:true,json:async()=>({sourceVersionId:'source-1',assetId:'foreign'})});
    await assert.rejects(client.registerSourceBytes('asset-1',Buffer.from('x'),'evidence.csv'),/mismatched assetId/);
  } finally { global.fetch = originalFetch; }
});

test('invalid numeric references fail before any paid API call', async () => {
  let calls = 0;
  const client = { verifyNumericClaim: async () => { calls++; } };
  await assert.rejects(() => handlers.verify_numeric_claim({
    claim: 'Revenue was 10', operands: [{ source_version_id: ' version-1 ', figure_index: 0 }],
  }, client), /Expected one or two owned source figure references/);
  assert.equal(calls, 0);
});

test('base64 upload forwards caller bytes without reading a server path', async () => {
  let bytes;
  const client = { uploadBytes: async (data, filename) => {
    bytes = [data.toString(), filename];
    return { asset_id: 'asset-1', source_version_id: 'source-1', filename, size: data.length };
  } };
  const result = await handlers.upload_file({ filename: 'note.txt', file_base64: Buffer.from('safe text').toString('base64') }, client);
  assert.deepEqual(bytes, ['safe text', 'note.txt']);
  assert.match(result.text, /asset-1/);
  assert.equal(result.structuredContent.asset_id, 'asset-1');
  assert.match(result.text, /source-1/);
});

test('upload normalizes the actual API envelope and refuses missing asset identity', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: true, json: async () => ({ successCode: 200, data: { asset_id: 'real-asset', asset_url: 'evidence://qa', source_version_id: 'version-1' } }) });
    const client = new WebCiteApiClient('test-key', 'https://example.test');
    const uploaded = await client.uploadBytes(Buffer.from('abc'), 'qa.txt');
    assert.equal(uploaded.asset_id, 'real-asset');
    assert.equal(uploaded.source_version_id, 'version-1');
    const tool = await handlers.upload_file({ filename: 'qa.txt', file_base64: Buffer.from('abc').toString('base64') }, client);
    assert.equal(tool.structuredContent.asset_id, 'real-asset');
    assert.doesNotMatch(tool.text, /undefined/);
    global.fetch = async () => ({ ok: true, json: async () => ({ successCode: 200, data: {} }) });
    await assert.rejects(client.uploadBytes(Buffer.from('abc'), 'qa.txt'), /usable asset_id/);
  } finally { global.fetch = originalFetch; }
});

test('classification preserves unavailable confidence in text and structured output', async () => {
  const response = { category:'unfiled', covers:[], confidence:0, basis:'fallback', sufficiency:{status:'unavailable',reason:'unstable threshold'} };
  const result = await handlers.classify_document({asset_id:'asset-1'}, {classifyDocument:async()=>response});
  assert.equal(result.structuredContent.sufficiency.status, 'unavailable');
  assert.match(result.text, /Confidence:\*\* 0/);
  assert.match(result.text, /Basis:\*\* fallback/);
  assert.match(result.text, /Sufficiency:\*\* unavailable/);
});

test('document analysis exposes exact unavailable source lexemes', async () => {
  const response = {figures:[],conflicts:[],recomputations:[],review:{needs_review:true,reasons:['unavailable source values']},
    unavailableValues:[{sheet:'Unsafe',cell:'B1',reason:'unsafe_integer',rawLexeme:'9007199254740993'}]};
  const result = await handlers.analyze_document({asset_id:'asset-1'},
    {analyzeDocument:async()=>response});
  assert.equal(result.structuredContent.unavailableValues[0].rawLexeme,'9007199254740993');
  assert.match(result.text,/Unsafe!B1: unsafe_integer/);
  assert.doesNotMatch(result.text,/9007199254740992/);
});
