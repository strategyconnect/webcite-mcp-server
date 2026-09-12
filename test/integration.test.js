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
  '/api/v2/context/fragments/resolve-uses': {
    status: 'ok',
    matches: [
      {
        matchKind: 'contains',
        fragmentId: 'passage',
        groupIds: ['g1'],
        linkIds: ['link-1'],
        consumerIds: ['claim-c1'],
        useAge: 'current',
        semanticSupport: false,
      },
    ],
    nextCursor: null,
    engine: 'context_graph',
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
  '/api/v2/context/numbers/inventory': {
    counts: { read: 2, uncertain: 1, unreadable: 0 },
    occurrences: [
      {
        id: 'occ-1',
        raw: '10',
        fragment_id: 'frag-a',
        normalized_decimal: '10',
        interpretation: 'unknown',
        method: 'native',
        recognition_state: 'read',
      },
      {
        id: 'occ-2',
        raw: '10',
        fragment_id: 'frag-b',
        normalized_decimal: '10',
        interpretation: 'unknown',
        method: 'native',
        recognition_state: 'read',
      },
      {
        id: 'occ-3',
        raw: '~12',
        fragment_id: 'frag-c',
        normalized_decimal: null,
        interpretation: 'unknown',
        method: 'native',
        recognition_state: 'uncertain',
      },
    ],
    coverage: 'complete',
    unresolved: [],
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
    coverage: 'complete',
    unresolved: [],
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
  '/api/v2/context/private-upload/certify': {
    ok: false,
    reason: 'not_run: EVIDENCE_STORAGE_ROOT or EVIDENCE_BUCKET_NAME required',
    engine: 'context_graph',
  },
  '/api/v2/context/retrieve/flag': {
    ok: true,
    enabled: false,
    default_off: true,
    engine: 'context_graph',
  },
};

function startStub(options = {}) {
  const seen = [];
  const flags = {
    researchListRefuse: false,
    /** Backend #288: return a listed run with padded scope.tenantId. */
    researchListPaddedTenant: false,
  };
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
          // Backend #314: API gap padded_select_text must fail closed on validate.
          if (parsed.text === 'padded_select_gap') {
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
                gaps: ['padded_select_text'],
                engine: 'context_graph',
              }),
            );
            return;
          }
          // Backend #307: API gap padded_lookup_filter must fail closed on validate.
          if (parsed.text === 'padded_lookup_gap') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                operatorClass: 'lookup_number',
                status: 'refuse',
                refuseReason: 'insufficient',
                queryPlan: {
                  operatorClass: 'lookup_number',
                  seeds: [],
                  truncated: false,
                  traversedRelationIds: [],
                },
                refs: [],
                gaps: ['padded_lookup_filter'],
                engine: 'context_graph',
              }),
            );
            return;
          }
        } catch {
          /* fall through */
        }
      }

      // Dynamic change-impact: incomplete packet dependency fails closed (400)
      if (url.pathname === '/api/v2/context/change-impact' && body) {
        try {
          const parsed = JSON.parse(body);
          const changedIds = Array.isArray(parsed?.changed_ids) ? parsed.changed_ids : [];
          if (changedIds.length > 0) {
            const links = parsed?.links;
            const packetId =
              typeof parsed?.packet_id === 'string' ? parsed.packet_id.trim() : '';
            const unresolved = [];
            // Backend #264/#279: blank/whitespace/padded roots → incomplete_changed_ids.
            if (
              changedIds.some(
                (id) =>
                  typeof id !== 'string' ||
                  !String(id).trim() ||
                  String(id) !== String(id).trim(),
              )
            ) {
              unresolved.push('incomplete_changed_ids');
            }
            if (!Array.isArray(links)) {
              unresolved.push('missing_dependency_graph');
            } else if (
              // Backend #285: blank/whitespace/padded link endpoints → incomplete_dependency_graph.
              links.some((link) => {
                if (!link || typeof link.source_id !== 'string' || typeof link.consumer_id !== 'string') {
                  return true;
                }
                const sourceIncomplete =
                  !link.source_id.trim() || link.source_id !== link.source_id.trim();
                const consumerIncomplete =
                  !link.consumer_id.trim() || link.consumer_id !== link.consumer_id.trim();
                return sourceIncomplete || consumerIncomplete;
              })
            ) {
              unresolved.push('incomplete_dependency_graph');
            } else if (
              // Backend #294: sourceId === consumerId → self_loop_dependency (after blank/pad).
              links.some(
                (link) =>
                  link &&
                  typeof link.source_id === 'string' &&
                  typeof link.consumer_id === 'string' &&
                  link.source_id === link.consumer_id,
              )
            ) {
              unresolved.push('self_loop_dependency');
            }
            if (packetId === 'missing-packet') {
              unresolved.push('missing_sealed_packet');
            }
            if (parsed?.window && parsed.observed_at_ms === undefined) {
              unresolved.push('missing_observation_time');
            }
            if (unresolved.length) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  message: `change_impact_incomplete: ${unresolved.join(',')}`,
                  statusCode: 400,
                }),
              );
              return;
            }
            const consumers = [];
            for (const id of changedIds) {
              for (const link of links) {
                if (link.source_id === id) consumers.push(link.consumer_id);
              }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                ...(typeof parsed.answer_revision_id === 'string'
                  ? {
                      answer_revision_id: parsed.answer_revision_id,
                      freshness: ROUTES['/api/v2/context/change-impact'].freshness,
                    }
                  : {}),
                ...(packetId ? { packet_id: packetId } : {}),
                packet_impact: {
                  affectedConsumerIds: [...new Set(consumers)],
                  inWindow: parsed.window
                    ? parsed.observed_at_ms >= parsed.window.start_ms &&
                      parsed.observed_at_ms < parsed.window.end_ms
                    : null,
                  unresolved: [],
                  coverage: 'complete',
                },
                engine: 'context_graph',
              }),
            );
            return;
          }
        } catch {
          /* fall through */
        }
      }

      // Dynamic number inventory: incomplete rows fail closed (400).
      // Mirror backend #251: never invent method=native; blank raw / invalid
      // method / invalid interpretation mark coverage unknown → refuse.
      if (url.pathname === '/api/v2/context/numbers/inventory' && body) {
        try {
          const parsed = JSON.parse(body);
          const rows = Array.isArray(parsed?.occurrences) ? parsed.occurrences : [];
          const METHODS = new Set(['native', 'ocr', 'asr', 'human', 'chart_estimate']);
          const INTERPRETATIONS = new Set([
            'measure',
            'date',
            'identifier',
            'ordinal',
            'range',
            'formula',
            'unknown',
          ]);
          const unresolved = [];
          for (const row of rows) {
            const state = row.recognition_state ?? row.recognitionState;
            const id = typeof row.id === 'string' ? row.id : '';
            const fragmentId =
              typeof (row.fragment_id ?? row.fragmentId) === 'string'
                ? (row.fragment_id ?? row.fragmentId)
                : '';
            const decimal =
              row.normalized_decimal !== undefined
                ? row.normalized_decimal
                : row.normalizedDecimal;
            const rawText = typeof row.raw === 'string' ? row.raw : '';
            // HTTP: interpretation may default to unknown; never invent method=native.
            const method = row.method ?? '';
            const interpretation = row.interpretation ?? 'unknown';
            // Backend #259/#276: blank/whitespace/padded ids are incomplete — never certify counts.
            const identityComplete = (s) =>
              String(s).trim().length > 0 && String(s) === String(s).trim();
            if (!identityComplete(id) || !identityComplete(fragmentId)) {
              unresolved.push('missing_occurrence_identity');
              continue;
            }
            // Backend #287: blank/whitespace or surrounding-padded raw is not a
            // certified glyph (" 12 " must not certify as 12 after trim).
            if (!identityComplete(rawText)) {
              unresolved.push('missing_occurrence_raw');
            }
            // Backend #300: padded method/interpretation/recognition must not
            // trim-launder into certified labels (" ocr " / " measure " / " read ").
            const RECOGNITION = new Set(['read', 'uncertain', 'unreadable']);
            const labelComplete = (s, allowed) =>
              identityComplete(String(s)) && allowed.has(String(s));
            if (!labelComplete(method, METHODS)) {
              unresolved.push('invalid_occurrence_method');
            }
            if (!labelComplete(interpretation, INTERPRETATIONS)) {
              unresolved.push('invalid_occurrence_interpretation');
            }
            if (!labelComplete(state ?? '', RECOGNITION)) {
              unresolved.push('invalid_recognition_state');
            }
            // Backend #278/#282: non-null blank/whitespace or surrounding-padded
            // decimal is not a certified magnitude (" 12 " must not certify as 12).
            if (decimal != null && !identityComplete(decimal)) {
              unresolved.push('blank_normalized_decimal');
            }
            if (state === 'unreadable' && decimal != null) {
              unresolved.push('unreadable_claims_normalized_decimal');
            }
          }
          const unique = [...new Set(unresolved)];
          if (unique.length) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                message: `number_inventory_incomplete: ${unique.join(',')}`,
                statusCode: 400,
              }),
            );
            return;
          }
        } catch {
          /* fall through */
        }
      }

      // Dynamic contradiction scan: blank/padded bounds / missing/padded decimals fail closed (400).
      // Mirror backend #256/#289: never certify empty pairs when coverage is unknown;
      // surrounding pads must not trim-launder into known bounds or magnitudes.
      if (url.pathname === '/api/v2/context/contradictions' && body) {
        try {
          const parsed = JSON.parse(body);
          const claims = Array.isArray(parsed?.claims) ? parsed.claims : [];
          if (claims.length >= 2) {
            const CONFLICTING = new Set(['overlaps', 'equal', 'starts', 'during', 'finishes']);
            // Backend #289: non-blank AND unpadded (value === trim) to certify known bounds.
            const endpointComplete = (v) =>
              typeof v === 'string' && v.trim().length > 0 && v === v.trim();
            const known = (iv) => iv && endpointComplete(iv.from) && endpointComplete(iv.to);
            // Backend #289: surrounding-padded decimals (" 10 ") never certify a magnitude.
            const decimalPresent = (v) =>
              typeof v === 'string' && v.trim().length > 0 && v === v.trim();
            const relation = (a, b) => {
              if (!known(a) || !known(b)) return 'unknown';
              if (!(a.from < a.to) || !(b.from < b.to)) return 'unknown';
              if (a.from === b.from && a.to === b.to) return 'equal';
              if (a.to <= b.from || b.to <= a.from) return 'before';
              if (a.from === b.from && a.to < b.to) return 'starts';
              if (b.from === a.from && b.to < a.to) return 'starts';
              if (a.to === b.to && a.from > b.from) return 'finishes';
              if (b.to === a.to && b.from > a.from) return 'finishes';
              if (a.from > b.from && a.to < b.to) return 'during';
              if (b.from > a.from && b.to < a.to) return 'during';
              return 'overlaps';
            };
            const pairs = [];
            const unresolved = new Set();
            for (let i = 0; i < claims.length; i++) {
              for (let j = i + 1; j < claims.length; j++) {
                const left = claims[i];
                const right = claims[j];
                const rel = relation(left?.interval, right?.interval);
                const leftDec = decimalPresent(left?.decimal_value);
                const rightDec = decimalPresent(right?.decimal_value);
                if (
                  CONFLICTING.has(rel) &&
                  leftDec &&
                  rightDec &&
                  left.decimal_value !== right.decimal_value
                ) {
                  pairs.push({
                    left: {
                      interval: left.interval,
                      decimal_value: left.decimal_value,
                    },
                    right: {
                      interval: right.interval,
                      decimal_value: right.decimal_value,
                    },
                  });
                  continue;
                }
                if (leftDec && rightDec && left.decimal_value !== right.decimal_value && rel === 'unknown') {
                  unresolved.add('unknown_interval_bounds');
                  continue;
                }
                if ((!leftDec || !rightDec) && (rel === 'unknown' || CONFLICTING.has(rel))) {
                  unresolved.add('missing_decimal_value');
                }
              }
            }
            const unresolvedList = [...unresolved].sort();
            if (unresolvedList.length) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  message: `contradiction_scan_incomplete: ${unresolvedList.join(',')}`,
                  statusCode: 400,
                }),
              );
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                count: pairs.length,
                pairs,
                coverage: 'complete',
                unresolved: [],
                engine: 'context_graph',
              }),
            );
            return;
          }
        } catch {
          /* fall through */
        }
      }

      // Dynamic resolve_fragment_uses refuse for unsupported selector kinds / sealed echo
      if (url.pathname === '/api/v2/context/fragments/resolve-uses' && body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed?.selector?.kind === 'cells') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                status: 'refuse',
                reason: 'unsupported_selector_kind:cells',
                matches: [],
                nextCursor: null,
                engine: 'context_graph',
              }),
            );
            return;
          }
          if (parsed?.packet_id || parsed?.answer_revision_id) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                status: 'ok',
                matches: [
                  {
                    matchKind: 'contains',
                    fragmentId: 'passage',
                    groupIds: ['g1'],
                    linkIds: ['link-1'],
                    consumerIds: [],
                    useAge: 'current',
                    semanticSupport: false,
                  },
                ],
                nextCursor: null,
                engine: 'context_graph',
                ...(parsed.packet_id ? { packet_id: parsed.packet_id } : {}),
                ...(parsed.answer_revision_id
                  ? { answer_revision_id: parsed.answer_revision_id }
                  : {}),
              }),
            );
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
        // Mirror backend: CONTEXT_GRAPH_RESEARCH default-off → 400 refuse.
        if (runId === 'flag-off') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              statusCode: 400,
              message: 'CONTEXT_GRAPH_RESEARCH is disabled',
              error: 'Bad Request',
            }),
          );
          return;
        }
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
        // Backend #268: blank wait subject identity in API output must fail closed.
        if (runId === 'blank-wait' && !action) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              run: {
                id: runId,
                checkpointRevision: 0,
                objective: 'trace ARR',
                phase: 'waiting',
                scope: { tenantId: 't1' },
                wait: {
                  kind: 'source_ready',
                  subjectId: '  ',
                  subjectRevisionId: 'v2',
                  expiresAtMs: 9999,
                },
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        // Backend #277: blank wait tenant identity in API output must fail closed.
        if (runId === 'blank-tenant-wait' && !action) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              run: {
                id: runId,
                checkpointRevision: 0,
                objective: 'trace ARR',
                phase: 'waiting',
                scope: { tenantId: '  ' },
                wait: {
                  kind: 'source_ready',
                  subjectId: 'src',
                  subjectRevisionId: 'v2',
                  expiresAtMs: 9999,
                },
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        // Backend #281: padded wait subject identity in API output must fail closed.
        if (runId === 'padded-wait' && !action) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              run: {
                id: runId,
                checkpointRevision: 0,
                objective: 'trace ARR',
                phase: 'waiting',
                scope: { tenantId: 't1' },
                wait: {
                  kind: 'source_ready',
                  subjectId: ' src ',
                  subjectRevisionId: 'v2',
                  expiresAtMs: 9999,
                },
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        // Backend #281: padded wait tenant identity in API output must fail closed.
        if (runId === 'padded-tenant-wait' && !action) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              run: {
                id: runId,
                checkpointRevision: 0,
                objective: 'trace ARR',
                phase: 'waiting',
                scope: { tenantId: ' t1 ' },
                wait: {
                  kind: 'source_ready',
                  subjectId: 'src',
                  subjectRevisionId: 'v2',
                  expiresAtMs: 9999,
                },
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        // Backend #297: padded memory-note id in API output must fail closed.
        if (runId === 'padded-note' && !action) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              run: {
                id: runId,
                checkpointRevision: 0,
                objective: 'trace ARR',
                phase: 'running',
                scope: {
                  tenantId: 't1',
                  userId: 'u1',
                  dealId: 'd1',
                  sessionId: 's1',
                },
                notes: [
                  {
                    id: ' n1 ',
                    scope: {
                      tenantId: 't1',
                      userId: 'u1',
                      dealId: 'd1',
                      sessionId: 's1',
                    },
                    kind: 'working_note',
                    text: 'Check revenue',
                    status: 'active',
                  },
                ],
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        // Backend #297: padded note ResearchScope in API output must fail closed.
        if (runId === 'padded-note-scope' && !action) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              run: {
                id: runId,
                checkpointRevision: 0,
                objective: 'trace ARR',
                phase: 'running',
                scope: {
                  tenantId: ' t1 ',
                  userId: 'u1',
                  dealId: 'd1',
                  sessionId: 's1',
                },
                notes: [
                  {
                    id: 'n1',
                    scope: {
                      tenantId: ' t1 ',
                      userId: 'u1',
                      dealId: 'd1',
                      sessionId: 's1',
                    },
                    kind: 'working_note',
                    text: 'Check revenue',
                    status: 'active',
                  },
                ],
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        // Backend #304: padded loopStop requirement ids in API output must fail closed.
        if (runId === 'padded-progress' && !action) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              run: {
                id: runId,
                checkpointRevision: 0,
                objective: 'trace ARR',
                phase: 'running',
                progress: {
                  steps: 2,
                  maxSteps: 32,
                  consecutiveNoProgress: 2,
                  openRequirementIds: [' revenue '],
                  failedRequirementIds: [],
                },
              },
              engine: 'context_graph',
            }),
          );
          return;
        }
        const isCheckpoint = action === 'checkpoints';
        let parsedBody = {};
        if (isCheckpoint && body) {
          try {
            parsedBody = JSON.parse(body);
          } catch {
            parsedBody = {};
          }
        }
        const incomingRun =
          parsedBody && typeof parsedBody === 'object' ? parsedBody.run : undefined;
        const incomingWait =
          isCheckpoint && incomingRun && typeof incomingRun === 'object'
            ? incomingRun.wait
            : undefined;
        const incomingScope =
          isCheckpoint && incomingRun && typeof incomingRun === 'object'
            ? incomingRun.scope
            : undefined;
        const incomingNotes =
          isCheckpoint && incomingRun && typeof incomingRun === 'object'
            ? incomingRun.notes
            : undefined;
        const incomingProgress =
          isCheckpoint && incomingRun && typeof incomingRun === 'object'
            ? incomingRun.progress
            : undefined;
        const run = {
          id: runId,
          checkpointRevision: isCheckpoint ? 1 : 0,
          objective: 'trace ARR',
          phase: incomingWait ? 'waiting' : 'running',
          ...(incomingWait !== undefined ? { wait: incomingWait } : {}),
          ...(incomingScope !== undefined ? { scope: incomingScope } : {}),
          ...(incomingNotes !== undefined ? { notes: incomingNotes } : {}),
          ...(incomingProgress !== undefined ? { progress: incomingProgress } : {}),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ run, engine: 'context_graph' }));
        return;
      }

      // create_research_run flag-off refuse (before static ROUTES)
      if (url.pathname === '/api/v2/context/research-runs' && req.method === 'POST' && body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed.objective === '__flag_off__') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                statusCode: 400,
                message: 'CONTEXT_GRAPH_RESEARCH is disabled',
                error: 'Bad Request',
              }),
            );
            return;
          }
        } catch {
          /* fall through */
        }
      }

      // list_research_runs: tenant-scoped GET; flag-off refuse fail-closed (backend #263)
      // Backend #288: padded listed scope.tenantId must fail closed on validate.
      if (url.pathname === '/api/v2/context/research-runs' && req.method === 'GET') {
        if (flags.researchListRefuse) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              statusCode: 400,
              message: 'CONTEXT_GRAPH_RESEARCH is disabled',
              error: 'Bad Request',
            }),
          );
          return;
        }
        const tenantId = flags.researchListPaddedTenant ? ' t1 ' : 't1';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            runs: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                checkpointRevision: 0,
                objective: 'trace ARR',
                phase: 'running',
                scope: { tenantId },
              },
            ],
            engine: 'context_graph',
          }),
        );
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

      if (url.pathname === '/api/v2/context/operations/reserve') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            operation: { id: 'op-reserved-1' },
            replay: false,
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
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, seen, port: server.address().port, flags }),
    );
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
  const { server, seen, port, flags } = await startStub();
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

  await t.test(
    'query_context surrounding-padded text → padded_select_text',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'query_context',
        arguments: {
          text: ' discusses churn ',
          source_texts: ['discusses churn'],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.equal(res.result.structuredContent.details?.reason, 'padded_select_text');
      assert.match(res.result.content[0].text, /blank\/whitespace\/padded/);
      assert.equal(
        seen.slice(before).find((r) => r.path === '/api/v2/context/query'),
        undefined,
        'must refuse before HTTP — pads must not trim-launder into lexical seeds',
      );
    },
  );

  await t.test(
    'query_context leading/trailing pad text → padded_select_text (never select)',
    async () => {
      for (const text of [' churn', 'churn ']) {
        const before = seen.length;
        const res = await rpc('tools/call', {
          name: 'query_context',
          arguments: { text },
        });
        assert.equal(res.result.isError, true);
        assert.equal(res.result.structuredContent.details?.reason, 'padded_select_text');
        assert.equal(
          seen.slice(before).find((r) => r.path === '/api/v2/context/query'),
          undefined,
        );
      }
    },
  );

  await t.test(
    'query_context whitespace-only text → padded_select_text',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'query_context',
        arguments: { text: '   ' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.details?.reason, 'padded_select_text');
      assert.equal(
        seen.slice(before).find((r) => r.path === '/api/v2/context/query'),
        undefined,
      );
    },
  );

  await t.test(
    'query_context API padded_select_text gap → invalid_api_output',
    async () => {
      const res = await rpc('tools/call', {
        name: 'query_context',
        arguments: { text: 'padded_select_gap' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_api_output');
      assert.equal(res.result.structuredContent.details.reason, 'padded_select_text');
      assert.match(res.result.content[0].text, /padded_select_text/);
    },
  );

  await t.test(
    'query_context padded filter → padded_lookup_filter',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'query_context',
        arguments: {
          text: 'What was revenue in FY24?',
          filters: { metric: ' revenue ', period: 'FY24' },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.equal(res.result.structuredContent.details.reason, 'padded_lookup_filter');
      assert.match(res.result.content[0].text, /blank|whitespace|padded/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/query');
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'query_context whitespace-only filter → padded_lookup_filter',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'query_context',
        arguments: {
          text: 'What was revenue in FY24?',
          filters: { metric: '  ', period: 'FY24' },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.equal(res.result.structuredContent.details.reason, 'padded_lookup_filter');
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/query');
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'query_context API padded_lookup_filter gap → invalid_api_output',
    async () => {
      const res = await rpc('tools/call', {
        name: 'query_context',
        arguments: { text: 'padded_lookup_gap' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_api_output');
      assert.equal(res.result.structuredContent.details.reason, 'padded_lookup_filter');
      assert.match(res.result.content[0].text, /padded_lookup_filter/);
    },
  );

  await t.test(
    'query_context unknown/null filters still forward (honest unknowns)',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'query_context',
        arguments: {
          text: 'What was revenue in FY24?',
          filters: { metric: 'unknown', entityId: null, period: '' },
        },
      });
      assert.equal(res.result.isError, undefined);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/query');
      assert.ok(req);
      assert.equal(req.body.filters.metric, 'unknown');
      assert.equal(req.body.filters.entityId, null);
      assert.equal(req.body.filters.period, '');
    },
  );

  await t.test('compare_assertions returns same/different/unknown', async () => {
    const text = await call('compare_assertions', {
      left: { metric: 'revenue', period: 'FY24' },
      right: { metric: 'revenue', period: 'FY24' },
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/compare-assertions');
    assert.match(text, /\*\*Result:\*\* same/);
  });

  await t.test('resolve_fragment_uses posts selector catalog and keeps semanticSupport false', async () => {
    const text = await call('resolve_fragment_uses', {
      selector: {
        kind: 'tokens',
        representationId: 'rep-1',
        first: 12,
        lastExclusive: 13,
      },
      fragments: [
        {
          id: 'passage',
          ref: { sourceVersionId: 'sv1', sourceUnitId: 'u1', anchorId: 'a1' },
          selector: {
            kind: 'tokens',
            representationId: 'rep-1',
            first: 10,
            lastExclusive: 20,
          },
        },
      ],
      consumers: [{ fragment_id: 'passage', consumer_id: 'claim-c1', use_age: 'current' }],
      idempotency_key: 'frag-1',
    });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v2/context/fragments/resolve-uses');
    assert.equal(req.body.selector.kind, 'tokens');
    assert.equal(req.body.fragments[0].id, 'passage');
    assert.equal(req.idempotencyKey, 'frag-1');
    assert.match(text, /Fragment Uses/);
    assert.match(text, /passage/);
    assert.match(text, /contains/);
    assert.match(text, /semanticSupport=false/);
  });

  await t.test('resolve_fragment_uses posts sealed packet_id without client catalog', async () => {
    const text = await call('resolve_fragment_uses', {
      selector: {
        kind: 'tokens',
        representationId: 'rep-1',
        first: 12,
        lastExclusive: 13,
      },
      packet_id: 'packet-sealed-1',
      idempotency_key: 'frag-sealed-1',
    });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v2/context/fragments/resolve-uses');
    assert.equal(req.body.packet_id, 'packet-sealed-1');
    assert.equal(req.body.fragments, undefined);
    assert.equal(req.idempotencyKey, 'frag-sealed-1');
    assert.match(text, /Packet ID:\*\* packet-sealed-1/);
    assert.match(text, /semanticSupport=false/);
  });

  await t.test('resolve_fragment_uses posts sealed answer_revision_id', async () => {
    const text = await call('resolve_fragment_uses', {
      selector: {
        kind: 'tokens',
        representationId: 'rep-1',
        first: 12,
        lastExclusive: 13,
      },
      answer_revision_id: 'answer-sealed-1',
    });
    const req = seen.at(-1);
    assert.equal(req.body.answer_revision_id, 'answer-sealed-1');
    assert.equal(req.body.packet_id, undefined);
    assert.match(text, /Answer revision:\*\* answer-sealed-1/);
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

  await t.test('number_inventory posts occurrences and returns counts', async () => {
    const text = await call('number_inventory', {
      occurrences: [
        {
          id: 'occ-1',
          raw: '10',
          fragment_id: 'frag-a',
          normalized_decimal: '10',
          interpretation: 'unknown',
          method: 'native',
          recognition_state: 'read',
        },
        {
          id: 'occ-2',
          raw: '10',
          fragment_id: 'frag-b',
          normalized_decimal: '10',
          interpretation: 'unknown',
          method: 'native',
          recognition_state: 'read',
        },
        {
          id: 'occ-3',
          raw: '~12',
          fragment_id: 'frag-c',
          normalized_decimal: null,
          interpretation: 'unknown',
          method: 'native',
          recognition_state: 'uncertain',
        },
      ],
    });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v2/context/numbers/inventory');
    assert.equal(req.method, 'POST');
    assert.equal(req.body.occurrences.length, 3);
    assert.equal(req.body.occurrences[0].method, 'native');
    assert.match(text, /Coverage:\*\* complete/);
    assert.match(text, /Read:\*\* 2/);
    assert.match(text, /Uncertain:\*\* 1/);
    assert.match(text, /Occurrences:\*\* 3/);
  });

  await t.test('find_contradictions posts claims and returns count', async () => {
    const text = await call('find_contradictions', {
      claims: [
        { interval: { from: '2024-01-01', to: '2024-07-01' }, decimal_value: '10' },
        { interval: { from: '2024-04-01', to: '2024-10-01' }, decimal_value: '12' },
      ],
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/contradictions');
    assert.match(text, /Coverage:\*\* complete/);
    assert.match(text, /Count:\*\* 1/);
  });

  await t.test('find_contradictions disjoint missing decimal stays complete all-clear', async () => {
    const text = await call('find_contradictions', {
      claims: [
        { interval: { from: '2024-01-01', to: '2024-04-01' }, decimal_value: null },
        { interval: { from: '2024-07-01', to: '2024-10-01' }, decimal_value: '12' },
      ],
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/contradictions');
    assert.match(text, /Coverage:\*\* complete/);
    assert.match(text, /Count:\*\* 0/);
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

  await t.test('research run create/list/get/checkpoint hit C3 routes', async () => {
    const created = await call('create_research_run', {
      objective: 'trace ARR',
      snapshot_id: 'snap-1',
      workflow_version: 'wf-1',
      budget: { max_credits: 10, max_tokens: 1000, deadline_ms: 60_000 },
    });
    assert.equal(seen.at(-1).method, 'POST');
    assert.equal(seen.at(-1).path, '/api/v2/context/research-runs');
    assert.match(created, /Phase:\*\* running/);

    const listed = await call('list_research_runs', {});
    assert.equal(seen.at(-1).method, 'GET');
    assert.equal(seen.at(-1).path, '/api/v2/context/research-runs');
    assert.match(listed, /Count:\*\* 1/);

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

    // Backend #268/#277: complete wait subject + tenant identity forwards as-is (never trimmed).
    const waiting = await call('checkpoint_research_run', {
      run_id: '11111111-1111-1111-1111-111111111111',
      expected_revision: 1,
      run: {
        id: '11111111-1111-1111-1111-111111111111',
        checkpointRevision: 1,
        objective: 'trace ARR',
        phase: 'waiting',
        scope: { tenantId: 't1' },
        wait: {
          kind: 'source_ready',
          subjectId: 'src-1',
          subjectRevisionId: 'rev-2',
          expiresAtMs: 9999,
        },
      },
    });
    assert.match(waiting, /Phase:\*\* waiting/);
    const waitReq = seen.at(-1);
    assert.equal(waitReq.body.run.wait.subjectId, 'src-1');
    assert.equal(waitReq.body.run.wait.subjectRevisionId, 'rev-2');
    assert.equal(waitReq.body.run.scope.tenantId, 't1');
  });

  await t.test('research create/list/get/checkpoint/reserve refuse when CONTEXT_GRAPH_RESEARCH off', async () => {
    const created = await rpc('tools/call', {
      name: 'create_research_run',
      arguments: {
        objective: '__flag_off__',
        snapshot_id: 'snap-1',
        workflow_version: 'wf-1',
        budget: { max_credits: 10, max_tokens: 1000, deadline_ms: 60_000 },
      },
    });
    assert.equal(created.result.isError, true);
    assert.equal(created.result.structuredContent.code, 'api_error');
    assert.match(created.result.content[0].text, /CONTEXT_GRAPH_RESEARCH is disabled/);
    assert.match(created.result.content[0].text, /default-off|Do not invent/);
    assert.equal(created.result.structuredContent.details.flag, 'CONTEXT_GRAPH_RESEARCH');
    assert.equal(created.result.structuredContent.details.default_off, true);

    flags.researchListRefuse = true;
    const listed = await rpc('tools/call', {
      name: 'list_research_runs',
      arguments: {},
    });
    flags.researchListRefuse = false;
    assert.equal(listed.result.isError, true);
    assert.equal(listed.result.structuredContent.code, 'api_error');
    assert.match(listed.result.content[0].text, /CONTEXT_GRAPH_RESEARCH is disabled/);
    assert.equal(listed.result.structuredContent.details.flag, 'CONTEXT_GRAPH_RESEARCH');
    assert.equal(listed.result.structuredContent.details.default_off, true);

    const got = await rpc('tools/call', {
      name: 'get_research_run',
      arguments: { run_id: 'flag-off' },
    });
    assert.equal(got.result.isError, true);
    assert.equal(got.result.structuredContent.code, 'api_error');
    assert.match(got.result.content[0].text, /CONTEXT_GRAPH_RESEARCH is disabled/);
    assert.equal(got.result.structuredContent.details.default_off, true);

    const checkpointed = await rpc('tools/call', {
      name: 'checkpoint_research_run',
      arguments: {
        run_id: 'flag-off',
        expected_revision: 0,
        run: {
          id: 'flag-off',
          checkpointRevision: 0,
          objective: 'x',
          phase: 'running',
        },
      },
    });
    assert.equal(checkpointed.result.isError, true);
    assert.equal(checkpointed.result.structuredContent.code, 'api_error');
    assert.match(checkpointed.result.content[0].text, /CONTEXT_GRAPH_RESEARCH is disabled/);

    const reserved = await rpc('tools/call', {
      name: 'reserve_research_budget',
      arguments: {
        run_id: 'flag-off',
        idempotency_key: 'idem-flag-off',
        kind: 'step',
        credits: 1,
      },
    });
    assert.equal(reserved.result.isError, true);
    assert.equal(reserved.result.structuredContent.code, 'api_error');
    assert.match(reserved.result.content[0].text, /CONTEXT_GRAPH_RESEARCH is disabled/);
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

  await t.test(
    'resolve_seeds surrounding-padded metric filter → padded_resolve_filter',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'resolve_seeds',
        arguments: {
          text: 'What was revenue in FY24?',
          filters: { metric: ' revenue ', period: 'FY24' },
          index: [
            {
              id: 'n1',
              scope: { metric: 'revenue', period: 'FY24' },
              terms: ['revenue'],
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.equal(res.result.structuredContent.details?.reason, 'padded_resolve_filter');
      assert.match(res.result.content[0].text, /blank\/whitespace\/padded/);
      assert.equal(
        seen.slice(before).find((r) => r.path === '/api/v2/context/resolve-seeds'),
        undefined,
        'must refuse before HTTP — pads must not trim-launder into a scope_tuple',
      );
    },
  );

  await t.test(
    'resolve_seeds equal-pad filters → padded_resolve_filter (never pin)',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'resolve_seeds',
        arguments: {
          text: 'What was revenue in FY24?',
          filters: {
            entityId: ' acme ',
            metric: ' revenue ',
            period: ' FY24 ',
          },
          index: [
            {
              id: 'padded-full',
              scope: {
                entityId: ' acme ',
                metric: ' revenue ',
                period: ' FY24 ',
              },
              terms: ['revenue'],
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.details?.reason, 'padded_resolve_filter');
      assert.equal(
        seen.slice(before).find((r) => r.path === '/api/v2/context/resolve-seeds'),
        undefined,
      );
    },
  );

  await t.test(
    'resolve_seeds whitespace-only filter → padded_resolve_filter',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'resolve_seeds',
        arguments: {
          text: 'What was revenue in FY24?',
          filters: { metric: '  ', period: 'FY24' },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.details?.reason, 'padded_resolve_filter');
      assert.equal(
        seen.slice(before).find((r) => r.path === '/api/v2/context/resolve-seeds'),
        undefined,
      );
    },
  );

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

    const image = await call('format_certify', {
      kind: 'image',
      expected: ['digit-1'],
      found: [],
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/format/certify');
    assert.match(image, /Ok:\*\* no/);
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

    const reservedOp = await call('reserve_operation', {
      idempotency_key: 'reserve-key-1',
      kind: 'parse',
      credits: 3,
      root_operation_id: 'op-root-opened',
    });
    assert.equal(seen.at(-1).path, '/api/v2/context/operations/reserve');
    assert.match(reservedOp, /Operation:\*\* op-reserved-1/);
    assert.match(reservedOp, /Replay:\*\* no/);

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
    assert.match(impact, /Freshness coverage:\*\* complete/);
  });

  await t.test('get_change_impact packet path posts changed_ids and returns packet_impact', async () => {
    const text = await call('get_change_impact', {
      changed_ids: ['src-a'],
      packet_id: 'packet-1',
      links: [{ source_id: 'src-a', consumer_id: 'claim-1' }],
    });
    const req = seen.at(-1);
    assert.equal(req.path, '/api/v2/context/change-impact');
    assert.equal(req.method, 'POST');
    assert.deepEqual(req.body.changed_ids, ['src-a']);
    assert.equal(req.body.packet_id, 'packet-1');
    assert.equal(req.body.links[0].consumer_id, 'claim-1');
    assert.match(text, /Packet impact coverage:\*\* complete/);
    assert.match(text, /Affected consumers:\*\* 1/);
    assert.match(text, /claim-1/);
  });

  await t.test('eval_catalog denies private gold on the wire', async () => {
    const text = await call('eval_catalog', {});
    assert.equal(seen.at(-1).path, '/api/v2/context/eval/catalog');
    assert.match(text, /Private gold denied:\*\* yes/);

    const upload = await call('certify_private_upload', {});
    assert.equal(seen.at(-1).path, '/api/v2/context/private-upload/certify');
    assert.match(upload, /Ok:\*\* no/);
    assert.match(upload, /not_run/);

    const flag = await call('certify_retrieve_flag', {});
    assert.equal(seen.at(-1).path, '/api/v2/context/retrieve/flag');
    assert.match(flag, /Ok:\*\* yes/);
    assert.match(flag, /Enabled:\*\* no/);
    assert.match(flag, /Default off:\*\* yes/);
  });

  await t.test('Q_MCP_FAILURES: invalid argument is isError without crashing', async () => {
    const bad = await rpc('tools/call', { name: 'query_context', arguments: {} });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /invalid_argument|padded_select_text|incomplete/i);
    assert.equal(bad.result.structuredContent.details?.reason, 'padded_select_text');
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
  assert.ok(names.includes('resolve_fragment_uses'));

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
  const { server, seen, port, flags } = await startStub();
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

  await t.test('resolve_fragment_uses refuse is success with empty matches', async () => {
    const res = await rpc('tools/call', {
      name: 'resolve_fragment_uses',
      arguments: {
        selector: { kind: 'cells', representationId: 'rep-1', sheet: 'S', ranges: ['A1'] },
      },
    });
    assert.ok(!res.result.isError);
    assert.equal(res.result.structuredContent.status, 'refuse');
    assert.equal(res.result.structuredContent.matches.length, 0);
    assert.match(res.result.content[0].text, /Successful refuse/i);
  });

  await t.test('resolve_fragment_uses missing selector → invalid_argument', async () => {
    const res = await rpc('tools/call', { name: 'resolve_fragment_uses', arguments: {} });
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /invalid_argument/);
    assert.equal(res.result.structuredContent.code, 'invalid_argument');
  });

  await t.test('resolve_fragment_uses sealed id + client rows → invalid_argument', async () => {
    const res = await rpc('tools/call', {
      name: 'resolve_fragment_uses',
      arguments: {
        selector: { kind: 'tokens', representationId: 'rep-1', first: 0, lastExclusive: 1 },
        packet_id: 'packet-sealed-1',
        fragments: [{ id: 'sneak' }],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'invalid_argument');
    assert.match(res.result.content[0].text, /sealed_catalog_rejects_client_rows/);
  });

  await t.test('resolve_fragment_uses packet_id + answer_revision_id → invalid_argument', async () => {
    const res = await rpc('tools/call', {
      name: 'resolve_fragment_uses',
      arguments: {
        selector: { kind: 'tokens', representationId: 'rep-1', first: 0, lastExclusive: 1 },
        packet_id: 'packet-1',
        answer_revision_id: 'answer-1',
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'invalid_argument');
    assert.match(res.result.content[0].text, /mutually exclusive/);
  });

  await t.test('number_inventory missing occurrences → invalid_argument', async () => {
    const res = await rpc('tools/call', {
      name: 'number_inventory',
      arguments: {},
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'invalid_argument');
    assert.match(res.result.content[0].text, /occurrences/);
  });

  await t.test('number_inventory incomplete → api_error fail-closed', async () => {
    const res = await rpc('tools/call', {
      name: 'number_inventory',
      arguments: {
        occurrences: [
          {
            id: '',
            fragment_id: '',
            recognition_state: 'unreadable',
            normalized_decimal: '1.5',
          },
        ],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /number_inventory_incomplete/);
  });

  await t.test('find_contradictions blank interval endpoint → contradiction_scan_incomplete', async () => {
    const before = seen.length;
    const res = await rpc('tools/call', {
      name: 'find_contradictions',
      arguments: {
        claims: [
          { interval: { from: '   ', to: '2024-07-01' }, decimal_value: '10' },
          { interval: { from: '2024-04-01', to: '2024-10-01' }, decimal_value: '12' },
        ],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /contradiction_scan_incomplete/);
    assert.match(res.result.content[0].text, /unknown_interval_bounds/);
    const req = seen.slice(before).find((r) => r.path === '/api/v2/context/contradictions');
    assert.ok(req);
    // MCP must forward blank endpoints as-is — never invent bounds.
    assert.equal(req.body.claims[0].interval.from, '   ');
  });

  await t.test('find_contradictions missing decimal on overlap → missing_decimal_value', async () => {
    const res = await rpc('tools/call', {
      name: 'find_contradictions',
      arguments: {
        claims: [
          { interval: { from: '2024-01-01', to: '2024-07-01' }, decimal_value: null },
          { interval: { from: '2024-04-01', to: '2024-10-01' }, decimal_value: '12' },
        ],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /contradiction_scan_incomplete/);
    assert.match(res.result.content[0].text, /missing_decimal_value/);
  });

  await t.test('find_contradictions blank decimal on equal intervals → missing_decimal_value', async () => {
    const res = await rpc('tools/call', {
      name: 'find_contradictions',
      arguments: {
        claims: [
          { interval: { from: '2024-01-01', to: '2024-07-01' }, decimal_value: '  ' },
          { interval: { from: '2024-01-01', to: '2024-07-01' }, decimal_value: '12' },
        ],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /missing_decimal_value/);
  });

  await t.test('find_contradictions surrounding-padded interval endpoint → unknown_interval_bounds (#289)', async () => {
    const before = seen.length;
    const res = await rpc('tools/call', {
      name: 'find_contradictions',
      arguments: {
        claims: [
          { interval: { from: ' 2024-01-01 ', to: '2024-07-01' }, decimal_value: '10' },
          { interval: { from: '2024-04-01', to: '2024-10-01' }, decimal_value: '12' },
        ],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /contradiction_scan_incomplete/);
    assert.match(res.result.content[0].text, /unknown_interval_bounds/);
    const req = seen.slice(before).find((r) => r.path === '/api/v2/context/contradictions');
    assert.ok(req);
    // MCP must forward pads as-is — never trim-launder into certified known bounds.
    assert.equal(req.body.claims[0].interval.from, ' 2024-01-01 ');
  });

  await t.test('find_contradictions trailing-padded interval to → unknown_interval_bounds (#289)', async () => {
    const res = await rpc('tools/call', {
      name: 'find_contradictions',
      arguments: {
        claims: [
          { interval: { from: '2024-01-01', to: '2024-07-01 ' }, decimal_value: '10' },
          { interval: { from: '2024-01-01', to: '2024-07-01' }, decimal_value: '12' },
        ],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /unknown_interval_bounds/);
  });

  await t.test('find_contradictions surrounding-padded decimal → missing_decimal_value (#289)', async () => {
    const before = seen.length;
    const res = await rpc('tools/call', {
      name: 'find_contradictions',
      arguments: {
        claims: [
          { interval: { from: '2024-01-01', to: '2024-07-01' }, decimal_value: ' 10 ' },
          { interval: { from: '2024-04-01', to: '2024-10-01' }, decimal_value: '12' },
        ],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /contradiction_scan_incomplete/);
    assert.match(res.result.content[0].text, /missing_decimal_value/);
    const req = seen.slice(before).find((r) => r.path === '/api/v2/context/contradictions');
    assert.ok(req);
    // MCP must forward padded decimals as-is — never trim-launder into magnitudes.
    assert.equal(req.body.claims[0].decimal_value, ' 10 ');
  });

  await t.test('find_contradictions <2 claims → invalid_argument', async () => {
    const res = await rpc('tools/call', {
      name: 'find_contradictions',
      arguments: {
        claims: [{ interval: { from: '2024-01-01', to: '2024-07-01' }, decimal_value: '10' }],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'invalid_argument');
    assert.match(res.result.content[0].text, /claims/);
  });

  await t.test('number_inventory omits method → incomplete (never invent native)', async () => {
    const before = seen.length;
    const res = await rpc('tools/call', {
      name: 'number_inventory',
      arguments: {
        occurrences: [
          {
            id: 'occ-m',
            raw: '10',
            fragment_id: 'frag-m',
            interpretation: 'unknown',
            recognition_state: 'read',
          },
        ],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /number_inventory_incomplete/);
    assert.match(res.result.content[0].text, /invalid_occurrence_method/);
    const req = seen.slice(before).find((r) => r.path === '/api/v2/context/numbers/inventory');
    assert.ok(req);
    // MCP must forward omission as-is — never invent method=native.
    assert.equal(req.body.occurrences[0].method, undefined);
  });

  await t.test('number_inventory blank raw → incomplete missing_occurrence_raw', async () => {
    const res = await rpc('tools/call', {
      name: 'number_inventory',
      arguments: {
        occurrences: [
          {
            id: 'occ-blank',
            raw: '   ',
            fragment_id: 'frag-blank',
            method: 'native',
            interpretation: 'unknown',
            recognition_state: 'read',
          },
        ],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /missing_occurrence_raw/);
  });

  await t.test(
    'number_inventory surrounding-padded raw → missing_occurrence_raw',
    async () => {
      // " 12 " trim-equals a real glyph but must not certify workbench magnitude (#287).
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'number_inventory',
        arguments: {
          occurrences: [
            {
              id: 'pad',
              raw: ' 12 ',
              fragment_id: 'frag-pad',
              method: 'ocr',
              interpretation: 'unknown',
              recognition_state: 'read',
            },
            {
              id: 'tab',
              raw: '\t9\t',
              fragment_id: 'frag-tab',
              method: 'native',
              interpretation: 'unknown',
              recognition_state: 'uncertain',
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /number_inventory_incomplete/);
      assert.match(res.result.content[0].text, /missing_occurrence_raw/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/numbers/inventory');
      assert.ok(req);
      // Forward padded glyphs as-is — never strip into certified raw.
      assert.equal(req.body.occurrences[0].raw, ' 12 ');
      assert.equal(req.body.occurrences[1].raw, '\t9\t');
    },
  );

  await t.test(
    'number_inventory surrounding-padded interpretation → invalid_occurrence_interpretation',
    async () => {
      // " measure " trim-equals a real label but must not certify (#300).
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'number_inventory',
        arguments: {
          occurrences: [
            {
              id: 'pad',
              raw: '12',
              fragment_id: 'frag-pad',
              method: 'ocr',
              interpretation: ' measure ',
              recognition_state: 'read',
            },
            {
              id: 'tab',
              raw: '9',
              fragment_id: 'frag-tab',
              method: 'native',
              interpretation: '\tdate\t',
              recognition_state: 'uncertain',
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /number_inventory_incomplete/);
      assert.match(res.result.content[0].text, /invalid_occurrence_interpretation/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/numbers/inventory');
      assert.ok(req);
      // Forward padded labels as-is — never strip into certified enums.
      assert.equal(req.body.occurrences[0].interpretation, ' measure ');
      assert.equal(req.body.occurrences[1].interpretation, '\tdate\t');
    },
  );

  await t.test(
    'number_inventory surrounding-padded method → invalid_occurrence_method',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'number_inventory',
        arguments: {
          occurrences: [
            {
              id: 'pad',
              raw: '12',
              fragment_id: 'frag-pad',
              method: ' ocr ',
              interpretation: 'unknown',
              recognition_state: 'read',
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /number_inventory_incomplete/);
      assert.match(res.result.content[0].text, /invalid_occurrence_method/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/numbers/inventory');
      assert.ok(req);
      assert.equal(req.body.occurrences[0].method, ' ocr ');
    },
  );

  await t.test(
    'number_inventory surrounding-padded recognition → invalid_recognition_state',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'number_inventory',
        arguments: {
          occurrences: [
            {
              id: 'pad',
              raw: '12',
              fragment_id: 'frag-pad',
              method: 'ocr',
              interpretation: 'unknown',
              recognition_state: ' read ',
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /number_inventory_incomplete/);
      assert.match(res.result.content[0].text, /invalid_recognition_state/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/numbers/inventory');
      assert.ok(req);
      assert.equal(req.body.occurrences[0].recognition_state, ' read ');
    },
  );

  await t.test(
    'number_inventory whitespace-only identity → missing_occurrence_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'number_inventory',
        arguments: {
          occurrences: [
            {
              id: '  ',
              raw: '9',
              fragment_id: '\t',
              method: 'ocr',
              interpretation: 'unknown',
              recognition_state: 'read',
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /number_inventory_incomplete/);
      assert.match(res.result.content[0].text, /missing_occurrence_identity/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/numbers/inventory');
      assert.ok(req);
      // MCP must forward whitespace identity as-is — never invent ids.
      assert.equal(req.body.occurrences[0].id, '  ');
      assert.equal(req.body.occurrences[0].fragment_id, '\t');
    },
  );

  await t.test(
    'number_inventory surrounding-padded identity → missing_occurrence_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'number_inventory',
        arguments: {
          occurrences: [
            {
              id: ' occ ',
              raw: '9',
              fragment_id: 'frag-1',
              method: 'ocr',
              interpretation: 'unknown',
              recognition_state: 'read',
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /number_inventory_incomplete/);
      assert.match(res.result.content[0].text, /missing_occurrence_identity/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/numbers/inventory');
      assert.ok(req);
      // MCP must forward padded identity as-is — never strip into certified id.
      assert.equal(req.body.occurrences[0].id, ' occ ');
      assert.equal(req.body.occurrences[0].fragment_id, 'frag-1');
    },
  );

  await t.test(
    'number_inventory surrounding-padded fragment_id → missing_occurrence_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'number_inventory',
        arguments: {
          occurrences: [
            {
              id: 'occ-1',
              raw: '9',
              fragment_id: '\tfrag\t',
              method: 'native',
              interpretation: 'unknown',
              recognition_state: 'read',
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /missing_occurrence_identity/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/numbers/inventory');
      assert.ok(req);
      assert.equal(req.body.occurrences[0].fragment_id, '\tfrag\t');
    },
  );

  await t.test(
    'number_inventory blank/whitespace normalizedDecimal → blank_normalized_decimal',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'number_inventory',
        arguments: {
          occurrences: [
            {
              id: 'dec',
              raw: '9',
              fragment_id: 'frag-d',
              method: 'native',
              interpretation: 'unknown',
              recognition_state: 'read',
              normalizedDecimal: '  ',
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /number_inventory_incomplete/);
      assert.match(res.result.content[0].text, /blank_normalized_decimal/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/numbers/inventory');
      assert.ok(req);
      assert.equal(req.body.occurrences[0].normalizedDecimal, '  ');
    },
  );

  await t.test(
    'number_inventory surrounding-padded normalizedDecimal → blank_normalized_decimal',
    async () => {
      // " 12.5 " trim-equals a real magnitude but must not certify as exact decimal.
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'number_inventory',
        arguments: {
          occurrences: [
            {
              id: 'pad',
              raw: '12.5',
              fragment_id: 'frag-pad',
              method: 'ocr',
              interpretation: 'unknown',
              recognition_state: 'read',
              normalizedDecimal: ' 12.5 ',
            },
            {
              id: 'tab',
              raw: '7',
              fragment_id: 'frag-tab',
              method: 'native',
              interpretation: 'unknown',
              recognition_state: 'uncertain',
              normalized_decimal: '\t7\t',
            },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /number_inventory_incomplete/);
      assert.match(res.result.content[0].text, /blank_normalized_decimal/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/numbers/inventory');
      assert.ok(req);
      // Forward padded claimed magnitude as-is — never strip into certified decimal.
      assert.equal(req.body.occurrences[0].normalizedDecimal, ' 12.5 ');
      assert.equal(req.body.occurrences[1].normalized_decimal, '\t7\t');
    },
  );

  await t.test(
    'number_inventory null normalizedDecimal still completes',
    async () => {
      const res = await rpc('tools/call', {
        name: 'number_inventory',
        arguments: {
          occurrences: [
            {
              id: 'ok-null-dec',
              raw: '12',
              fragment_id: 'frag-ok',
              method: 'native',
              interpretation: 'unknown',
              recognition_state: 'read',
              normalizedDecimal: null,
            },
          ],
        },
      });
      assert.equal(res.result.isError, undefined);
      assert.match(res.result.content[0].text, /read|counts|coverage|complete/i);
    },
  );

  await t.test('number_inventory invalid interpretation → incomplete', async () => {
    const res = await rpc('tools/call', {
      name: 'number_inventory',
      arguments: {
        occurrences: [
          {
            id: 'occ-i',
            raw: '10',
            fragment_id: 'frag-i',
            method: 'native',
            interpretation: 'made_up',
            recognition_state: 'read',
          },
        ],
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /invalid_occurrence_interpretation/);
  });

  await t.test('get_change_impact missing both paths → invalid_argument', async () => {
    const res = await rpc('tools/call', {
      name: 'get_change_impact',
      arguments: {},
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'invalid_argument');
    assert.match(res.result.content[0].text, /answer_revision_id or changed_ids/);
  });

  await t.test('get_change_impact incomplete packet → api_error fail-closed', async () => {
    const res = await rpc('tools/call', {
      name: 'get_change_impact',
      arguments: {
        changed_ids: ['src-a'],
        packet_id: 'missing-packet',
      },
    });
    assert.equal(res.result.isError, true);
    assert.equal(res.result.structuredContent.code, 'api_error');
    assert.match(res.result.content[0].text, /change_impact_incomplete/);
    assert.match(res.result.content[0].text, /missing_dependency_graph|missing_sealed_packet/);
  });

  await t.test(
    'checkpoint_research_run whitespace wait subjectId → incomplete_wake_subject_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: '11111111-1111-1111-1111-111111111111',
          expected_revision: 0,
          run: {
            id: '11111111-1111-1111-1111-111111111111',
            checkpointRevision: 0,
            objective: 'trace ARR',
            phase: 'waiting',
            wait: {
              kind: 'source_ready',
              subjectId: '  ',
              subjectRevisionId: 'v2',
              expiresAtMs: 9999,
            },
          },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.match(res.result.content[0].text, /incomplete_wake_subject_identity|blank\/whitespace/);
      assert.match(res.result.content[0].text, /subjectId/);
      // Fail closed before HTTP — never invent a certified wake match.
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'checkpoint_research_run blank subjectRevisionId → incomplete_wake_subject_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: '11111111-1111-1111-1111-111111111111',
          expected_revision: 0,
          run: {
            id: '11111111-1111-1111-1111-111111111111',
            checkpointRevision: 0,
            objective: 'x',
            phase: 'waiting',
            wait: {
              kind: 'source_ready',
              subjectId: 's',
              subjectRevisionId: '',
              expiresAtMs: 9999,
            },
          },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.match(res.result.content[0].text, /incomplete_wake_subject_identity|blank\/whitespace/);
      assert.match(res.result.content[0].text, /subjectRevisionId/);
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'get_research_run blank wait subject identity → incomplete_wake_subject_identity',
    async () => {
      const res = await rpc('tools/call', {
        name: 'get_research_run',
        arguments: { run_id: 'blank-wait' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_api_output');
      assert.match(res.result.content[0].text, /incomplete_wake_subject_identity|blank\/whitespace/);
    },
  );

  await t.test(
    'checkpoint_research_run blank scope.tenantId → incomplete_wake_tenant_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: '11111111-1111-1111-1111-111111111111',
          expected_revision: 0,
          run: {
            id: '11111111-1111-1111-1111-111111111111',
            checkpointRevision: 0,
            objective: 'trace ARR',
            phase: 'waiting',
            scope: { tenantId: '  ' },
            wait: {
              kind: 'source_ready',
              subjectId: 'src',
              subjectRevisionId: 'v2',
              expiresAtMs: 9999,
            },
          },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.match(res.result.content[0].text, /incomplete_wake_tenant_identity|blank\/whitespace/);
      assert.match(res.result.content[0].text, /tenantId/);
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'get_research_run blank wait tenant identity → incomplete_wake_tenant_identity',
    async () => {
      const res = await rpc('tools/call', {
        name: 'get_research_run',
        arguments: { run_id: 'blank-tenant-wait' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_api_output');
      assert.match(res.result.content[0].text, /incomplete_wake_tenant_identity|blank\/whitespace/);
    },
  );

  await t.test(
    'checkpoint_research_run padded subjectId → incomplete_wake_subject_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: '11111111-1111-1111-1111-111111111111',
          expected_revision: 0,
          run: {
            id: '11111111-1111-1111-1111-111111111111',
            checkpointRevision: 0,
            objective: 'trace ARR',
            phase: 'waiting',
            scope: { tenantId: 't1' },
            wait: {
              kind: 'source_ready',
              subjectId: ' src ',
              subjectRevisionId: 'v2',
              expiresAtMs: 9999,
            },
          },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.match(res.result.content[0].text, /incomplete_wake_subject_identity|padded/);
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'checkpoint_research_run padded subjectRevisionId → incomplete_wake_subject_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: '11111111-1111-1111-1111-111111111111',
          expected_revision: 0,
          run: {
            id: '11111111-1111-1111-1111-111111111111',
            checkpointRevision: 0,
            objective: 'trace ARR',
            phase: 'waiting',
            scope: { tenantId: 't1' },
            wait: {
              kind: 'source_ready',
              subjectId: 'src',
              subjectRevisionId: ' v2',
              expiresAtMs: 9999,
            },
          },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.match(res.result.content[0].text, /incomplete_wake_subject_identity|padded/);
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'checkpoint_research_run padded scope.tenantId → incomplete_wake_tenant_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: '11111111-1111-1111-1111-111111111111',
          expected_revision: 0,
          run: {
            id: '11111111-1111-1111-1111-111111111111',
            checkpointRevision: 0,
            objective: 'trace ARR',
            phase: 'waiting',
            scope: { tenantId: ' t1 ' },
            wait: {
              kind: 'source_ready',
              subjectId: 'src',
              subjectRevisionId: 'v2',
              expiresAtMs: 9999,
            },
          },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.match(res.result.content[0].text, /incomplete_wake_tenant_identity|padded/);
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'get_research_run padded wait subject identity → incomplete_wake_subject_identity',
    async () => {
      const res = await rpc('tools/call', {
        name: 'get_research_run',
        arguments: { run_id: 'padded-wait' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_api_output');
      assert.match(res.result.content[0].text, /incomplete_wake_subject_identity|padded/);
    },
  );

  await t.test(
    'get_research_run padded wait tenant identity → incomplete_wake_tenant_identity',
    async () => {
      const res = await rpc('tools/call', {
        name: 'get_research_run',
        arguments: { run_id: 'padded-tenant-wait' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_api_output');
      assert.match(res.result.content[0].text, /incomplete_wake_tenant_identity|padded/);
    },
  );

  await t.test(
    'get_research_run padded note id → incomplete_eligible_note_identity',
    async () => {
      const res = await rpc('tools/call', {
        name: 'get_research_run',
        arguments: { run_id: 'padded-note' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_api_output');
      assert.match(res.result.content[0].text, /incomplete_eligible_note_identity|padded/);
    },
  );

  await t.test(
    'get_research_run padded note ResearchScope → incomplete_eligible_note_identity',
    async () => {
      const res = await rpc('tools/call', {
        name: 'get_research_run',
        arguments: { run_id: 'padded-note-scope' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_api_output');
      assert.match(res.result.content[0].text, /incomplete_eligible_note_identity|padded/);
    },
  );

  await t.test(
    'checkpoint_research_run padded note id → incomplete_eligible_note_identity',
    async () => {
      const before = seen.length;
      const scope = {
        tenantId: 't1',
        userId: 'u1',
        dealId: 'd1',
        sessionId: 's1',
      };
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: 'run-note-pad',
          expected_revision: 0,
          run: {
            id: 'run-note-pad',
            checkpointRevision: 0,
            objective: 'trace ARR',
            phase: 'running',
            scope,
            notes: [
              {
                id: ' n1 ',
                scope,
                kind: 'working_note',
                text: 'Check revenue',
                status: 'active',
              },
            ],
          },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.match(res.result.content[0].text, /incomplete_eligible_note_identity|padded/);
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'checkpoint_research_run padded note scope tenantId → incomplete_eligible_note_identity',
    async () => {
      const before = seen.length;
      const paddedScope = {
        tenantId: ' t1 ',
        userId: 'u1',
        dealId: 'd1',
        sessionId: 's1',
      };
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: 'run-note-scope-pad',
          expected_revision: 0,
          run: {
            id: 'run-note-scope-pad',
            checkpointRevision: 0,
            objective: 'trace ARR',
            phase: 'running',
            scope: paddedScope,
            notes: [
              {
                id: 'n1',
                scope: paddedScope,
                kind: 'working_note',
                text: 'Check revenue',
                status: 'active',
              },
            ],
          },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.match(res.result.content[0].text, /incomplete_eligible_note_identity|padded/);
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'checkpoint_research_run complete notes forward unpadded identities',
    async () => {
      const before = seen.length;
      const scope = {
        tenantId: 't1',
        userId: 'u1',
        dealId: 'd1',
        sessionId: 's1',
      };
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: 'run-note-ok',
          expected_revision: 0,
          run: {
            id: 'run-note-ok',
            checkpointRevision: 0,
            objective: 'trace ARR',
            phase: 'running',
            scope,
            notes: [
              {
                id: 'n1',
                scope,
                kind: 'working_note',
                text: 'Check revenue',
                status: 'active',
              },
            ],
          },
        },
      });
      assert.equal(res.result.isError, undefined);
      assert.equal(res.result.structuredContent.run.notes[0].id, 'n1');
      assert.equal(res.result.structuredContent.run.notes[0].scope.tenantId, 't1');
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.ok(req);
      assert.equal(req.body.run.notes[0].id, 'n1');
      assert.equal(req.body.run.scope.sessionId, 's1');
    },
  );

  await t.test(
    'create_research_run padded open_requirement_ids → incomplete_loop_requirement_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'create_research_run',
        arguments: {
          objective: 'trace ARR',
          snapshot_id: 'snap-1',
          workflow_version: 'wf-1',
          budget: { max_credits: 10, max_tokens: 1000, deadline_ms: 60_000 },
          open_requirement_ids: [' revenue '],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.equal(
        res.result.structuredContent.details.reason,
        'incomplete_loop_requirement_identity',
      );
      assert.match(res.result.content[0].text, /incomplete_loop_requirement_identity|padded/);
      const req = seen
        .slice(before)
        .find((r) => r.path === '/api/v2/context/research-runs' && r.method === 'POST');
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'create_research_run blank open_requirement_ids → incomplete_loop_requirement_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'create_research_run',
        arguments: {
          objective: 'trace ARR',
          snapshot_id: 'snap-1',
          workflow_version: 'wf-1',
          budget: { max_credits: 10, max_tokens: 1000, deadline_ms: 60_000 },
          open_requirement_ids: ['  '],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.equal(
        res.result.structuredContent.details.reason,
        'incomplete_loop_requirement_identity',
      );
      assert.match(res.result.content[0].text, /blank|whitespace|padded/);
      assert.equal(
        seen.slice(before).find((r) => r.path === '/api/v2/context/research-runs'),
        undefined,
      );
    },
  );

  await t.test(
    'get_research_run padded progress openRequirementIds → incomplete_loop_requirement_identity',
    async () => {
      const res = await rpc('tools/call', {
        name: 'get_research_run',
        arguments: { run_id: 'padded-progress' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_api_output');
      assert.match(res.result.content[0].text, /incomplete_loop_requirement_identity|padded/);
    },
  );

  await t.test(
    'checkpoint_research_run padded progress failedRequirementIds → incomplete_loop_requirement_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: 'run-progress-pad',
          expected_revision: 0,
          run: {
            id: 'run-progress-pad',
            checkpointRevision: 0,
            objective: 'trace ARR',
            phase: 'running',
            progress: {
              steps: 2,
              maxSteps: 32,
              consecutiveNoProgress: 0,
              openRequirementIds: [],
              failedRequirementIds: [' revenue '],
            },
          },
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.match(res.result.content[0].text, /incomplete_loop_requirement_identity|padded/);
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.equal(req, undefined);
    },
  );

  await t.test(
    'checkpoint_research_run complete progress forwards unpadded requirement ids',
    async () => {
      const before = seen.length;
      const progress = {
        steps: 2,
        maxSteps: 32,
        consecutiveNoProgress: 2,
        openRequirementIds: ['revenue'],
        failedRequirementIds: [],
      };
      const res = await rpc('tools/call', {
        name: 'checkpoint_research_run',
        arguments: {
          run_id: 'run-progress-ok',
          expected_revision: 0,
          run: {
            id: 'run-progress-ok',
            checkpointRevision: 0,
            objective: 'trace ARR',
            phase: 'running',
            progress,
          },
        },
      });
      assert.equal(res.result.isError, undefined);
      assert.equal(
        res.result.structuredContent.run.progress.openRequirementIds[0],
        'revenue',
      );
      const req = seen
        .slice(before)
        .find((r) => String(r.path || '').includes('/checkpoints'));
      assert.ok(req);
      assert.equal(req.body.run.progress.openRequirementIds[0], 'revenue');
    },
  );

  await t.test(
    'get_change_impact whitespace-only changed_ids → incomplete_changed_ids',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'get_change_impact',
        arguments: {
          changed_ids: ['  ', '\t'],
          links: [{ source_id: 'src-a', consumer_id: 'claim-1' }],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /change_impact_incomplete/);
      assert.match(res.result.content[0].text, /incomplete_changed_ids/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/change-impact');
      assert.ok(req);
      // MCP must forward whitespace roots as-is — never strip into certified empty impact.
      assert.deepEqual(req.body.changed_ids, ['  ', '\t']);
    },
  );

  await t.test(
    'get_change_impact surrounding-padded changed_ids → incomplete_changed_ids',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'get_change_impact',
        arguments: {
          changed_ids: [' cell '],
          links: [{ source_id: 'cell', consumer_id: 'claim-1' }],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /change_impact_incomplete/);
      assert.match(res.result.content[0].text, /incomplete_changed_ids/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/change-impact');
      assert.ok(req);
      // MCP must forward padded roots as-is — never strip into certified empty impact.
      assert.deepEqual(req.body.changed_ids, [' cell ']);
    },
  );

  await t.test(
    'get_change_impact mixed blank changed_ids → incomplete_changed_ids',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'get_change_impact',
        arguments: {
          changed_ids: ['src-a', ''],
          packet_id: 'packet-1',
          links: [{ source_id: 'src-a', consumer_id: 'claim-1' }],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /change_impact_incomplete/);
      assert.match(res.result.content[0].text, /incomplete_changed_ids/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/change-impact');
      assert.ok(req);
      assert.deepEqual(req.body.changed_ids, ['src-a', '']);
    },
  );

  await t.test(
    'get_change_impact surrounding-padded link source_id → incomplete_dependency_graph',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'get_change_impact',
        arguments: {
          changed_ids: ['cell'],
          links: [{ source_id: ' cell ', consumer_id: 'claim-1' }],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /change_impact_incomplete/);
      assert.match(res.result.content[0].text, /incomplete_dependency_graph/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/change-impact');
      assert.ok(req);
      // MCP must forward padded endpoints as-is — never trim into certified match.
      assert.deepEqual(req.body.links, [{ source_id: ' cell ', consumer_id: 'claim-1' }]);
    },
  );

  await t.test(
    'get_change_impact surrounding-padded link consumer_id → incomplete_dependency_graph',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'get_change_impact',
        arguments: {
          changed_ids: ['cell'],
          links: [{ source_id: 'cell', consumer_id: ' claim' }],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /change_impact_incomplete/);
      assert.match(res.result.content[0].text, /incomplete_dependency_graph/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/change-impact');
      assert.ok(req);
      assert.deepEqual(req.body.links, [{ source_id: 'cell', consumer_id: ' claim' }]);
    },
  );

  await t.test(
    'list_research_runs padded tenant_id arg → incomplete_list_tenant_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'list_research_runs',
        arguments: { tenant_id: ' t1 ' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.match(
        res.result.content[0].text,
        /incomplete_list_tenant_identity|blank\/whitespace\/padded/,
      );
      assert.equal(
        seen.slice(before).find((r) => r.path === '/api/v2/context/research-runs'),
        undefined,
        'must refuse before HTTP — pads must not trim-launder into a list',
      );
    },
  );

  await t.test(
    'list_research_runs blank tenantId arg → incomplete_list_tenant_identity',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'list_research_runs',
        arguments: { tenantId: '  ' },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_argument');
      assert.equal(
        res.result.structuredContent.details?.reason,
        'incomplete_list_tenant_identity',
      );
      assert.match(res.result.content[0].text, /blank\/whitespace\/padded/);
      assert.equal(
        seen.slice(before).find((r) => r.path === '/api/v2/context/research-runs'),
        undefined,
      );
    },
  );

  await t.test(
    'list_research_runs padded listed scope.tenantId → incomplete_list_tenant_identity',
    async () => {
      flags.researchListPaddedTenant = true;
      const res = await rpc('tools/call', {
        name: 'list_research_runs',
        arguments: {},
      });
      flags.researchListPaddedTenant = false;
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'invalid_api_output');
      assert.equal(
        res.result.structuredContent.details?.reason,
        'incomplete_list_tenant_identity',
      );
      assert.match(res.result.content[0].text, /blank\/whitespace\/padded/);
    },
  );

  await t.test(
    'get_change_impact blank/whitespace link endpoints → incomplete_dependency_graph',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'get_change_impact',
        arguments: {
          changed_ids: ['cell'],
          links: [{ source_id: 'cell', consumer_id: '  ' }],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /change_impact_incomplete/);
      assert.match(res.result.content[0].text, /incomplete_dependency_graph/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/change-impact');
      assert.ok(req);
      assert.deepEqual(req.body.links, [{ source_id: 'cell', consumer_id: '  ' }]);
    },
  );

  await t.test(
    'get_change_impact self-loop link (source_id === consumer_id) → self_loop_dependency',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'get_change_impact',
        arguments: {
          changed_ids: ['cell'],
          links: [{ source_id: 'cell', consumer_id: 'cell' }],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /change_impact_incomplete/);
      assert.match(res.result.content[0].text, /self_loop_dependency/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/change-impact');
      assert.ok(req);
      // Forward as-is — never drop self-loops into certified empty no-downstream.
      assert.deepEqual(req.body.links, [{ source_id: 'cell', consumer_id: 'cell' }]);
    },
  );

  await t.test(
    'get_change_impact mixed graph with self-loop → self_loop_dependency',
    async () => {
      const before = seen.length;
      const res = await rpc('tools/call', {
        name: 'get_change_impact',
        arguments: {
          changed_ids: ['cell'],
          links: [
            { source_id: 'cell', consumer_id: 'claim' },
            { source_id: 'claim', consumer_id: 'claim' },
          ],
        },
      });
      assert.equal(res.result.isError, true);
      assert.equal(res.result.structuredContent.code, 'api_error');
      assert.match(res.result.content[0].text, /change_impact_incomplete/);
      assert.match(res.result.content[0].text, /self_loop_dependency/);
      const req = seen.slice(before).find((r) => r.path === '/api/v2/context/change-impact');
      assert.ok(req);
      assert.deepEqual(req.body.links, [
        { source_id: 'cell', consumer_id: 'claim' },
        { source_id: 'claim', consumer_id: 'claim' },
      ]);
    },
  );

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
