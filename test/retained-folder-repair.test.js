const test = require('node:test');
const assert = require('node:assert/strict');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { handlers } = require('../dist/handlers.js');
const generation = '11111111-1111-4111-8111-111111111111';
const parent = '22222222-2222-4222-8222-222222222222';
const child = '33333333-3333-4333-8333-333333333333';
test('retained repair forwards exact intent once and refuses parent mismatch or invalid arguments', async () => {
  const previous = global.fetch, calls = [];
  let result = { folder_id: 'owned-folder', generation_id: child, text: 'Source-backed correction.',
    claims: [], citations: [], repair: { original_generation_id: generation, retained_reply_id: parent },
    credit_usage: { credits_used: 5, credits_remaining: 95, monthly_allocation: 100,
      overage_enabled: false, operation_id: 'operation-child' } };
  global.fetch = async (url, input) => { calls.push({ url, input }); return Response.json(result); };
  try {
    const client = new WebCiteApiClient('fixture', 'http://localhost');
    const args = { folder_id: 'owned-folder', generation_id: generation, retained_reply_id: parent,
      max_tokens: 4096, idempotency_key: 'explicit-completion' };
    const response = await handlers.repair_folder_generation(args, client);
    assert.equal(response.structuredContent.repair.retained_reply_id, parent);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, new RegExp(`/folders/owned-folder/generations/${generation}/repair$`));
    assert.equal(calls[0].input.headers['Idempotency-Key'], 'explicit-completion');
    assert.deepEqual(JSON.parse(calls[0].input.body), { max_tokens: 4096, retained_reply_id: parent });
    for (const patch of [{ retained_reply_id: 'bad' }, { generation_id: 'bad' },
      { idempotency_key: ' padded' }, { folder_id: ' padded' }, { max_tokens: 8193 }])
      await assert.rejects(handlers.repair_folder_generation({ ...args, ...patch }, client));
    assert.equal(calls.length, 1);
    result = { ...result, repair: { original_generation_id: generation } };
    await assert.rejects(handlers.repair_folder_generation(args, client), /incomplete/);
    assert.equal(calls.length, 2);
  } finally { global.fetch = previous; }
});
