// Product client contract: the fake server below re-implements webcite-backend's delegation checks
// (delegation.service.ts signedProductPayload/resolveProductQuery/resolveProductPreview) independently.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { WebCiteProductClient } = require('../dist/api-client.js');

const SECRET = 's'.repeat(40);
const W = { product: 'dd', workspaceKind: 'organization', workspaceId: 'org-1', actorId: 'user-1' };
const OTHER = { ...W, workspaceId: 'org-2' };
const GRANTS = new Set([JSON.stringify([W.product, W.workspaceKind, W.workspaceId])]);
const H = (c) => c.repeat(64);
const SV = 'sv-1', SV2 = 'sv-2', RECEIPT = H('a'), RECEIPT2 = H('b');
const PATH = [{ kind: 'project', id: 'deal-1' }, { kind: 'meeting', id: 'm-1' }];

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
const contentHash = (v) => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const sign = (payload) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url')}`;
};

/** Returns null when the backend would accept the request, else the 4xx status. */
function verify(url, init) {
  const route = new URL(url).pathname.replace('/api/v2/integrations/product/sources/', '');
  const [encoded, signature] = String(init.headers['x-webcite-delegation']).split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
  if (signature !== expected) return 403;
  const token = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  const raw = JSON.parse(init.body);
  // zod defaults/trim are applied before the backend hashes parsed.data.
  const body = new URL(url).pathname.endsWith('/context/query')
    ? { ...raw, maxHops: raw.maxHops ?? 1, limit: raw.limit ?? 10, ...(raw.text ? { text: raw.text.trim() } : {}) } : raw;
  const now = Math.floor(Date.now() / 1000);
  if (token.method !== 'POST' || token.expiresAt <= now || token.expiresAt > now + 60 ||
    !GRANTS.has(JSON.stringify([token.product, token.workspaceKind, token.workspaceId]))) return 403;
  if (token.caseKind !== body.caseKind || token.caseId !== body.caseId) return 403;
  if (route === 'context/query')
    return token.aud === 'webcite-product-context-query' && token.queryHash === contentHash(body) ? null : 403;
  if (route === 'context/receipt')
    return token.aud === 'webcite-product-context-receipt' && token.requestHash === contentHash(body) ? null : 403;
  const preview = /^([^/]+)\/preview$/.exec(route);
  if (preview) return token.aud === 'webcite-product-source-preview' &&
    token.previewHash === contentHash({ sourceVersionId: decodeURIComponent(preview[1]), ...body }) ? null : 403;
  return 404;
}

const usage = { operationIds: ['op-1'], knownCredits: 0, completeness: 'complete' };
const locator = { kind: 'page', page: 1 };
const ref = (sv, scope) => ({ sourceVersionId: sv, kind: 'passage', nodeId: 'p:u1', snippet: 'Revenue grew',
  sourceUnitId: 'unit-1', representationId: 'rep-1', locator, ...(scope ? { contextScope: scope } : {}) });
const coverage = {
  inventory: { status: 'complete', checkedSourceCount: 2, uncheckedSourceCount: 0 },
  retrieval: { status: 'ok', refCount: 1, limit: 10, truncated: false, refuseReason: null, gapCount: 0, gaps: [], scopedQueryPlans: null },
  ledger: { status: 'not_requested', sources: [] },
  findings: { status: 'not_requested', manifestHash: null, resultStatus: null, sources: [], limitationCount: 0,
    outsideQueriedSourceVersionIds: { count: 0, sourceVersionIds: [], findingCount: 0 }, gaps: [] },
  notes: { included: 1, current: 1, excludedStale: 0, evidenceStatus: 'unverified' },
  coalescedDuplicates: 0,
};
const note = { noteId: 'note-1', revision: 1, revisionId: 'rev-1', authorId: 'user-1', scopeKind: 'session',
  scopeId: 'scope', text: 'Analyst note', sourceRefs: [], expiresAt: '2027-01-01T00:00:00.000Z',
  status: 'active', freshness: 'current', evidenceStatus: 'unverified' };
