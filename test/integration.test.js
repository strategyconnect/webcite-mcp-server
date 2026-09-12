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
  '/api/v2/answers/answer-v1': {
    answer: {
      id: 'answer',
      revisionId: 'answer-v1',
      contentHash: 'ans-hash',
      text: 'Revenue grew 18%.',
      textHash: 'text-hash',
      inputPacketId: 'input',
      inputPacketContentHash: 'input-hash',
      outputPacketId: 'packet',
      schemaVersion: 1,
    },
    evidence: {
      packet: {
        id: 'packet',
        contentHash: 'packet-hash',
        engineVersion: 'v1',
        refs: [
          { sourceVersionId: 'sv1', sourceUnitId: 'u1', anchorId: 'a1' },
        ],
        gaps: [],
        assertions: [],
      },
    },
    presentation: {
      numbered_refs: [
        { n: 1, ref: { sourceVersionId: 'sv1', sourceUnitId: 'u1', anchorId: 'a1' } },
      ],
    },
  },
  '/api/v2/evidence-packets/packet-1': {
    packet: {
      id: 'packet-1',
      contentHash: 'packet-hash',
      engineVersion: 'v1',
      refs: [{ sourceVersionId: 'sv1', sourceUnitId: 'u1', anchorId: 'a1' }],
      gaps: [],
    },
    presentation: {
      numbered_refs: [
        { n: 1, ref: { sourceVersionId: 'sv1', sourceUnitId: 'u1', anchorId: 'a1' } },
      ],
    },
  },
  '/api/v2/context/query': {
    operatorClass: 'lookup_number',
    status: 'ok',
    queryPlan: {
      operatorClass: 'lookup_number',
      seeds: ['sv1'],
      truncated: false,
      traversedRelationIds: [],
    },
    refs: [
      {
        sourceVersionId: 'sv1',
        kind: 'number',
        nodeId: 'n1',
        snippet: 'Revenue 12.5',
      },
    ],
    gaps: [],
    engine: 'context_graph',
  },
  '/api/v2/context/compare-assertions': {
    result: 'same',
    left: { metric: 'revenue', period: 'FY24' },
    right: { metric: 'revenue', period: 'FY24' },
  },
  '/api/v2/context/change-impact': {
    answer_revision_id: 'answer-v1',
    freshness: {
      claimRevisionIds: [],
      coverage: 'complete',
      unresolvedSourceVersionIds: [],
      reasons: [],
      observation: 'no_newer_known_version',
    },
    engine: 'context_graph',
  },
  '/api/v2/context/evidence-packets': {
    packet_id: 'packet-new',
    content_hash: 'new-hash',
    input_packet_id: 'input-new',
    engine: 'context_graph',
  },
  '/api/v2/context/assess-support': {
    assessmentId: 'assess:hash-1:eg-r1',
    target: { kind: 'claim', claimRevisionId: 'claim-r1' },
    evidenceGroupRevisionId: 'eg-r1',
    alternativeFragmentId: null,
    judgment: {
      binding: 'exact',
      support: 'not_checked',
      checkedClaimHash: null,
      checkerVersion: null,
      operationId: null,
    },
    bindings: [],
    explanation: 'Support not checked; exact binding alone is insufficient',
    engine: 'context_graph',
  },
  '/api/v2/context/assess-meaning': {
    meaning: 'faithful',
    authority: 'not_checked',
    falseClaimSupport: 'not_checked',
    engine: 'context_graph',
  },
  '/api/v2/context/contradictions': {
    count: 1,
    pairs: [
      {
        left: { interval: { from: '2024-01-01', to: '2024-07-01' }, decimal_value: '10' },
        right: { interval: { from: '2024-04-01', to: '2024-10-01' }, decimal_value: '12' },
      },
    ],
    engine: 'context_graph',
  },
  '/api/v2/context/formal/eligibility': {
    eligible: false,
    scaling_ok: true,
    scaling_error: null,
    engine: 'context_graph',
  },
  '/api/v2/context/formal/check': {
    status: 'rejected_false',
    toolchainVersion: 'v4.33.1',
    checkerDigest: 'sha256:test',
    checkerPolicyRevision: 'abc123',
    engine: 'context_graph',
  },
  '/api/v2/context/claim-relations': {
    relation: {
      id: 'rel-1',
      predicate: 'equals',
      argumentIds: ['a', 'b'],
      argumentsResolved: true,
      claimRevisionId: 'claim-1',
      contentHash: 'a'.repeat(64),
    },
    relations: [
      {
        id: 'rel-1',
        predicate: 'equals',
        argumentIds: ['a', 'b'],
        argumentsResolved: true,
        claimRevisionId: 'claim-1',
        contentHash: 'a'.repeat(64),
      },
    ],
    recognised: ['equals', 'changed_by'],
    engine: 'context_graph',
  },
  '/api/v2/context/metric-definitions': {
    revisionId: 'def-1-r1',
    contentHash: 'b'.repeat(64),
    definitions: [{ revisionId: 'def-1-r1', metric: 'total_revenue' }],
    engine: 'context_graph',
  },
  '/api/v2/context/claim-structure/tier': {
    tier: 2,
    engine: 'context_graph',
  },
  '/api/v2/context/claim-structure/resolve-definition': {
    kind: 'definition',
    result: { revisionId: 'def-1-r1', metric: 'total_revenue' },
    engine: 'context_graph',
  },
  '/api/v2/context/claim-relations/formalize': {
    relation: {
      predicate: 'equals',
      argumentIds: ['a', 'b'],
      argumentsResolved: true,
    },
    formalized: true,
    recognised: ['equals', 'changed_by'],
    engine: 'context_graph',
  },
  '/api/v2/context/research-runs': {
    run: {
      id: '11111111-1111-1111-1111-111111111111',
      checkpointRevision: 0,
      objective: 'trace ARR',
      phase: 'running',
    },
    engine: 'context_graph',
  },
  '/api/v2/context/resolve-seeds': {
    candidates: [
      {
        id: 'n1',
        resolver: 'scope_tuple',
        pinnedFields: ['entityId', 'metric'],
        scopeStatus: 'known',
      },
    ],
    leading_resolver: 'scope_tuple',
    index_source: 'request',
    index_size: 1,
    engine: 'context_graph',
  },
  '/api/v2/context/expand-seeds': {
    seeds: ['a', 'b'],
    hops: 1,
    engine: 'context_graph',
  },
  '/api/v2/context/learning/judge': {
    action: 'reject',
    engine: 'context_graph',
  },
  '/api/v2/context/learning/apply': {
    status: 'refused',
    proposalId: 'lp-1',
    reason: 'auto_apply_requires_policy_gate',
    engine: 'context_graph',
  },
  '/api/v2/context/learning/placeholder': {
    checkpoint: { id: 'checkpoint-placeholder', status: 'placeholder' },
    authoritative: false,
    engine: 'context_graph',
  },
  '/api/v2/context/format/certify': {
    ok: false,
    kind: 'spreadsheet',
    reason: 'incomplete spreadsheet coverage: 1 cell(s) missing or mismatched',
    missingCount: 1,
    engine: 'context_graph',
  },
  '/api/v2/context/formal/resolution-state': {
    state: 'unknown',
    engine: 'context_graph',
  },
  '/api/v2/context/formal/revenue-bridge': {
    status: 'discharged',
    sum: '10',
    engine: 'context_graph',
  },
  '/api/v2/context/eval/catalog': {
    suites: [{ id: 'core', caseCount: 3, surfaceIds: ['http'] }],
    private_gold_denied: true,
  },
};

