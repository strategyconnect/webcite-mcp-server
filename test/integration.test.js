/**
 * End-to-end: drive the real MCP server over stdio against a stub WebCite API.
 *
 * Asserts two things per tool — the HTTP request it sends (method, path, body),
 * and the artifact it renders back. A tool that "does not throw" but returns a
 * blank or wrong-shaped body fails here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const FIGURE = {
  metric: 'gross_margin',
  value: 62,
  unit: 'percent',
  period: 'FY2024',
  band: 'verified',
  bound: true,
  provenance: {
    assetId: 'a1',
    documentName: 'model.xlsx',
    sheet: 'P&L',
    cell: 'B4',
    method: 'rule',
  },
};

const ANALYSIS = {
  conflicts: [
    {
      metric: 'arr',
      delta: 500000,
      reconciliationQuestion: 'Which ARR is current — the deck or the model?',
      values: [
        { value: 4500000, unit: 'currency', provenance: { ...FIGURE.provenance } },
        {
          value: 5000000,
          unit: 'currency',
          provenance: { assetId: 'a2', documentName: 'deck.pdf', page: 7, method: 'model' },
        },
      ],
    },
  ],
  recomputations: [
    {
      metric: 'gross_margin',
      stated: 62,
      computed: 58,
      unit: 'percent',
      withinTolerance: false,
      inputs: [{ key: 'revenue', value: 1000, provenance: { ...FIGURE.provenance } }],
    },
  ],
  review: { needs_review: true, reasons: ['Recomputed gross_margin does not match the stated value.'] },
};

/** path -> response body the stub returns. */
const ROUTES = {
  '/api/v1/verify/batch': [
    {
      id: 'c1',
      quote: 'Revenue grew 40% in FY2024.',
      binding: { grounded: true, method: 'normalized', score: 0.97, matched_text: 'revenue grew 40% in FY2024' },
      verification: { layer: 'bindback', band: 'verified', confidence: 92, grounded: true },
      feedback_token: 'ft_abc123',
    },
    {
      id: 'c2',
      quote: 'Headcount doubled.',
      binding: { grounded: false, method: 'unbound', score: 0.21 },
      verification: { layer: 'none', band: 'unverified', confidence: 10, grounded: false, review_reason: 'no passage matched' },
      feedback_token: 'ft_def456',
    },
  ],
  '/api/v1/verify/feedback': { recorded: true },
  '/api/v1/analyze/conflicts': ANALYSIS,
  '/api/v1/analyze/document': { ...ANALYSIS, figures: [FIGURE], category: 'financials', covers: ['p&l', 'cap table'] },
  '/api/v1/classify': { category: 'financials', covers: ['p&l', 'cap table'] },
  '/api/v1/gaps': { items: [{ name: 'Cap table', present: true }, { name: 'Bank statements', present: false }] },
  '/api/v1/extract': {
    format: 'xlsx',
    markdown: '# P&L\n\nRevenue 1,000',
    units: [{ kind: 'sheet', index: 1, text: 'Revenue 1,000', provenance: { sheet: 'P&L' } }],
    sheets: [{ name: 'P&L' }],
  },
  '/api/v1/extract/figures': { figures: [FIGURE] },
  '/api/v1/accuracy': {
    pass: true,
    totals: {
      deals: 6,
      figures: 84,
      conflicts: { expected: 12, found: 11, flagged: 12, falsePositives: 1, detectionRate: 0.92, precision: 0.92 },
      recompute: { checked: 30, correct: 30 },
    },
  },
  '/api/v1/citations/source-preview': {
    kind: 'web',
    url: 'https://example.com/report',
    title: 'Annual Report',
    quote: 'revenue grew 40%',
    deep_link: 'https://example.com/report#:~:text=revenue%20grew%2040%25',
    binding: { grounded: true, method: 'exact' },
  },
};

function startStub() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      seen.push({
        method: req.method,
        path: url.pathname,
        apiKey: req.headers['x-api-key'],
        body: body ? JSON.parse(body) : undefined,
      });
      const payload = ROUTES[url.pathname];
      res.writeHead(payload ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload ?? { message: 'not stubbed' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, port: server.address().port }));
  });
}

function startServer(port) {
  const child = spawn('node', [path.join(__dirname, '..', 'dist', 'index.js')], {
    env: { ...process.env, WEBCITE_API_KEY: 'webcite_test_key', WEBCITE_API_URL: `http://127.0.0.1:${port}` },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const resolve = pending.get(msg.id);
      if (resolve) {
        pending.delete(msg.id);
        resolve(msg);
      }
    }
  });
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  return { child, rpc, notify };
}