function composed(include = ['passages', 'notes']) {
  return { version: 'product-query-evidence/1', include,
    items: [
      { id: H('1'), origin: 'source_statement', snippet: 'Revenue grew', ref: { ...ref(SV, undefined),
        snippet: undefined, analysisReceiptId: RECEIPT, contextScope: 'meeting', quote: null,
        quoteBinding: 'physical_source_only', sourceUnitHash: null, startCodePoint: null, endCodePoint: null } },
      { id: H('2'), origin: 'user_assertion', noteId: 'note-1', revisionId: 'rev-1', note },
    ],
    omitted: [{ origin: 'source_statement', sourceVersionIds: [SV2], count: 1, sampleItemIds: [H('3')], reason: 'max_items' }],
    budgets: { maxItems: 2, maxChars: 12000, maxBytes: 200000, usedItems: 2, usedChars: 24, usedBytes: 1500 },
    coverage, receipt: null };
}
function queryResponse(body, extra = {}) {
  return { status: 'ok', operatorClass: 'select_passage', snapshotSource: 'persisted', ...W,
    caseKind: body.caseKind, caseId: body.caseId, contextPath: body.contextPath, bindingRevisions: [H('c'), H('d')],
    sourceVersionIds: body.sourceVersionIds, analysisReceipts: { [SV]: RECEIPT, [SV2]: RECEIPT2 },
    refs: [ref(SV, 'meeting')], gaps: [],
    contextScopes: [
      { bindingId: H('e'), sourceVersionId: SV, revisionId: H('c'), scope: 'meeting', contextPath: PATH },
      { bindingId: H('f'), sourceVersionId: SV2, revisionId: H('d'), scope: 'company', contextPath: PATH.slice(0, 1) },
    ],
    automaticSourceLedger: { results: [], gaps: [] }, sourceFindingsMemory: null,
    memory: { notes: [note], excludedStale: 0, evidenceStatus: 'unverified' },
    operationId: 'op-1', usage, ...(body.evidence ? { composedEvidence: composed(body.evidence.include) } : {}), ...extra };
}
const span = { startUtf16: 0, endUtf16: 12, startCodePoint: 0, endCodePoint: 12,
  windowStartCodePoint: 0, windowEndCodePoint: 12, excerpt: 'Revenue grew' };
function previewResponse(sv, body, extra = {}) {
  return { kind: 'unit', source_version_id: sv, representation_id: body.representationId,
    source_unit_id: body.sourceUnitId, asset_id: 'asset-1', locator, state: 'complete', text: 'Revenue grew 10%',
    text_start_utf16: 0, text_start_codepoint: 0, text_total_utf16: 16, quote: body.quote,
    binding: { grounded: true, method: 'exact' }, deep_link: `/api/v2/sources/${sv}/content`, ...W,
    caseKind: body.caseKind, caseId: body.caseId, sourceVersionId: sv, analysisReceiptId: body.analysisReceiptId,
    selected: true, operationId: 'op-1', usage, ...extra };
}

/** Installs the fake backend. respond(route, body) builds the success JSON. */
function withServer(respond, run) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    const status = verify(url, init);
    if (status) return new Response(JSON.stringify({ message: 'denied' }), { status });
    const route = new URL(url).pathname.split('/').slice(-2).join('/');
    // Production CreditsHeaderInterceptor adds this property alongside the source payload.
    return new Response(JSON.stringify({ ...respond(route, JSON.parse(init.body)), credit_usage: {
      credits_used: 0, credits_remaining: null, monthly_allocation: null,
      overage_enabled: null, operation_id: null,
    } }), { status: 200 });
  };
  return Promise.resolve().then(() => run(calls)).finally(() => { global.fetch = original; });
}
const client = (workspace = W) => new WebCiteProductClient({ apiKey: 'key', delegationSecret: SECRET,
  workspace, baseUrl: 'https://webcite.invalid/api/v1' });
const respondDefault = (route, body) => route === 'context/query' ? queryResponse(body)
  : previewResponse(decodeURIComponent(route.split('/')[0]), body);
const QUERY = { caseKind: 'deal', caseId: 'deal-1', contextPath: PATH, sourceVersionIds: [SV, SV2],
  text: 'What did revenue do?', evidence: { include: ['passages', 'notes'], maxItems: 2 } };
