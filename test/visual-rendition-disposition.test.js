const test = require('node:test');
const assert = require('node:assert/strict');
const { WebCiteApiClient } = require('../dist/api-client.js');
const { handlers } = require('../dist/handlers.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require('../dist/index.js');
const asset = '12345678-1234-4234-8234-123456789abc';
const reference = { representation_id: 'visual-rep', unit_key: 'visual-page:1:element:2' };
const input = { asset_id: asset, visual_rendition: true, source_version_id: 'version-1', idempotency_key: 'visual-case-1' };
const visual = { format: 'image', markdown: 'Contents', state: 'partial', complete: false,
  source_version_id: 'version-1', representation_id: 'visual-rep', source_read_status: 'partial',
  visual_provenance: { origin: 'model_generated', source_bytes_hash: 'a'.repeat(64) },
  source_units: [{ sourceUnitId: 'visual-unit-2', locator: { kind: 'page', page: 1 }, state: 'partial' }],
  provider_usage_status: 'inspect_operation_receipts', credit_usage: { credits_used: 1, credits_remaining: 9, monthly_allocation: 10 } };
const action = { review_id: 'review-1', asset_id: asset, start: 0, end: 8, source_quote: 'Contents', rationale: 'An explicit navigation label', visual_evidence: reference };

test('real HTTP handler retains explicit partial visual rendition and exact operation key', async () => {
  const prior = global.fetch; const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); return Response.json(visual); };
  try {
    const result = await handlers.extract_document(input, new WebCiteApiClient('fake-key', 'https://example.test'));
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, '/api/v1/extract/visual-rendition');
    assert.equal(calls[0].options.headers['Idempotency-Key'], input.idempotency_key);
    assert.deepEqual(JSON.parse(calls[0].options.body), { asset_id: asset, visual_rendition: true, source_version_id: 'version-1' });
    assert.deepEqual(result.structuredContent, visual);
    assert.equal(result.structuredContent.units, undefined);
    assert.match(result.text, /partial|Partial/);
  } finally { global.fetch = prior; }
});

for (const bad of [ { ...input, idempotency_key: undefined }, { ...input, source_version_id: ' version-1' },
  { ...input, asset_url: 'https://example.test/source.jpg' }, { ...input, visual_rendition: 'true' },
  { asset_id: asset, source_version_id: 'version-1' }, { ...input, idempotency_key: 'bad key' } ]) {
  test('invalid visual operation refuses before actual HTTP dispatch ' + JSON.stringify(bad), async () => {
    let fetches = 0; const prior = global.fetch; global.fetch = () => { fetches++; throw Error('dispatch denied'); };
    try {
      await assert.rejects(handlers.extract_document(bad, new WebCiteApiClient('fake-key', 'https://example.test')), /visual|source|idempotency/i);
      assert.equal(fetches, 0);
    } finally { global.fetch = prior; }
  });
}

test('normal extraction remains ordinary and no idempotency header is invented', async () => {
  let passed; const ordinary = { format: 'txt', markdown: 'Text', units: [] };
  const result = await handlers.extract_document({ asset_id: asset }, { extractDocument: async args => { passed = args; return ordinary; } });
  assert.deepEqual(passed, { asset_id: asset, asset_url: undefined }); assert.deepEqual(result.structuredContent, ordinary);
});

test('unknown role is readable without becoming structural proof', async () => {
  const unknown = { asset_id: asset, start: 0, end: 8, source_quote: 'Contents', role: 'unknown' };
  const result = await handlers.get_review_source_span(action, { getDocumentReviewSourceSpan: async () => unknown });
  assert.deepEqual(result.structuredContent, unknown); assert.match(result.text, /unknown/);
});

test('real HTTP nonclaim action forwards only visual reference and validates saved identity', async () => {
  const prior = global.fetch; let sent;
  const saved = { ...action, reviewer_id: 'actor-1', reviewed_at: '2026-10-03T08:00:00Z',
    visual_evidence: { ...reference, origin: 'model_generated_layout' } }; delete saved.review_id;
  global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return Response.json(saved); };
  try {
    const result = await handlers.record_review_nonclaim(action, new WebCiteApiClient('fake-key', 'https://example.test'));
    assert.deepEqual(sent.visual_evidence, reference); assert.deepEqual(result.structuredContent, saved);
    global.fetch = async () => Response.json({ ...saved, visual_evidence: { ...saved.visual_evidence, unit_key: 'visual-page:1:element:3' } });
    await assert.rejects(handlers.record_review_nonclaim(action, new WebCiteApiClient('fake-key', 'https://example.test')), /visual|identity|incomplete/i);
  } finally { global.fetch = prior; }
});

for (const evidence of [{ ...reference, role: 'page_footer' }, { ...reference, bbox: [0,0,1,1] }, { ...reference, unit_key: 'cell:1' }, { ...reference, representation_id: ' visual-rep' }]) {
  test('client visual role/geometry or malformed identity refuses before nonclaim write', async () => {
    let writes = 0;
    await assert.rejects(handlers.record_review_nonclaim({ ...action, visual_evidence: evidence }, { recordDocumentReviewNonclaim: async () => { writes++; return {}; } }), /visual/i);
    assert.equal(writes, 0);
  });
}

test('malformed paid visual result retains credit receipt without retry', async () => {
  let calls = 0;
  await assert.rejects(handlers.extract_document(input, { extractDocument: async () => { calls++; return { ...visual, source_version_id: 'wrong-version' }; } }), error => {
    assert.deepEqual(error.toPayload().credit_usage, visual.credit_usage);
    assert.match(error.toPayload().actionable, /repeat|resubmit|retry/i); return true;
  }); assert.equal(calls, 1);
});