function startStub(options = {}) {
  const seen = [];
  const routes = { ...ROUTES, ...(options.routes || {}) };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      seen.push({
        method: req.method,
        path: url.pathname,
        query: url.search,
        apiKey: req.headers['x-api-key'],
        idempotencyKey: req.headers['idempotency-key'],
        body: body ? JSON.parse(body) : undefined,
      });

      // Dynamic query_context no-match when client asks for "nomatch"
      if (url.pathname === '/api/v2/context/query' && body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed.text === 'nomatch') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                operatorClass: 'select_passage',
                status: 'refuse',
                refuseReason: 'insufficient',
                queryPlan: {
                  operatorClass: 'select_passage',
                  seeds: [],
                  truncated: false,
                  traversedRelationIds: [],
                },
                refs: [],
                gaps: ['insufficient'],
                engine: 'context_graph',
              }),
            );
            return;
          }
          if (parsed.text === 'badshape') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'weird', refs: null }));
            return;
          }
        } catch {
          /* fall through */
        }
      }

      const researchRunMatch = url.pathname.match(
        /^\/api\/v2\/context\/research-runs\/([^/]+)(?:\/(checkpoints|reserve))?$/,
      );
      if (researchRunMatch) {
        const runId = researchRunMatch[1];
        const action = researchRunMatch[2];
        if (action === 'reserve') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              operationId: 'child-op-1',
              replay: false,
              engine: 'context_graph',
            }),
          );
          return;
        }
        const isCheckpoint = action === 'checkpoints';
        const run = {
          id: runId,
          checkpointRevision: isCheckpoint ? 1 : 0,
          objective: 'trace ARR',
          phase: 'running',
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ run, engine: 'context_graph' }));
        return;
      }

      if (url.pathname === '/api/v2/context/operations/open-root') {
        let parsed = {};
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch {
          parsed = {};
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            operation: {
              id: 'op-root-opened',
              kind: parsed.kind || 'research_run',
              rootOperationId: null,
              maxCredits: parsed.max_credits ?? 100,
            },
            engine: 'context_graph',
          }),
        );
        return;
      }

      if (url.pathname === '/api/v2/context/proofs/applies') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ applies: true, engine: 'context_graph' }));
        return;
      }

      const operationMatch = url.pathname.match(
        /^\/api\/v2\/context\/operations\/([^/]+)(?:\/(availability|settle|release|attempts|consumers))?$/,
      );
      if (operationMatch) {
        const operationId = operationMatch[1];
        const action = operationMatch[2];
        if (action === 'availability') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              availability: {
                maxCredits: 100,
                maxTokens: 1_000_000,
                settledCredits: 10,
                outstandingCredits: 5,
                outstandingTokens: 0,
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        if (action === 'settle') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              operation: {
                id: operationId,
                kind: 'parse',
                state: 'settled',
                settledCredits: 2,
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        if (action === 'release') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              operation: {
                id: operationId,
                kind: 'parse',
                state: 'released',
                settledCredits: 0,
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        if (action === 'attempts') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              attempt: {
                id: 'att-1',
                operationId,
                provider: 'openai',
                sequence: 1,
                state: 'dispatched',
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        if (action === 'consumers') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              consumer: {
                id: 'cons-1',
                operationId,
                consumerKind: 'research_run',
                consumerId: 'run-1',
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            operation: {
              id: operationId,
              kind: 'research_run',
              rootOperationId: null,
              maxCredits: 100,
            },
            engine: 'context_graph',
          }),
        );
        return;
      }

      const attemptResolveMatch = url.pathname.match(
        /^\/api\/v2\/context\/attempts\/([^/]+)\/resolve$/,
      );
      if (attemptResolveMatch) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            attempt: {
              id: attemptResolveMatch[1],
              state: 'succeeded',
              provider: 'openai',
            },
            engine: 'context_graph',
          }),
        );
        return;
      }

      if (url.pathname === '/api/v2/context/usage/consumer') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            usage: {
              operationIds: ['op-1'],
              knownCredits: 2,
              completeness: 'complete',
            },
            engine: 'context_graph',
          }),
        );
        return;
      }

      if (url.pathname === '/api/v2/context/usage/provider-cost') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            cost: {
              attemptIds: ['att-1'],
              knownCost: '0.12',
              currency: 'USD',
              completeness: 'complete',
              unknownAttemptIds: [],
            },
            engine: 'context_graph',
          }),
        );
        return;
      }

      if (url.pathname === '/api/v2/context/resolve-seeds' && body) {
        try {
          const parsed = JSON.parse(body);
          const hasIndex = Array.isArray(parsed.index);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              candidates: hasIndex
                ? [
                    {
                      id: 'n1',
                      resolver: 'scope_tuple',
                      pinnedFields: ['entityId', 'metric'],
                      scopeStatus: 'known',
                    },
                  ]
                : [],
              leading_resolver: hasIndex ? 'scope_tuple' : null,
              index_source: hasIndex ? 'request' : 'catalog',
              index_size: hasIndex ? parsed.index.length : 0,
              engine: 'context_graph',
            }),
          );
          return;
        } catch {
          /* fall through */
        }
      }

      const payload = routes[url.pathname];
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

  await t.test('get_answer resolves a sealed revision without regenerating evidence', async () => {
    const text = await call('get_answer', { revision_id: 'answer-v1' });
    assert.equal(seen.at(-1).method, 'GET');
    assert.equal(seen.at(-1).path, '/api/v2/answers/answer-v1');
    assert.match(text, /Answer Revision/);
    assert.match(text, /Revenue grew 18%/);
    assert.match(text, /sv1 \/ u1 \/ a1/);
  });

  await t.test('query_context posts text and renders refs', async () => {
    const text = await call('query_context', {
      text: 'What was revenue in FY24?',
      source_texts: ['Revenue 12.5 in FY24'],
      idempotency_key: 'q-1',
    });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v2/context/query');
    assert.equal(req.body.text, 'What was revenue in FY24?');
    assert.match(text, /Context Query/);
    assert.match(text, /Revenue 12\.5/);
  });

  await t.test('compare_assertions returns same/different/unknown', async () => {
    const text = await call('compare_assertions', {
      left: { metric: 'revenue', period: 'FY24' },
      right: { metric: 'revenue', period: 'FY24' },
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/compare-assertions');
    assert.match(text, /\*\*Result:\*\* same/);
  });

  await t.test('create_evidence_packet posts context inputs and returns packet id', async () => {
    const text = await call('create_evidence_packet', {
      claim_text: 'Revenue grew 18%.',
      bindings: [
        {
          source_version_id: 'sv1',
          source_unit_id: 'u1',
          representation_id: 'rep1',
          snippet: 'Revenue grew 18%.',
        },
      ],
      idempotency_key: 'create-1',
    });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v2/context/evidence-packets');
    assert.equal(req.body.claim_text, 'Revenue grew 18%.');
    assert.equal(req.body.bindings[0].source_version_id, 'sv1');
    assert.equal(req.idempotencyKey, 'create-1');
    assert.match(text, /packet-new/);
  });

  await t.test('assess_support posts claim hashes and returns tier-capped judgment', async () => {
    const text = await call('assess_support', {
      claim_revision_id: 'claim-r1',
      claim_hash: 'hash-1',
      evidence_group_revision_id: 'eg-r1',
      tier: 3,
      binding: 'exact',
      proposed: 'supported',
      idempotency_key: 'assess-1',
    });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v2/context/assess-support');
    assert.equal(req.body.claim_revision_id, 'claim-r1');
    assert.equal(req.body.claim_hash, 'hash-1');
    assert.equal(req.idempotencyKey, 'assess-1');
    assert.match(text, /not_checked/);
    assert.match(text, /assess:hash-1:eg-r1/);
  });

  await t.test('assess_meaning returns independent facets', async () => {
    const text = await call('assess_meaning', {
      assessment: {
        id: 'm1',
        originalRevisionId: 'o1',
        decompositionRevisionId: 'd1',
        semanticReview: 'pass',
        operationId: 'op1',
      },
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/assess-meaning');
    assert.match(text, /Meaning:\*\* faithful/);
    assert.match(text, /Authority:\*\* not_checked/);
  });

  await t.test('find_contradictions posts claims and returns count', async () => {
    const text = await call('find_contradictions', {
      claims: [
        { interval: { from: '2024-01-01', to: '2024-07-01' }, decimal_value: '10' },
        { interval: { from: '2024-04-01', to: '2024-10-01' }, decimal_value: '12' },
      ],
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/contradictions');
    assert.match(text, /Count:\*\* 1/);
  });

  await t.test('formal_eligibility refuses uncertain recognition', async () => {
    const text = await call('formal_eligibility', {
      decimal: '12000',
      unit: 'USD',
      scale: '1',
      basis_reviewed: true,
      recognition: 'uncertain',
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/formal/eligibility');
    assert.match(text, /Eligible:\*\* no/);
  });

  await t.test('formal_check posts Lean source and returns status', async () => {
    const text = await call('formal_check', {
      source: 'example : remaining 10 4 = 7 := by decide\n',
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/formal/check');
    assert.match(text, /Status:\*\* rejected_false/);
  });

  await t.test('create_claim_relation and list_claim_relations hit catalog routes', async () => {
    const created = await call('create_claim_relation', {
      predicate: 'equals',
      argument_ids: ['a', 'b'],
      arguments_resolved: true,
      claim_revision_id: 'claim-1',
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/claim-relations');
    assert.match(created, /Predicate:\*\* equals/);

    const listed = await call('list_claim_relations', { predicate: 'equals' });
    assert.equal(seen.at(-1).path, '/api/v2/context/claim-relations');
    assert.match(listed, /Count:\*\* 1/);
  });

  await t.test('create_metric_definition and list_metric_definitions hit catalog routes', async () => {
    const created = await call('create_metric_definition', {
      definition: { revisionId: 'def-1-r1', metric: 'total_revenue' },
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/metric-definitions');
    assert.match(created, /Revision:\*\* def-1-r1/);

    const listed = await call('list_metric_definitions', { metric: 'total_revenue' });
    assert.equal(seen.at(-1).path, '/api/v2/context/metric-definitions');
    assert.match(listed, /Count:\*\* 1/);
  });

  await t.test('claim_structure and formalize tools hit C1 routes', async () => {
    const tier = await call('claim_structure_tier', {
      assertion: { text: 'ARR is $10m', scope: { metric: 'ARR' } },
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/claim-structure/tier');
    assert.match(tier, /Tier:\*\* 2/);

    const resolved = await call('claim_structure_resolve_definition', {
      metric: 'total_revenue',
      knowledge_as_of: '2024-01-01',
      effective_at: '2024-01-01',
      catalog: [{ revisionId: 'def-1-r1', metric: 'total_revenue' }],
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/claim-structure/resolve-definition');
    assert.match(resolved, /Kind:\*\* definition/);

    const formalized = await call('formalize_claim_relation', {
      predicate: 'equals',
      argument_ids: ['a', 'b'],
      arguments_resolved: true,
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/claim-relations/formalize');
    assert.match(formalized, /Formalized:\*\* yes/);
    assert.match(formalized, /Predicate:\*\* equals/);
  });

  await t.test('research run create/get/checkpoint hit C3 routes', async () => {
    const created = await call('create_research_run', {
      objective: 'trace ARR',
      snapshot_id: 'snap-1',
      workflow_version: 'wf-1',
      budget: { max_credits: 10, max_tokens: 1000, deadline_ms: 60_000 },
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/research-runs');
    assert.match(created, /Phase:\*\* running/);

    const got = await call('get_research_run', {
      run_id: '11111111-1111-1111-1111-111111111111',
    });
    assert.equal(
      seen.at(-1).path,
      '/api/v2/context/research-runs/11111111-1111-1111-1111-111111111111',
    );
    assert.match(got, /Revision:\*\* 0/);

    const checkpointed = await call('checkpoint_research_run', {
      run_id: '11111111-1111-1111-1111-111111111111',
      expected_revision: 0,
      run: {
        id: '11111111-1111-1111-1111-111111111111',
        checkpointRevision: 0,
        objective: 'trace ARR',
        phase: 'running',
      },
    });
    assert.equal(
      seen.at(-1).path,
      '/api/v2/context/research-runs/11111111-1111-1111-1111-111111111111/checkpoints',
    );
    assert.match(checkpointed, /Revision:\*\* 1/);
  });

  await t.test('resolve_seeds posts index and returns leading resolver', async () => {
    const text = await call('resolve_seeds', {
      text: 'acme revenue',
      filters: { entityId: 'acme', metric: 'total_revenue' },
      index: [
        {
          id: 'n1',
          scope: { entityId: 'acme', metric: 'total_revenue' },
          terms: ['revenue'],
        },
      ],
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/resolve-seeds');
    assert.match(text, /Leading resolver:\*\* scope_tuple/);
    assert.match(text, /Index source:\*\* request/);
  });

  await t.test('resolve_seeds omits index to use SQL catalog path', async () => {
    const text = await call('resolve_seeds', { text: 'catalog only' });
    assert.equal(seen.at(-1).path, '/api/v2/context/resolve-seeds');
    assert.equal(seen.at(-1).body.index, undefined);
    assert.match(text, /Index source:\*\* catalog/);
  });

  await t.test('expand_seeds posts authorized graph and returns expanded ids', async () => {
    const text = await call('expand_seeds', {
      seeds: ['a'],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
      allowed: ['a', 'b'],
      hops: 2,
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/expand-seeds');
    assert.match(text, /Hops:\*\* 1/);
    assert.match(text, /Seeds:\*\* a, b/);
  });

  await t.test('learning judge/apply/placeholder hit E2 routes', async () => {
    const judged = await call('learning_judge', {
      hard_failures: ['hard'],
      verdict: 'uncertain',
      attempts: 0,
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/learning/judge');
    assert.match(judged, /Action:\*\* reject/);

    const applied = await call('learning_apply', {
      proposal: {
        id: 'lp-1',
        parentConfigHash: 'p',
        candidateConfigHash: 'c',
        reasonCaseIds: ['c1'],
        evaluationRunIds: [],
        status: 'evaluating',
      },
      gate: null,
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/learning/apply');
    assert.match(applied, /Status:\*\* refused/);

    const placeholder = await call('learning_placeholder', { criterion: 'support' });
    assert.equal(seen.at(-1).path, '/api/v2/context/learning/placeholder');
    assert.match(placeholder, /Authoritative:\*\* no/);
  });

  await t.test('format_certify posts planted inventory', async () => {
    const text = await call('format_certify', {
      kind: 'spreadsheet',
      expected: [{ sheet: 'S', address: 'A1', raw: '1', displayed: '1', formula: null }],
      found: [],
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/format/certify');
    assert.match(text, /Ok:\*\* no/);
  });

  await t.test('reserve_research_budget and P4 formal tools hit routes', async () => {
    const reserved = await call('reserve_research_budget', {
      run_id: '11111111-1111-1111-1111-111111111111',
      idempotency_key: 'key-1',
      kind: 'parse',
      credits: 2,
    });
    assert.equal(
      seen.at(-1).path,
      '/api/v2/context/research-runs/11111111-1111-1111-1111-111111111111/reserve',
    );
    assert.match(reserved, /Operation:\*\* child-op-1/);

    const opened = await call('open_operation_root', {
      idempotency_key: 'root-key-1',
      kind: 'research_run',
      max_credits: 50,
      max_tokens: 1000,
      deadline_ms: 60000,
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/operations/open-root');
    assert.match(opened, /Id:\*\* op-root-opened/);

    const described = await call('get_operation', { operation_id: 'op-root-1' });
    assert.equal(seen.at(-1).path, '/api/v2/context/operations/op-root-1');
    assert.match(described, /Id:\*\* op-root-1/);
    assert.match(described, /Kind:\*\* research_run/);

    const availability = await call('get_operation_availability', {
      operation_id: 'op-root-1',
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/operations/op-root-1/availability');
    assert.match(availability, /Max credits:\*\* 100/);
    assert.match(availability, /Outstanding credits:\*\* 5/);

    const settled = await call('settle_operation', {
      operation_id: 'op-child-1',
      settled_credits: 2,
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/operations/op-child-1/settle');
    assert.match(settled, /State:\*\* settled/);

    const released = await call('release_operation', { operation_id: 'op-child-2' });
    assert.equal(seen.at(-1).path, '/api/v2/context/operations/op-child-2/release');
    assert.match(released, /State:\*\* released/);

    const recorded = await call('record_operation_attempt', {
      operation_id: 'op-child-1',
      provider: 'openai',
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/operations/op-child-1/attempts');
    assert.match(recorded, /Provider:\*\* openai/);

    const resolved = await call('resolve_operation_attempt', {
      attempt_id: 'att-1',
      state: 'succeeded',
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/attempts/att-1/resolve');
    assert.match(resolved, /State:\*\* succeeded/);

    const linked = await call('link_operation_consumer', {
      operation_id: 'op-child-1',
      consumer_kind: 'research_run',
      consumer_id: 'run-1',
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/operations/op-child-1/consumers');
    assert.match(linked, /Kind:\*\* research_run/);

    const usage = await call('get_consumer_usage', {
      consumer_kind: 'research_run',
      consumer_id: 'run-1',
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/usage/consumer');
    assert.match(usage, /Known credits:\*\* 2/);

    const providerCost = await call('get_provider_cost', {
      operation_ids: ['op-1'],
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/usage/provider-cost');
    assert.match(providerCost, /Known cost:\*\* 0\.12/);
    assert.match(providerCost, /Currency:\*\* USD/);

    const proof = await call('proofs_applies', {
      status: 'proved',
      binding_hash: 'bind-1',
      toolchain_version: 'v4.33.1',
      current_binding_hash: 'bind-1',
      approved_toolchains: ['v4.33.1'],
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/proofs/applies');
    assert.match(proof, /Applies:\*\* yes/);

    const state = await call('formal_resolution_state', {
      proof_search_failed: true,
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/formal/resolution-state');
    assert.match(state, /State:\*\* unknown/);

    const bridge = await call('formal_revenue_bridge', {
      totalPoints: '10',
      currency: 'USD',
      period: 'FY2024',
      entityId: 'acme',
      scale: '1',
      components: [
        {
          points: '10',
          currency: 'USD',
          period: 'FY2024',
          entityId: 'acme',
          scale: '1',
          definitionRevisionId: 'd1',
        },
      ],
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/formal/revenue-bridge');
    assert.match(bridge, /Status:\*\* discharged/);
  });

  await t.test('get_evidence_packet and get_change_impact hit v2 routes', async () => {
    const packet = await call('get_evidence_packet', { packet_id: 'packet-1' });
    assert.equal(seen.at(-1).path, '/api/v2/evidence-packets/packet-1');
    assert.match(packet, /Evidence Packet/);

    const impact = await call('get_change_impact', { answer_revision_id: 'answer-v1' });
    assert.equal(seen.at(-1).path, '/api/v2/context/change-impact');
    assert.match(impact, /Change Impact/);
  });

  await t.test('eval_catalog denies private gold on the wire', async () => {
    const text = await call('eval_catalog', {});
    assert.equal(seen.at(-1).path, '/api/v2/context/eval/catalog');
    assert.match(text, /Private gold denied:\*\* yes/);
  });

  await t.test('Q_MCP_FAILURES: invalid argument is isError without crashing', async () => {
    const bad = await rpc('tools/call', { name: 'query_context', arguments: {} });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /invalid_argument|text is required/i);
  });

  await t.test('an API failure surfaces as a tool error, not a crash', async () => {
    // /api/v1/citations/:id is not stubbed, so the stub answers 404.
    const bad = await rpc('tools/call', { name: 'get_citation', arguments: { citation_id: 'nope' } });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /404|not_found|WebCite API error/i);
  });
});

test('paging and limit arguments keep their pre-1.3.0 defaults', async (t) => {
  const { server, seen, port } = await startStub();
  const { child, rpc, notify } = startServer(port);
  t.after(() => {
    child.kill();
    server.close();
  });

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'integration', version: '1' },
  });
  notify('notifications/initialized');

  // The stub does not serve /api/v1/citations, so the tool reports an error — but the
  // request it sent is recorded, and the query string is what these assertions check.
  const sent = async (args) => {
    await rpc('tools/call', { name: 'list_citations', arguments: args });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v1/citations');
    return req.query;
  };

  assert.equal(await sent({}), '?page=1&limit=10');
  // 0 is not "a smaller page" — it falls back to the default, as before 1.3.0.
  assert.equal(await sent({ page: 0, limit: 0 }), '?page=1&limit=10');
  // NaN serialises to null over JSON-RPC; a non-number must not reach the query string.
  assert.equal(await sent({ limit: NaN }), '?page=1&limit=10');
  assert.equal(await sent({ page: 3, limit: 25 }), '?page=3&limit=25');
  // Out-of-range values are clamped, not forwarded.
  assert.equal(await sent({ limit: 500 }), '?page=1&limit=50');

  await rpc('tools/call', { name: 'search_sources', arguments: { query: 'x', limit: 0 } });
  assert.equal(seen.at(-1).body.limit, 10);
  await rpc('tools/call', { name: 'search_sources', arguments: { query: 'x', limit: 99 } });
  assert.equal(seen.at(-1).body.limit, 20);
});

test('A_MCP: context tools round-trip against fake HTTP boundary', async (t) => {
  const { server, seen, port } = await startStub();
  const { child, rpc, notify } = startServer(port);
  t.after(() => {
    child.kill();
    server.close();
  });

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'integration', version: '1' },
  });
  notify('notifications/initialized');

  const listed = await rpc('tools/list', {});
  const names = listed.result.tools.map((t) => t.name);
  assert.ok(names.includes('query_context'));
  assert.ok(names.includes('get_answer'));
  assert.ok(names.includes('verify_claim'));

  const call = async (name, args) => {
    const res = await rpc('tools/call', { name, arguments: args });
    assert.ok(!res.result.isError, `${name} errored: ${res.result.content?.[0]?.text}`);
    return res.result;
  };

  await t.test('get_answer validates and returns structuredContent', async () => {
    const result = await call('get_answer', { revision_id: 'answer-v1' });
    assert.equal(seen.at(-1).method, 'GET');
    assert.equal(seen.at(-1).path, '/api/v2/answers/answer-v1');
    assert.match(result.content[0].text, /Answer Revision/);
    assert.match(result.content[0].text, /Revenue grew 18%/);
    assert.equal(result.structuredContent.answer.revisionId, 'answer-v1');
    assert.equal(result.structuredContent.answer.contentHash, 'ans-hash');
  });

  await t.test('get_evidence_packet resolves by id', async () => {
    const result = await call('get_evidence_packet', { packet_id: 'packet-1' });
    assert.equal(seen.at(-1).path, '/api/v2/evidence-packets/packet-1');
    assert.equal(result.structuredContent.packet.id, 'packet-1');
    assert.match(result.content[0].text, /Evidence Packet/);
  });

  await t.test('query_context posts body and forwards idempotency key', async () => {
    const result = await call('query_context', {
      text: 'Where does the report discuss revenue?',
      source_texts: ['Revenue grew 40% in FY2024.'],
      idempotency_key: 'ctx-query-1',
    });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v2/context/query');
    assert.equal(req.idempotencyKey, 'ctx-query-1');
    assert.equal(req.body.text, 'Where does the report discuss revenue?');
    assert.equal(result.structuredContent.status, 'ok');
    assert.match(result.content[0].text, /Context Query/);
  });

  await t.test('compare_assertions / change_impact / create / eval_catalog', async () => {
    const compare = await call('compare_assertions', {
      left: { metric: 'revenue', period: 'FY24' },
      right: { metric: 'revenue', period: 'FY24' },
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/compare-assertions');
    assert.equal(compare.structuredContent.result, 'same');

    const impact = await call('get_change_impact', { answer_revision_id: 'answer-v1' });
    assert.equal(seen.at(-1).path, '/api/v2/context/change-impact');
    assert.equal(impact.structuredContent.freshness.coverage, 'complete');

    const created = await call('create_evidence_packet', {
      claim_text: 'seed claim',
      bindings: [
        {
          source_version_id: 'sv1',
          source_unit_id: 'u1',
          representation_id: 'rep1',
        },
      ],
      idempotency_key: 'pkt-1',
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/evidence-packets');
    assert.equal(seen.at(-1).idempotencyKey, 'pkt-1');
    assert.equal(created.structuredContent.packet_id, 'packet-new');

    const catalog = await call('eval_catalog', {});
    assert.equal(seen.at(-1).method, 'GET');
    assert.equal(seen.at(-1).path, '/api/v2/context/eval/catalog');
    assert.equal(catalog.structuredContent.private_gold_denied, true);
  });
});

test('Q_MCP_FAILURES: invalid arg, isError, no-match success, unknown tool, bad API shape', async (t) => {
  const { server, seen, port } = await startStub();
  const { child, rpc, notify } = startServer(port);
  t.after(() => {
    child.kill();
    server.close();
  });

  await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'integration', version: '1' },
  });
  notify('notifications/initialized');

  await t.test('invalid argument → isError with typed failure', async () => {
    const res = await rpc('tools/call', { name: 'query_context', arguments: {} });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /invalid_argument/);
    assert.equal(res.result.structuredContent.code, 'invalid_argument');
  });

  await t.test('successful no-match remains distinguishable from failure', async () => {
    const res = await rpc('tools/call', {
      name: 'query_context',
      arguments: { text: 'nomatch', source_texts: [''] },
    });
    assert.ok(!res.result.isError);
    assert.equal(res.result.structuredContent.status, 'refuse');
    assert.equal(res.result.structuredContent.refs.length, 0);
    assert.match(res.result.content[0].text, /successful no-match/i);
  });

  await t.test('invalid API output → isError invalid_api_output', async () => {
    const res = await rpc('tools/call', {
      name: 'query_context',
      arguments: { text: 'badshape' },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'invalid_api_output');
  });

  await t.test('API 404 surfaces typed not_found isError', async () => {
    const res = await rpc('tools/call', {
      name: 'get_answer',
      arguments: { revision_id: 'missing' },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'not_found');
    assert.match(res.result.content[0].text, /404/);
  });

  await t.test('unknown tool → protocol error (not isError tool result)', async () => {
    const res = await rpc('tools/call', { name: 'not_a_real_tool', arguments: {} });
    assert.ok(res.error, 'expected JSON-RPC error');
    assert.ok(
      res.error.message.includes('Unknown tool') || res.error.code === -32601,
      `unexpected error: ${JSON.stringify(res.error)}`,
    );
  });

  await t.test('legacy client still receives text content on success', async () => {
    const res = await rpc('tools/call', {
      name: 'compare_assertions',
      arguments: {
        left: { metric: 'revenue' },
        right: { metric: 'revenue' },
      },
    });
    // Stub always returns different; text must still be present for older clients.
    assert.ok(!res.result.isError);
    assert.ok(res.result.content?.[0]?.text?.length > 20);
    assert.ok(seen.length > 0);
  });
});