const PREVIEW = { caseKind: 'deal', caseId: 'deal-1', sourceVersionId: SV, analysisReceiptId: RECEIPT,
  representationId: 'rep-1', sourceUnitId: 'unit-1' };
const outputError = (e) => e.code === 'invalid_api_output';
const argumentError = (e) => e.code === 'invalid_argument';

test('context query signs the exact route, audience, body and workspace and decodes composed evidence', async () => {
  await withServer(respondDefault, async (calls) => {
    const result = await client().queryContext(QUERY);
    assert.equal(result.credit_usage.credits_used, 0);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, '/api/v2/integrations/product/sources/context/query');
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.maxHops, 1); assert.equal(sent.limit, 10);
    assert.equal(result.composedEvidence.version, 'product-query-evidence/1');
    assert.deepEqual(result.composedEvidence.items.map((i) => i.origin), ['source_statement', 'user_assertion']);
    assert.equal(result.composedEvidence.receipt, null);
    assert.deepEqual(result.contextScopes.map((s) => s.scope), ['meeting', 'company']);

    // The fake backend discriminates: replaying the signed call with one thing wrong is rejected.
    const { url, init } = calls[0];
    const token = init.headers['x-webcite-delegation'];
    const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    const resign = (fields) => ({ ...init, headers: { ...init.headers, 'x-webcite-delegation': sign({ ...payload, ...fields }) } });
    assert.equal(verify(url, init), null, 'positive control');
    assert.equal(verify(url.replace('context/query', `${SV}/preview`), init), 403, 'wrong route');
    assert.equal(verify(url, resign({ aud: 'webcite-product-source-preview' })), 403, 'wrong audience');
    assert.equal(verify(url, { ...init, body: JSON.stringify({ ...sent, text: 'Other question' }) }), 403, 'wrong body');
    assert.equal(verify(url, { ...init, body: JSON.stringify({ ...sent, limit: undefined }) }), null, 'parsed default control');
    assert.equal(verify(url, { ...init, body: JSON.stringify({ ...sent, limit: 5 }) }), 403, 'changed limit');
    assert.equal(verify(url, resign({ workspaceId: 'org-2' })), 403, 'wrong workspace');
    assert.equal(verify(url, resign({ caseId: 'deal-2' })), 403, 'wrong case');
  });
});

test('a client bound to another workspace is refused and responses for another workspace or case are rejected', async () => {
  await withServer(respondDefault, async () => {
    await assert.rejects(() => client(OTHER).queryContext(QUERY), (e) => e.status === 403);
  });
  const variants = [
    (b) => queryResponse(b, { workspaceId: 'org-2' }),
    (b) => queryResponse(b, { caseId: 'deal-2' }),
    (b) => queryResponse(b, { sourceVersionIds: [SV] }),
    (b) => queryResponse(b, { contextPath: PATH.slice(0, 1) }),
    (b) => queryResponse(b, { operationId: 'op-other' }),
    (b) => queryResponse(b, { refs: [ref('sv-foreign', 'meeting')] }),
    (b) => queryResponse(b, { refs: [ref(SV, 'company')] }),
    (b) => queryResponse(b, { contextScopes: undefined }),
    (b) => queryResponse(b, { composedEvidence: undefined }),
    (b) => queryResponse(b, { composedEvidence: composed(['passages', 'notes', 'findings']) }),
    (b) => queryResponse(b, { composedEvidence: { ...composed(), budgets: { ...composed().budgets, usedItems: 3 } } }),
    (b) => queryResponse(b, { composedEvidence: { ...composed(), budgets: { ...composed().budgets, maxItems: 100 } } }),
    (b) => queryResponse(b, { composedEvidence: { ...composed(), version: 'product-query-evidence/2' } }),
    (b) => queryResponse(b, { composedEvidence: { ...composed(), receipt: { hash: 'x' } } }),
    (b) => queryResponse(b, { analysisReceipts: { [SV]: H('9'), [SV2]: RECEIPT2 } }),
  ];
  for (const [index, respond] of variants.entries()) {
    await withServer((route, body) => respond(body), async () => {
      await assert.rejects(() => client().queryContext(QUERY), outputError, `variant ${index}`);
    });
  }
  // Unrequested origins are rejected even when the evidence block is otherwise well formed.
  await withServer((route, body) => queryResponse(body, { composedEvidence: { ...composed(['passages']),
    items: composed().items } }), async () => {
    await assert.rejects(() => client().queryContext({ ...QUERY, evidence: { include: ['passages'], maxItems: 2 } }), outputError);
  });
});

