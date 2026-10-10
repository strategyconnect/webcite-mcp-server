const test = require('node:test');
const assert = require('node:assert/strict');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { handlers } = require('../dist/handlers.js');
test('typed constraints preserve absence, validate selected scope and require an exact response echo', async () => {
  const old = '11111111-1111-4111-8111-111111111111';
  const next = '22222222-2222-4222-8222-222222222222';
  const parent = '33333333-3333-4333-8333-333333333333';
  const constraints = [{ order: 0, source_literal: true }];
  const base = { folder_id: 'owned-folder', generation_id: next, answer_id: next, revision_id: next,
    status: 'grounded', text: 'Source-backed correction.',
    claims: [{ order: 0, support: 'supported', text: 'Source-backed correction.', citation_ids: ['cit_1'] }],
    citations: [{ citation_id: 'cit_1', source_version_id: 'source-owned', quote: 'Source-backed correction.' }] };
  let reply, calls = [];
  const client = { repairFolderGeneration: async (...args) => { calls.push(args); return reply; } };
  const args = { folder_id: 'owned-folder', generation_id: old, retained_reply_id: parent,
    claim_orders: [0], idempotency_key: 'typed-completion' };
  for (const value of [undefined, [], constraints]) {
    reply = { ...base, repair: { original_generation_id: old, retained_reply_id: parent, claim_orders: [0],
      ...(value === undefined ? {} : { claim_constraints: value }) } };
    await handlers.repair_folder_generation({ ...args, ...(value === undefined ? {} : { claim_constraints: value }) }, client);
    assert.equal(Object.hasOwn(calls.at(-1)[2], 'claim_constraints'), value !== undefined);
    if (value !== undefined) assert.deepEqual(calls.at(-1)[2].claim_constraints, value);
  }
  const before = calls.length;
  for (const value of [null, {}, [{ order: 1, source_literal: true }], [...constraints, ...constraints],
    [{ order: 0, source_literal: 'true' }], [{ order: 0, source_literal: true, extra: 1 }],
    [{ order: 0.5, source_literal: true }]])
    await assert.rejects(handlers.repair_folder_generation({ ...args, claim_constraints: value }, client));
  for (const patch of [{ retained_reply_id: undefined }, { claim_orders: undefined },
    { reuse_proof: { generation_id: next, claim_orders: [0] } }])
    await assert.rejects(handlers.repair_folder_generation({ ...args, ...patch, claim_constraints: constraints }, client));
  assert.equal(calls.length, before);
  for (const value of [undefined, [], [{ order: 0, source_literal: false }], [{ order: 1, source_literal: true }]]) {
    reply = { ...base, repair: { original_generation_id: old, retained_reply_id: parent, claim_orders: [0],
      ...(value === undefined ? {} : { claim_constraints: value }) } };
    await assert.rejects(handlers.repair_folder_generation({ ...args, claim_constraints: constraints }, client), /incomplete/);
  }
});

test('explicit repair orders are validated, forwarded and checked in the returned scope', async () => {
  const previous = global.fetch, calls = [];
  const old = '11111111-1111-4111-8111-111111111111';
  const next = '22222222-2222-4222-8222-222222222222';
  const valid = { folder_id: 'owned-folder', generation_id: next, answer_id: next, revision_id: next,
    status: 'grounded', text: 'Source-backed correction.',
    claims: [{ order: 0, support: 'supported', text: 'Source-backed correction.', citation_ids: ['cit_1'] }],
    citations: [{ citation_id: 'cit_1', source_version_id: 'source-owned', quote: 'Source-backed correction.' }],
    repair: { original_generation_id: old, claim_orders: [0] } };
  let result = valid;
  global.fetch = async (url, input) => { calls.push({ url, input }); return Response.json(result); };
  try {
    const client = new WebCiteApiClient('fixture', 'http://localhost');
    const args = { folder_id: 'owned-folder', generation_id: old, idempotency_key: 'selected', claim_orders: [0] };
    await handlers.repair_folder_generation(args, client);
    assert.deepEqual(JSON.parse(calls[0].input.body), { claim_orders: [0] });
    for (const patch of [{ claim_orders: [] }, { claim_orders: [0, 0] }, { claim_orders: [-1] },
      { claim_orders: [100] }, { claim_orders: [0.5] }, { claim_orders: ['0'] }, { claim_orders: null },
      { reuse_proof: { generation_id: next, claim_orders: [0] } }])
      await assert.rejects(handlers.repair_folder_generation({ ...args, ...patch }, client));
    assert.equal(calls.length, 1);
    for (const orders of [undefined, [], [1], [0, 0]]) {
      result = { ...valid, repair: { original_generation_id: old, ...(orders === undefined ? {} : { claim_orders: orders }) } };
      await assert.rejects(handlers.repair_folder_generation(args, client), /incomplete/);
    }
  } finally { global.fetch = previous; }
});
const generation = '11111111-1111-4111-8111-111111111111';
const parent = '22222222-2222-4222-8222-222222222222';
const child = '33333333-3333-4333-8333-333333333333';
test('selected paid-parent completion forwards both selectors and rejects either response mismatch', async () => {
  const previous = global.fetch, calls = [];
  const valid = { folder_id: 'owned-folder', generation_id: child, answer_id: child, revision_id: child,
    status: 'grounded', text: 'Source-backed correction.',
    claims: [{ order: 0, support: 'supported', text: 'Source-backed correction.', citation_ids: ['cit_1'] }],
    citations: [{ citation_id: 'cit_1', source_version_id: 'source-owned', quote: 'Source-backed correction.' }],
    repair: { original_generation_id: generation, retained_reply_id: parent, claim_orders: [0] } };
  let result = valid;
  global.fetch = async (url, input) => { calls.push({ url, input }); return Response.json(result); };
  try {
    const client = new WebCiteApiClient('fixture', 'http://localhost');
    const args = { folder_id: 'owned-folder', generation_id: generation, retained_reply_id: parent,
      claim_orders: [0], max_tokens: 8192, idempotency_key: 'selected-completion' };
    await handlers.repair_folder_generation(args, client);
    assert.deepEqual(JSON.parse(calls[0].input.body), { max_tokens: 8192, retained_reply_id: parent, claim_orders: [0] });
    for (const patch of [{ retained_reply_id: undefined }, { claim_orders: [1] }]) {
      result = { ...valid, repair: { ...valid.repair, ...patch } };
      await assert.rejects(handlers.repair_folder_generation(args, client), /incomplete/);
    }
    assert.equal(calls.length, 3);
  } finally { global.fetch = previous; }
});
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