for (const units of [undefined, [], [{ sourceUnitId: ' unit-1', locator: { kind: 'page', page: 1 }, state: 'partial' }],
  [{ sourceUnitId: 'unit-1', locator: { kind: 'page', page: 0 }, state: 'partial' }],
  [visual.source_units[0], visual.source_units[0]]]) {
  test('unusable visual locator refuses and retains original paid receipt', async () => {
    await assert.rejects(handlers.extract_document(input, { extractDocument: async () => ({ ...visual, source_units: units }) }), error => {
      assert.equal(error.code, 'invalid_api_output'); assert.deepEqual(error.toPayload().credit_usage, visual.credit_usage); return true;
    });
  });
}

test('actual MCP tool boundary exposes same existing names and visual options', async () => {
  let received, bound;
  const server = createMcpServer({ extractDocument: async args => { received = args; return visual; },
    readSourceUnit: async (version, rep, unit) => {
      assert.deepEqual([version, rep, unit], ['version-1', 'visual-rep', 'visual-unit-2']);
      return { sourceVersionId: version, representationId: rep, sourceUnitId: unit,
        unitKey: reference.unit_key, content: 'Contents', state: 'partial', native: { visual_element: { type: 'section_header' } } };
    },
    getDocumentReviewSourceSpan: async () => ({ asset_id: asset, start: 0, end: 8, source_quote: 'Contents', role: 'unknown' }),
    recordDocumentReviewNonclaim: async (_review, args) => { bound = args; return { ...args,
      reviewer_id: 'actor-1', reviewed_at: '2026-10-03T08:00:00Z', visual_evidence: { ...args.visual_evidence, origin: 'model_generated_layout' } }; },
  }, 'public', true);
  const client = new Client({ name: 'visual-control', version: '1' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const catalog = await client.listTools(); assert.equal(catalog.tools.length, 33);
    const extract = catalog.tools.find(row => row.name === 'extract_document');
    assert.equal(extract.inputSchema.properties.visual_rendition.type, 'boolean');
    const result = await client.callTool({ name: 'extract_document', arguments: input });
    assert.ok(!result.isError, JSON.stringify(result)); assert.deepEqual(received, { ...input, asset_url: undefined });
    assert.equal(result.structuredContent.complete, false);
    const unit = await client.callTool({ name: 'read_source_unit', arguments: {
      source_version_id: result.structuredContent.source_version_id, representation_id: result.structuredContent.representation_id,
      source_unit_id: result.structuredContent.source_units[0].sourceUnitId,
    } });
    const span = await client.callTool({ name: 'get_review_source_span', arguments: {
      review_id: action.review_id, asset_id: asset, start: 0, end: 8,
    } });
    assert.equal(span.structuredContent.role, 'unknown');
    const recorded = await client.callTool({ name: 'record_review_nonclaim', arguments: { ...action,
      source_quote: span.structuredContent.source_quote,
      visual_evidence: { representation_id: unit.structuredContent.representationId, unit_key: unit.structuredContent.unitKey },
    } });
    assert.ok(!recorded.isError, JSON.stringify(recorded)); assert.deepEqual(bound.visual_evidence, reference);
  } finally { await client.close(); await server.close(); }
});

test('old server missing visual route fails without ordinary-extract fallback or second dispatch', async () => {
  const prior = global.fetch; const urls = [];
  global.fetch = async url => { urls.push(new URL(url).pathname); return Response.json({ message: 'Cannot POST /api/v1/extract/visual-rendition' }, { status: 404 }); };
  try {
    await assert.rejects(handlers.extract_document(input, new WebCiteApiClient('fake-key', 'https://example.test')), /404|not found|Cannot POST/i);
    assert.deepEqual(urls, ['/api/v1/extract/visual-rendition']);
  } finally { global.fetch = prior; }
});


test('extraction return types preserve ordinary compile consumers and narrow explicit visual opt-in', () => {
  const ts = require('typescript');
  const path = require('node:path');
  const filename = path.resolve(__dirname, 'visual-extraction-consumer.ts');
  const source = `
    import { WebCiteApiClient } from '../dist/api-client.js';
    import type { AssetRefOptions, ExtractDocumentOptions, ExtractedDoc, VisualRendition } from '../dist/types.js';
    declare const client: WebCiteApiClient;
    declare const ordinary: AssetRefOptions;
    declare const dynamic: ExtractDocumentOptions;
    async function consume() {
      const old = await client.extractDocument({ asset_id: 'asset' }); old.units;
      const typed: ExtractedDoc = await client.extractDocument(ordinary);
      const disabled: ExtractedDoc = await client.extractDocument({ asset_id: 'asset', visual_rendition: false });
      const visual: VisualRendition = await client.extractDocument({ asset_id: 'asset', visual_rendition: true });
      // @ts-expect-error Visual evidence does not become ordinary extracted units.
      visual.units;
      const uncertain: ExtractedDoc | VisualRendition = await client.extractDocument(dynamic);
      // @ts-expect-error A dynamic opt-in cannot promise ordinary units.
      uncertain.units;
    }
  `;
  const options = { noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, fresh) => name === filename
    ? ts.createSourceFile(name, source, version, true) : getSourceFile(name, version, onError, fresh);
  const program = ts.createProgram([filename], options, host);
  const errors = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')), []);
});

test('null visual response fails as invalid_api_output without fabricated credit receipt', async () => {
  const prior = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; return Response.json(null); };
  try {
    await assert.rejects(handlers.extract_document(input, new WebCiteApiClient('fake-key', 'https://example.test')), error => {
      assert.equal(error.toPayload().code, 'invalid_api_output');
      assert.equal(error.toPayload().credit_usage, undefined);
      return true;
    });
    assert.equal(calls, 1);
  } finally { global.fetch = prior; }
});