test('older context responses without composedEvidence or contextScopes still decode', async () => {
  const legacy = (route, body) => {
    const { contextScopes: _s, composedEvidence: _e, ...rest } = queryResponse(body);
    return { ...rest, refs: [ref(SV)] };
  };
  await withServer(legacy, async () => {
    const result = await client().queryContext({ caseKind: 'deal', caseId: 'deal-1',
      contextPath: PATH.slice(0, 1), sourceVersionIds: [SV, SV2], text: 'What did revenue do?' });
    assert.equal(result.composedEvidence, undefined);
    assert.equal(result.contextScopes, undefined);
    assert.equal(result.refs.length, 1);
    // A receipt reference (once B2 retains it) decodes too.
  });
  await withServer((route, body) => queryResponse(body, { composedEvidence: { ...composed(),
    receipt: { hash: H('4'), contentHash: H('5'), certification: 'input_evidence_only' } } }), async () => {
    assert.equal((await client().queryContext(QUERY)).composedEvidence.receipt.hash, H('4'));
  });
});

test('invalid context query requests are rejected before any call', async () => {
  await withServer(respondDefault, async (calls) => {
    const bad = [
      { ...QUERY, contextPath: undefined },
      { ...QUERY, evidence: { include: [] } },
      { ...QUERY, evidence: { include: ['passages', 'passages'] } },
      { ...QUERY, evidence: { include: ['memos'] } },
      { ...QUERY, evidence: { include: ['notes'], maxItems: 2001 } },
      { ...QUERY, evidence: { include: ['notes'], extra: true } },
      { ...QUERY, text: ' padded ' },
      { ...QUERY, limit: 21 },
      { ...QUERY, unknownField: 1 },
      { ...QUERY, caseKind: 'Deal' },
      { caseKind: 'deal', caseId: 'deal-1', text: 'q' },
    ];
    for (const options of bad) await assert.rejects(() => client().queryContext(options), argumentError);
    assert.equal(calls.length, 0);
  });
  assert.throws(() => new WebCiteProductClient({ apiKey: 'k', delegationSecret: 'short', workspace: W }), argumentError);
  assert.throws(() => new WebCiteProductClient({ apiKey: 'k', delegationSecret: SECRET,
    workspace: { ...W, workspaceKind: 'user' } }), argumentError);
});

test('source preview signs the unit route and decodes text, cells, region and unmatched targets', async () => {
  const targets = {
    text: { kind: 'text', status: 'matched', source: 'quote', method: 'exact', truncated: false,
      frame: { coordinateSystem: 'pdf-points-top-left-v1', width: 612, height: 792, rotation: 0 },
      matches: [{ span, boxes: [[10, 20, 100, 32]] }] },
    cells: { kind: 'cells', status: 'matched', source: 'selector', method: 'cells', truncated: false,
      sheet: 'P&L', matches: [{ span: null, ranges: ['B2:C3'], wholeRows: [] }] },
    region: { kind: 'region', status: 'matched', source: 'selector', method: 'image', truncated: false, page: 2,
      matches: [{ span: null, boxes: [[0, 0, 10, 10]], polygon: [[0, 0], [10, 0], [10, 10]],
        pixelWidth: 100, pixelHeight: 100, polygonSource: 'caller_supplied' }] },
    unmatched: { kind: 'unmatched', source: 'quote', reason: 'not_found' },
  };
  const requests = {
    text: { ...PREVIEW, quote: 'Revenue grew' },
    cells: { ...PREVIEW, selector: { kind: 'cells', representationId: 'rep-1', sheet: 'P&L', ranges: ['B2:C3'] } },
    region: { ...PREVIEW, selector: { kind: 'image', representationId: 'rep-1', imageId: 'img-1',
      polygon: [[0, 0], [10, 0], [10, 10]], pixelWidth: 100, pixelHeight: 100, parentTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1] } },
    unmatched: { ...PREVIEW, quote: 'Not in the unit' },
  };
  for (const kind of Object.keys(targets)) {
    await withServer((route, body) => previewResponse(SV, body, { target: targets[kind] }), async (calls) => {
      const result = await client().previewSource(requests[kind]);
      assert.equal(result.credit_usage.credits_used, 0);
      assert.equal(result.target.kind, kind);
      assert.equal(new URL(calls[0].url).pathname, `/api/v2/integrations/product/sources/${SV}/preview`);
      const sent = JSON.parse(calls[0].init.body);
      assert.equal(Object.hasOwn(sent, 'sourceVersionId'), false);
      assert.equal(verify(calls[0].url.replace(SV, SV2), calls[0].init), 403, 'previewHash binds the route source');
    });
  }
  // Tokens selectors travel with their quote.
  await withServer((route, body) => previewResponse(SV, body, { target: { ...targets.text, source: 'selector', method: 'tokens' } }), async () => {
    const result = await client().previewSource({ ...PREVIEW, quote: 'Revenue grew',
      selector: { kind: 'tokens', representationId: 'rep-1', first: 0, lastExclusive: 2 } });
    assert.equal(result.target.method, 'tokens');
  });
});

