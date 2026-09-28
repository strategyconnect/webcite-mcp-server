const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiClientError } = require('../dist/api-client.js');
const { formatAnalyzeResult } = require('../dist/formatters.js');
const { createMcpServer } = require('../dist/index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

async function withPublicClient(api, run) {
  const server = createMcpServer(api, 'public');
  const client = new Client({ name: 'public-tool-contract-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await run(client); } finally { await client.close(); await server.close(); }
}

test('source search and preview retain every paid source and the full preview text', async () => {
  const first = { id: 'one', title: 'First report', url: 'https://official.example/one.pdf' };
  const second = { id: 'two', title: 'Second report', url: 'https://official.example/two.pdf' };
  const search = { citations: [], claim_groups: [{ claim: 'First', citations: [first] },
    { claim: 'Second', citations: [second] }], totalResults: 2, thread_id: 'thread-1' };
  const longText = 'A'.repeat(9000) + ' decisive source passage';
  const preview = { kind: 'web', url: second.url, deep_link: second.url,
    binding: { grounded: true, method: 'exact' }, text: longText };
  await withPublicClient({ searchSources: async () => search, sourcePreview: async () => preview }, async (client) => {
    const found = await client.callTool({ name: 'search_sources', arguments: { query: 'official reports' } });
    assert.equal(found.isError, undefined);
    assert.match(found.content[0].text, /First report/);
    assert.match(found.content[0].text, /Second report/);
    assert.deepEqual(found.structuredContent, search);
    const shown = await client.callTool({ name: 'get_source_preview', arguments: { url: second.url } });
    assert.equal(shown.structuredContent.text, longText);
    assert.match(shown.content[0].text, /full preview.*structuredContent/i);
  });
});

test('analysis, gaps and accuracy expose full structured results', async () => {
  const analysis = { conflicts: [], recomputations: [{ metric: 'gross_margin', unit: 'percent', state: 'conflicting',
    conflictKind: 'input', observationIds: ['obs-1', 'obs-2'], inputs: [] }],
    review: { needs_review: true, reasons: ['Check table note'] },
    provenance: { source: 'sheet-2' } };
  const gaps = { items: [{ name: 'Audited accounts', present: false }], status: 'advisory' };
  const accuracy = { pass: false, totals: { deals: 2, figures: 10, conflicts: {
    expected: 2, found: 1, flagged: 1, falsePositives: 0, detectionRate: 0.5, precision: 1 },
    recompute: { checked: 3, correct: 2 } }, deals: [{ id: 'case-1', reason: 'rounding' }] };
  await withPublicClient({ analyzeConflicts: async () => analysis, documentGaps: async () => gaps,
    accuracyReport: async () => accuracy }, async (client) => {
    const result = await client.callTool({ name: 'analyze_conflicts', arguments: {
      figures: [{ metric: 'Assets', value: 1, unit: 'USD', provenance: { method: 'text' } }] } });
    assert.deepEqual(result.structuredContent, analysis);
    assert.match(result.content[0].text, /conflicting input values; observations obs-1, obs-2/);
    assert.doesNotMatch(result.content[0].text, /computed undefined/);
    const checklist = await client.callTool({ name: 'document_gaps', arguments: { category: 'financials' } });
    assert.deepEqual(checklist.structuredContent, gaps);
    const report = await client.callTool({ name: 'accuracy_report', arguments: {} });
    assert.deepEqual(report.structuredContent, accuracy);
  });
});

test('unsupported JPEG numeric analysis gives the supported document path without a retry', async () => {
  await withPublicClient({ analyzeDocument: async () => {
    throw new ApiClientError(400, '{"message":"Unsupported document type \\"jpeg\\" (xlsx/xls/csv/pdf)."}');
  } }, async (client) => {
    const result = await client.callTool({ name: 'analyze_document', arguments: { asset_id: 'image-asset' } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'invalid_argument');
    assert.match(result.content[0].text, /extract_document.*review_document/);
    assert.match(result.content[0].text, /Do not retry analyze_document/);
  });
});

test('structured credit errors retain credit amounts and stop guidance', () => {
  const failure = new ApiClientError(402, '{"code":"INSUFFICIENT_CREDITS","credits_required":4,"credits_remaining":1}')
    .toToolFailure().toPayload();
  assert.equal(failure.code, 'credit_exhausted');
  assert.equal(failure.details.required, 4);
  assert.equal(failure.details.remaining, 1);
  assert.match(failure.actionable, /Stop chargeable calls/);
});

test('feedback retains its recorded receipt and unknown failures avoid blind paid retries', async () => {
  await withPublicClient({ verifyFeedback: async () => ({ recorded: true, receipt_id: 'receipt-1' }),
    searchSources: async () => { throw new Error('socket closed after request'); } }, async (client) => {
    const feedback = await client.callTool({ name: 'verify_feedback', arguments: { token: 'token-1', verdict: 'correct' } });
    assert.deepEqual(feedback.structuredContent, { recorded: true, receipt_id: 'receipt-1', verdict: 'correct' });
    const failed = await client.callTool({ name: 'search_sources', arguments: { query: 'official source' } });
    assert.equal(failed.isError, true);
    assert.match(failed.structuredContent.actionable, /saved operation before repeating/);
    assert.doesNotMatch(failed.structuredContent.actionable, /retry chargeable calls/i);
  });
});

test('search contract drift does not become an empty successful search', async () => {
  await withPublicClient({ searchSources: async () => ({ totalResults: 0 }) }, async (client) => {
    const result = await client.callTool({ name: 'search_sources', arguments: { query: 'official source' } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'invalid_api_output');
    assert.match(result.content[0].text, /Do not treat this as no sources/);
  });
  await withPublicClient({ searchSources: async () => ({ citations: [], claim_groups: [], totalResults: 0 }) }, async (client) => {
    const result = await client.callTool({ name: 'search_sources', arguments: { query: 'impossible source' } });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /No sources found/);
  });
});

test('missing extraction and checklist fields cannot become empty successes', async () => {
  await withPublicClient({ extractDocument: async () => ({ format: 'jpeg' }),
    extractFigures: async () => ({}), documentGaps: async () => ({}) }, async (client) => {
    for (const [name, args] of [
      ['extract_document', { asset_id: 'asset-1' }],
      ['extract_figures', { asset_id: 'asset-1' }],
      ['document_gaps', { category: 'financials' }],
    ]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true, name);
      assert.equal(result.structuredContent.code, 'invalid_api_output', name);
      assert.match(result.content[0].text, /Do not infer missing data/, name);
    }
  });
});

test('completed claim streams preserve progress and result events', async () => {
  const result = { claim_groups: [], totalResults: 0, thread_id: 'thread-1' };
  const frames = [{ event: 'message', data: { type: 'progress', data: { step: 'search' } } },
    { event: 'message', data: { type: 'result', data: result } },
    { event: 'message', data: { type: 'done' } }];
  await withPublicClient({ verifyClaimStream: async function* () { yield* frames; } }, async (client) => {
    const checked = await client.callTool({ name: 'verify_claim_stream', arguments: { claim: 'A claim' } });
    assert.equal(checked.isError, undefined);
    assert.deepEqual(checked.structuredContent.stream_events, frames);
  });
});

test('an ask result cannot silently accept a saved review ID', async () => {
  let askCalls = 0;
  await withPublicClient({ getAskResult: async () => { askCalls++; return { status: 'done' }; } }, async (client) => {
    const result = await client.callTool({ name: 'get_ask_result', arguments: { id: 'a'.repeat(64) } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'invalid_argument');
    assert.match(result.content[0].text, /get_document_review.*zero credits/);
    assert.equal(askCalls, 0);
    const ask = await client.callTool({ name: 'get_ask_result', arguments: { id: '28243504-35b3-4181-943d-1846fe467afa' } });
    assert.equal(ask.structuredContent.status, 'done');
    assert.equal(askCalls, 1);
  });
});

test('claim verification accepts all supplied official sources without an MCP count ceiling', async () => {
  const sources = Array.from({ length: 6 }, (_, i) => `https://official.example/report-${i}.pdf`);
  let received;
  await withPublicClient({ verifyClaim: async (options) => {
    received = options;
    return { claim_groups: [], totalResults: 0, thread_id: 'thread-1' };
  } }, async (client) => {
    const result = await client.callTool({ name: 'verify_claim', arguments: {
      claim: 'Assets rose', source_urls: sources,
    } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(received.source_urls, sources);
  });
});

test('numeric recomputation states never invent a computed value', () => {
  const recomputations = [
    { metric: 'margin', unit: 'percent', state: 'comparable', value: '25', reported: '25', withinTolerance: true, inputs: [] },
    { metric: 'margin', unit: 'percent', state: 'comparison_unavailable', missing: ['revenue'], inputs: [] },
    { metric: 'margin', unit: 'percent', state: 'conflicting', conflictKind: 'input', observationIds: ['a', 'b'], inputs: [] },
    { metric: 'margin', unit: 'percent', state: 'incompatible', mismatches: ['period'], inputs: [] },
  ];
  const text = formatAnalyzeResult({ conflicts: [], recomputations, review: { needs_review: true, reasons: [] } });
  assert.match(text, /computed 25 percent, stated 25/);
  assert.match(text, /comparison unavailable; missing revenue/);
  assert.match(text, /conflicting input values; observations a, b/);
  assert.match(text, /incompatible period/);
  assert.doesNotMatch(text, /undefined|computed null/);
});
