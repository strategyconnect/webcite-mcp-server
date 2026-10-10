const test = require('node:test');
const assert = require('node:assert/strict');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { handlers } = require('../dist/handlers.js');
const generation = '11111111-1111-4111-8111-111111111111';
const parent = '22222222-2222-4222-8222-222222222222';
const child = '33333333-3333-4333-8333-333333333333';
test('retained repair forwards exact intent once and refuses parent mismatch or invalid arguments', async () => {
  const previous = global.fetch, calls = [];
  let result = { folder_id: 'owned-folder', generation_id: child, answer_id: parent, revision_id: child,
    status: 'grounded', text: 'Source-backed correction.',
    claims: [{ order: 0, support: 'supported', text: 'Source-backed correction.', citation_ids: ['cit_1'] }],
    citations: [{ citation_id: 'cit_1', source_version_id: 'source-owned', quote: 'Source-backed correction.' }],
    repair: { original_generation_id: generation, retained_reply_id: parent },
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
    const valid = result;
    const invalidOutputs = [{ text: '' }, { claims: [] }, { citations: [] }, { answer_id: null },
      { revision_id: null }, { status: 'insufficient_evidence' },
      { citations: [{ citation_id: 'cit_1', source_version_id: 'source-owned', quote: '' }] },
      { citations: [valid.citations[0], valid.citations[0]] },
      { claims: [{ ...valid.claims[0], citation_ids: ['cit_missing'] }] },
      { claims: [{ ...valid.claims[0], support: 'unknown' }] },
      { claims: [{ ...valid.claims[0], order: 1 }] }];
    for (const patch of invalidOutputs) {
      result = { ...valid, ...patch };
      await assert.rejects(handlers.repair_folder_generation(args, client), /incomplete/);
    }
    result = valid;
    result = { ...result, repair: { original_generation_id: generation } };
    await assert.rejects(handlers.repair_folder_generation(args, client), /incomplete/);
    assert.equal(calls.length, invalidOutputs.length + 2);
  } finally { global.fetch = previous; }
});


test('published proof reuse forwards a bounded donor selector and refuses paid or mismatched responses', async () => {
  const previous = global.fetch, calls = [];
  const reuse = { generation_id: parent, claim_orders: [0] };
  const valid = { folder_id: 'owned-folder', generation_id: child, answer_id: parent, revision_id: child,
    status: 'grounded', text: 'Source-backed correction.',
    claims: [{ order: 0, support: 'supported', text: 'Source-backed correction.', citation_ids: ['cit_1'] }],
    citations: [{ citation_id: 'cit_1', source_version_id: 'source-owned', quote: 'Source-backed correction.' }],
    repair: { original_generation_id: generation, reuse_proof: reuse },
    usage: { credits: 0, model_attempts: 0, method: 'retained_published_proof', model: null, input_tokens: null, output_tokens: null } };
  let result = valid;
  global.fetch = async (url, input) => { calls.push({ url, input }); return Response.json(result); };
  try {
    const client = new WebCiteApiClient('fixture', 'http://localhost');
    const args = { folder_id: 'owned-folder', generation_id: generation, idempotency_key: 'proof-reuse',
      reuse_proof: { claim_orders: [0], generation_id: parent } };
    await handlers.repair_folder_generation(args, client);
    assert.deepEqual(JSON.parse(calls[0].input.body), { reuse_proof: args.reuse_proof });
    assert.equal(calls.length, 1);
    for (const patch of [{ reuse_proof: { generation_id: parent, claim_orders: [] } },
      { reuse_proof: { generation_id: parent, claim_orders: [0, 0] } },
      { reuse_proof: { generation_id: parent, claim_orders: [-1] } },
      { reuse_proof: { generation_id: 'bad', claim_orders: [0] } }, { retained_reply_id: parent }])
      await assert.rejects(handlers.repair_folder_generation({ ...args, ...patch }, client));
    assert.equal(calls.length, 1);
    for (const patch of [{ repair: { ...valid.repair, reuse_proof: { ...reuse, generation_id: child } } },
      { repair: { ...valid.repair, reuse_proof: { ...reuse, claim_orders: [1] } } },
      ...[{ credits: 5 }, { model_attempts: 1 }, { method: 'model' }, { model: 'fresh' },
        { input_tokens: 1 }, { output_tokens: 1 }].map(usage => ({ usage: { ...valid.usage, ...usage } }))]) {
      result = { ...valid, ...patch };
      await assert.rejects(handlers.repair_folder_generation(args, client), /incomplete/);
    }
  } finally { global.fetch = previous; }
});