test('older previews without target decode, and wrong or unrequested targets are rejected', async () => {
  await withServer((route, body) => previewResponse(SV, body), async () => {
    const result = await client().previewSource({ ...PREVIEW, quote: 'Revenue grew' });
    assert.equal(result.target, undefined);
    assert.equal(result.selected, true);
  });
  const textTarget = { kind: 'text', status: 'matched', source: 'quote', method: 'exact', truncated: false, matches: [{ span }] };
  const bad = [
    [PREVIEW, { target: textTarget }],
    [{ ...PREVIEW, quote: 'q' }, { target: { ...textTarget, kind: 'video' } }],
    [{ ...PREVIEW, quote: 'q' }, { target: { ...textTarget, source: 'selector' } }],
    [{ ...PREVIEW, quote: 'q' }, { target: { ...textTarget, matches: [] } }],
    [{ ...PREVIEW, quote: 'q' }, { target: { ...textTarget, matches: [{ span: { ...span, endUtf16: -1 } }] } }],
    [{ ...PREVIEW, quote: 'q' }, { target: { kind: 'unmatched', source: 'quote', reason: 'guess' } }],
    [PREVIEW, { workspaceId: 'org-2' }],
    [PREVIEW, { caseId: 'deal-2' }],
    [PREVIEW, { source_unit_id: 'unit-2' }],
    [PREVIEW, { analysisReceiptId: H('9') }],
    [PREVIEW, { selected: false }],
  ];
  for (const [index, [request, extra]] of bad.entries()) {
    await withServer((route, body) => previewResponse(SV, body, extra), async () => {
      await assert.rejects(() => client().previewSource(request), outputError, `variant ${index}`);
    });
  }
  await withServer((route, body) => previewResponse(SV, body, { selected: false }), async () => {
    assert.equal((await client().previewSource({ ...PREVIEW, historical: true })).selected, false);
  });
});