test('every tool round-trips through the real server against the API', async (t) => {
  const { server, seen, port } = await startStub();
  const { child, rpc, notify } = startServer(port);
  t.after(() => {
    child.kill();
    server.close();
  });

  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'integration', version: '1' },
  });
  assert.equal(init.result.serverInfo.name, 'webcite');
  notify('notifications/initialized');

  const call = async (name, args) => {
    const res = await rpc('tools/call', { name, arguments: args });
    assert.ok(!res.result.isError, `${name} errored: ${res.result.content?.[0]?.text}`);
    const text = res.result.content[0].text;
    assert.ok(text && text.trim().length > 20, `${name} returned a blank artifact`);
    return text;
  };

  await t.test('verify_batch renders per-item binding and feedback tokens', async () => {
    const text = await call('verify_batch', {
      items: [
        { id: 'c1', quote: 'Revenue grew 40% in FY2024.', source_text: 'In FY2024 revenue grew 40%.' },
        { id: 'c2', quote: 'Headcount doubled.', url: 'https://example.com' },
      ],
    });
    const req = seen.at(-1);
    assert.equal(req.method, 'POST');
    assert.equal(req.path, '/api/v1/verify/batch');
    assert.equal(req.apiKey, 'webcite_test_key');
    assert.equal(req.body.items.length, 2);
    assert.match(text, /Grounded:\*\* 1\/2/);
    assert.match(text, /ft_abc123/);
    assert.match(text, /not grounded \(unbound, score 0\.21\)/);
  });

  await t.test('verify_feedback posts the token and verdict', async () => {
    const text = await call('verify_feedback', { token: 'ft_abc123', verdict: 'correct', note: 'checked' });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v1/verify/feedback');
    assert.deepEqual(req.body, { token: 'ft_abc123', verdict: 'correct', note: 'checked' });
    assert.match(text, /Feedback Recorded/);
  });

  await t.test('analyze_conflicts renders conflicts, recomputes and the review flag', async () => {
    const text = await call('analyze_conflicts', { figures: [FIGURE] });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v1/analyze/conflicts');
    assert.equal(req.body.figures[0].metric, 'gross_margin');
    assert.match(text, /needs review/);
    assert.match(text, /Conflicts \(1\)/);
    assert.match(text, /deck\.pdf \(p\.7\) \[model read\]/);
    assert.match(text, /Recomputations \(1\)/);
    assert.match(text, /computed 58 percent, stated 62/);
  });

  await t.test('analyze_document sends asset_id and renders figures plus category', async () => {
    const text = await call('analyze_document', { asset_id: 'a1' });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v1/analyze/document');
    assert.deepEqual(req.body, { asset_id: 'a1' });
    assert.match(text, /Category:\*\* financials/);
    assert.match(text, /Figures \(1\)/);
    assert.match(text, /gross_margin\*\* = 62 percent/);
  });

  await t.test('classify_document forwards the taxonomy', async () => {
    const text = await call('classify_document', { asset_id: 'a1', taxonomy: 'ma' });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v1/classify');
    assert.deepEqual(req.body, { asset_id: 'a1', taxonomy: 'ma' });
    assert.match(text, /Category:\*\* financials/);
    assert.match(text, /cap table/);
  });

  await t.test('document_gaps renders the present/absent checklist', async () => {
    const text = await call('document_gaps', { category: 'financials', docs: [{ filename: 'cap-table.xlsx' }] });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v1/gaps');
    assert.equal(req.body.category, 'financials');
    assert.match(text, /1\/2 present/);
    assert.match(text, /✓ Cap table/);
    assert.match(text, /✗ Bank statements/);
  });

  await t.test('extract_document renders format, sheets and text', async () => {
    const text = await call('extract_document', { asset_url: 'https://storage/model.xlsx' });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v1/extract');
    assert.equal(req.body.asset_url, 'https://storage/model.xlsx');
    assert.match(text, /Format:\*\* xlsx/);
    assert.match(text, /Sheets:\*\* P&L/);
    assert.match(text, /Revenue 1,000/);
  });

  await t.test('extract_figures renders tagged figures with provenance', async () => {
    const text = await call('extract_figures', { asset_id: 'a1' });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v1/extract/figures');
    assert.match(text, /Extracted Figures \(1\)/);
    assert.match(text, /model\.xlsx \(sheet P&L B4\) \[rule read\]/);
    assert.match(text, /verified, bound/);
  });

  await t.test('accuracy_report is a GET and renders the measured numbers', async () => {
    const text = await call('accuracy_report', {});
    const req = seen.at(-1);
    assert.equal(req.method, 'GET');
    assert.equal(req.path, '/api/v1/accuracy');
    assert.match(text, /Gate:\*\* ✓ passing/);
    assert.match(text, /Detection rate: 0\.92/);
    assert.match(text, /Checked: 30 \| Correct: 30/);
  });

  await t.test('get_source_preview still works unchanged', async () => {
    const text = await call('get_source_preview', { url: 'https://example.com/report', quote: 'revenue grew 40%' });
    assert.equal(seen.at(-1).path, '/api/v1/citations/source-preview');
    assert.match(text, /✓ grounded \(exact\)/);
  });

  await t.test('an API failure surfaces as a tool error, not a crash', async () => {
    // /api/v1/citations/:id is not stubbed, so the stub answers 404.
    const bad = await rpc('tools/call', { name: 'get_citation', arguments: { citation_id: 'nope' } });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /WebCite API error \(404\)/);
  });
});