test('invalid preview selectors are rejected before any call', async () => {
  const image = { kind: 'image', representationId: 'rep-1', imageId: 'img-1', polygon: [[0, 0], [10, 0], [10, 10]],
    pixelWidth: 100, pixelHeight: 100, parentTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  await withServer(respondDefault, async (calls) => {
    const bad = [
      { ...PREVIEW, selector: { kind: 'tokens', representationId: 'rep-1', first: 0, lastExclusive: 2 } },
      { ...PREVIEW, quote: 'q', selector: { kind: 'cells', representationId: 'rep-1', sheet: 'S', ranges: ['A1'] } },
      { ...PREVIEW, selector: { kind: 'tokens', representationId: 'rep-1', first: 2, lastExclusive: 2 }, quote: 'q' },
      { ...PREVIEW, selector: { kind: 'cells', representationId: 'rep-1', sheet: 'S', ranges: [] } },
      { ...PREVIEW, selector: { ...image, polygon: [[0, 0], [10, 0], [20, 0]] } },
      { ...PREVIEW, selector: { ...image, polygon: [[0, 0], [10, 0], [200, 10]] } },
      { ...PREVIEW, selector: { ...image, parentTransform: [0, 0, 0, 0, 0, 0, 0, 0, 0] } },
      { ...PREVIEW, selector: { kind: 'audio', representationId: 'rep-1' } },
      { ...PREVIEW, analysisReceiptId: 'not-a-hash' },
      { ...PREVIEW, quote: 'q'.repeat(1001) },
    ];
    for (const options of bad) await assert.rejects(() => client().previewSource(options), argumentError);
    assert.equal(calls.length, 0);
  });
});

test('the product client imports no DD code', () => {
  const src = path.resolve(__dirname, '../src');
  for (const file of ['api-client.ts', 'types.ts', 'validate.ts', 'errors.ts', 'credit-usage.ts', 'product-client.ts', 'product-validate.ts']) {
    const text = fs.readFileSync(path.join(src, file), 'utf8');
    const specifiers = [...text.matchAll(/(?:from|import|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.ok(specifiers.length > 0, `${file} import scan found nothing`);
    for (const spec of specifiers)
      assert.ok(/^(\.\/[\w-]+\.js|node:[\w/]+)$/.test(spec), `${file} imports ${spec}`);
  }
  // Compiled module graph: only local SDK modules and Node built-ins.
  const dist = fs.readFileSync(path.resolve(__dirname, '../dist/product-client.js'), 'utf8');
  const required = [...dist.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(required.includes('./product-validate.js'), 'positive control: the scan sees local imports');
  for (const spec of required) assert.ok(/^(\.\/[\w-]+\.js|node:[\w/]+)$/.test(spec), `dist imports ${spec}`);
});


test('retained receipt reads preserve input-only certification, used items and explicit historical state', async () => {
  const request = { caseKind: 'deal', caseId: 'deal-1', contextPath: PATH, receiptHash: H('9') };
  const answer = (body) => {
    const { receipt: _receipt, ...evidence } = composed();
    return { receipt: { hash: H('9'), contentHash: H('8'), certification: 'input_evidence_only' },
      inputs: { identity: { ...W, caseKind: body.caseKind, caseId: body.caseId, contextPath: PATH },
        certification: 'input_evidence_only', sources: [{ sourceVersionId: SV, analysisReceiptId: RECEIPT, analysisGraphHash: H('a') }] },
      offeredItemIds: evidence.items.map(item => item.id), usedItemIds: body.usedItemIds ?? null,
      evidence: { ...evidence, items: body.usedItemIds ? evidence.items.filter(item => body.usedItemIds.includes(item.id)) : evidence.items },
      freshness: { status: 'current', reasons: [] }, configurationStatus: 'pinned', applicationPolicyStatus: 'not_assessed' };
  };
  await withServer((_route, body) => answer(body), async calls => {
    const result = await client().readContextReceipt({ ...request, usedItemIds: [H('1')] });
    assert.equal(result.credit_usage.credits_used, 0);
    assert.equal(result.evidence.items.length, 1);
    assert.equal(result.receipt.certification, 'input_evidence_only');
    const { url, init } = calls[0];
    assert.equal(verify(url, init), null);
    assert.equal(verify(url, { ...init, body: JSON.stringify({ ...request, usedItemIds: [H('2')] }) }), 403);
    await assert.rejects(() => client().readContextReceipt({ ...request, usedItemIds: [] }), argumentError);
  });
  const variants = [
    b => ({ ...answer(b), receipt: { ...answer(b).receipt, hash: H('7') } }),
    b => ({ ...answer(b), inputs: { ...answer(b).inputs, identity: { ...answer(b).inputs.identity, workspaceId: 'foreign' } } }),
    b => ({ ...answer(b), freshness: { status: 'historical', reasons: ['source_changed'] } }),
    b => ({ ...answer(b), usedItemIds: [H('1')] }),
    b => ({ ...answer(b), applicationPolicyStatus: 'approved' }),
  ];
  for (const variant of variants) await withServer((_route, body) => variant(body), async () => {
    await assert.rejects(() => client().readContextReceipt(request), outputError);
  });
  await withServer((_route, body) => ({ ...answer(body), freshness: { status: 'historical', reasons: ['source_changed'] } }), async () => {
    assert.equal((await client().readContextReceipt({ ...request, requireCurrent: false })).freshness.status, 'historical');
  });
  const notesOnly = body => {
    const result = answer(body);
    return { ...result, inputs: { ...result.inputs, sources: [{ sourceVersionId: SV,
      analysisReceiptId: null, analysisGraphHash: null }] }, offeredItemIds: [H('2')],
    evidence: { ...result.evidence, include: ['notes'], items: result.evidence.items.filter(item => item.origin === 'user_assertion'),
      omitted: [], budgets: { ...result.evidence.budgets, usedItems: 1 } } };
  };
  await withServer((_route, body) => notesOnly(body), async () => {
    assert.equal((await client().readContextReceipt(request)).inputs.sources[0].analysisReceiptId, null);
  });
  await withServer((_route, body) => ({ ...answer(body), inputs: notesOnly(body).inputs }), async () => {
    await assert.rejects(() => client().readContextReceipt(request), outputError);
  });
  const findingAnswer = body => {
    const result = answer(body);
    const scope = { subject: 'Target', predicate: null, metric: null, period: null,
      basis: null, unit: null, currency: null, dimensions: [] };
    const finding = { id: H('4'), state: 'needs_evidence', description: 'Compare wording',
      reconciliationQuestion: 'Does the scope match?', essentialScope: ['subject', 'period'],
      essentialDimensions: [], limitations: ['Period unknown'],
      occurrences: [0, 1].map(index => ({ claim: 'Revenue grew', scope, anchor: {
        sourceVersionId: index ? SV2 : SV, analysisReceiptId: index ? RECEIPT2 : RECEIPT, originalBytesHash: H('a'),
        representationId: 'rep-1', sourceUnitId: `unit-${index}`, sourceUnitHash: H('b'),
        locator, quote: 'Revenue grew', startCodePoint: 0, endCodePoint: 12,
      } })) };
    return { ...result, inputs: { ...result.inputs, query: { sourceVersionIds: [SV] },
      sources: [...result.inputs.sources, { sourceVersionId: SV2, analysisReceiptId: RECEIPT2, analysisGraphHash: H('b') }] },
    offeredItemIds: [H('4')], evidence: { ...result.evidence,
      include: ['findings'], omitted: [], budgets: { ...result.evidence.budgets, usedItems: 1 },
      items: [{ id: H('4'), origin: 'source_reconciliation', findingId: finding.id,
        findingsManifestHash: H('5'), corpusHash: H('6'), finding }] } };
  };
  await withServer((_route, body) => findingAnswer(body), async () => {
    assert.equal((await client().readContextReceipt(request)).evidence.items[0].origin, 'source_reconciliation');
  });
  await withServer((_route, body) => ({ ...findingAnswer(body), inputs: notesOnly(body).inputs }), async () => {
    await assert.rejects(() => client().readContextReceipt(request), outputError);
  });
});

test('memory-only queries require receipts only for sources actually read', async () => {
  const { evidence: _evidence, text: _text, ...base } = QUERY;
  const request = { ...base, memoryOnly: true };
  const response = (body, analysisReceipts) => queryResponse(body, {
    status: 'memory_only', refs: [], analysisReceipts,
  });
  await withServer((_route, body) => response(body, {}), async () => {
    assert.deepEqual((await client().queryContext(request)).analysisReceipts, {});
    assert.deepEqual((await client().queryContext({ ...request, automaticExtractionSelections: [] })).analysisReceipts, {});
  });
  const metrics = [{ key: 'arr', label: 'ARR', unit: 'currency' }];
  const pinned = { ...request, automaticExtractionSelections: [{ sourceVersionId: SV,
    request: { analysisReceiptId: RECEIPT, metrics, metricConfigHash: contentHash(metrics) }, read: { manifestHash: H('c') } }] };
  await withServer((_route, body) => response(body, { [SV]: RECEIPT }), async () => {
    assert.deepEqual((await client().queryContext(pinned)).analysisReceipts, { [SV]: RECEIPT });
    await assert.rejects(() => client().queryContext(QUERY), outputError);
  });
  await withServer((_route, body) => response(body, {}), async () => {
    await assert.rejects(() => client().queryContext(pinned), outputError);
  });
});
