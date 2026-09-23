const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createMcpServer } = require('../dist/index.js');
const { WebCiteApiClient } = require('../dist/api-client.js');

const source = {
  id: 'source-real', title: 'Publisher', url: 'https://example.com/page', snippet: 'Publisher passage.',
  credibility_score: 0, credibility_basis: 'heuristic', stance: 'neutral', stance_confidence: 0,
  snippet_source: 'fetched', evidence: { version: 1, state: 'matched', contentHash: 'hash', quoteMatch: 'exact' },
};
const result = {
  citations: [source, { ...source, id: 'unknown-source', credibility_score: null, credibility_basis: 'unknown' }],
  verdict: { result: 'unverifiable', confidence: 0, confidence_basis: 'heuristic', summary: 'Unknown applicability.',
    evidence_status: 'context_only', key_findings: [{ finding: 'Background only.', confidence: 90,
      confidence_basis: 'unknown', evidence_role: 'context' }] },
  citation_id: 'citation-real', request_id: 'request-real', operation_id: 'operation-real',
  metadata: { policy_version: 5 }, custom_backend_field: { preserved: true },
};

test('verdict separates aggregation, calibrated confidence and contextual findings', () => {
  const { formatVerdict } = require('../dist/formatters.js');
  const verdict = { ...result.verdict, confidence: 37, evidence_status: 'context_only',
    key_findings: [{ finding: 'Highest above sea level.', confidence: 90,
      confidence_basis: 'unknown', evidence_role: 'context' }] };
  const text = formatVerdict(verdict);
  assert.match(text, /Confidence:\*\* unavailable/);
  assert.match(text, /Aggregation score: 37 \(uncalibrated\)/);
  assert.match(text, /Evidence:\*\* context_only/);
  assert.match(text, /Context: Highest above sea level/);
  assert.doesNotMatch(text, /90%|37%/);
  assert.match(formatVerdict({ ...verdict, confidence: 0, confidence_basis: 'calibrated', confidence_available: true }), /Calibrated confidence:\*\* 0%/);
  assert.doesNotMatch(formatVerdict({ ...verdict, confidence_basis: 'calibrated', confidence_available: false }), /Calibrated confidence/);
  assert.match(formatVerdict({ ...verdict, confidence: null, aggregation_score: 0 }), /Aggregation score: 0/);
});

test('verification evidence survives HTTP API and MCP transport', async (t) => {
  let mode = 'normal';
  const seen = [];
  const api = http.createServer(async (req, res) => {
    seen.push(req.url);
    for await (const _ of req) { /* consume request */ }
    if (req.url.endsWith('/stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frames = mode === 'partial'
        ? [{ type: 'claim_group', data: { claim: 'claim', citations: [source] } }]
        : [{ type: 'result', data: result }, ...(mode === 'missing-done' ? [] : [
          ...(mode === 'accounting-error' ? [{ type: 'accounting_error', message: 'failed' }] : []),
          { type: 'usage', operation_id: 'operation-real', usage: { credits: 2 } }, { type: 'done' },
        ])];
      // Force field and UTF-8 boundaries across network chunks, including CRLF.
      for (const frame of frames) {
        const text = mode === 'named-stream'
          ? `event: ${frame.type}\r\ndata: ${JSON.stringify(frame.data ?? frame)}\r\n\r\n`
          : `data: ${JSON.stringify(frame)}\r\n\r\n`;
        const split = mode === 'named-stream' ? text.indexOf('data:') : 3;
        res.write(text.slice(0, split));
        await new Promise((resolve) => setImmediate(resolve));
        res.write(text.slice(split));
      }
      res.end();
      return;
    }
    let payload = result;
    if (req.url.includes('/citations/')) {
      payload = { data: { id: 'citation-real', prompt: 'claim', citation:
        mode === 'malformed' ? '{bad' : mode === 'wrong-shape' ? '{}' :
        mode === 'stored-object-final' ? JSON.stringify(result) : mode === 'object' ? JSON.stringify({ citations: result.citations }) : JSON.stringify(result.citations),
        ...(mode === 'stored-final' ? { metadata: { final_response: result } } : {}),
      } };
    }
    if (req.url.endsWith('/batch')) payload = [{ id: 'batch-real', quote: 'claim', binding: { grounded: false, method: 'unbound', score: 0 }, verification: { grounded: false, layer: 'none', band: 'unverified', confidence: 0 }, feedback_token: 'token' }];
    if (mode === 'invalid-result') payload = { citations: 'not-an-array' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const server = createMcpServer(new WebCiteApiClient('test-only', `http://127.0.0.1:${api.address().port}`), 'full');
  const client = new Client({ name: 'evidence-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); await new Promise((resolve) => api.close(resolve)); });
  const call = (name, args) => client.callTool({ name, arguments: args });

  await t.test('verify preserves all evidence and real IDs, unknown and zero differ', async () => {
    const response = await call('verify_claim', { claim: 'claim' });
    assert.equal(response.isError, undefined);
    assert.deepEqual(response.structuredContent, result);
    const text = response.content[0].text;
    assert.match(text, /Credibility: 0\/100 \(basis: heuristic\)/);
    assert.match(text, /Credibility: unknown \(basis: unknown\)/);
    assert.match(text, /0% model-reported stance/);
    assert.match(text, /citation-real/);
    assert.match(text, /request-real/);
    assert.match(text, /operation-real/);
    assert.match(text, /Evidence: matched/);
    assert.match(text, /Evidence:\*\* context_only/);
    assert.match(text, /Context: Background only/);
    assert.match(text, /Aggregation score: 0 \(uncalibrated\)/);
    assert.doesNotMatch(text, /undefined|null%|Result URL|Thread ID/);
  });
  for (const storedMode of ['normal', 'object', 'stored-final', 'stored-object-final']) await t.test(`readback ${storedMode}`, async () => {
    mode = storedMode;
    const response = await call('get_citation', { citation_id: 'citation-real' });
    assert.equal(response.isError, undefined);
    assert.deepEqual(response.structuredContent.citations, result.citations);
    if (mode === 'stored-final' || mode === 'stored-object-final') {
      assert.deepEqual(response.structuredContent.final_response, result);
      assert.match(response.content[0].text, /UNVERIFIABLE/);
      assert.match(response.content[0].text, /Context: Background only/);
    } else assert.match(response.content[0].text, /legacy record/);
    assert.match(seen.at(-1), /citations\/citation-real/);
  });
  for (const bad of ['malformed', 'wrong-shape']) await t.test(`reject ${bad} storage`, async () => {
    mode = bad;
    const response = await call('get_citation', { citation_id: 'citation-real' });
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent.code, 'invalid_api_output');
  });
  await t.test('completed stream and batch retain structured records', async () => {
    mode = 'normal';
    const response = await call('verify_claim_stream', { claim: 'claim' });
    assert.equal(response.isError, undefined);
    assert.deepEqual(response.structuredContent.citations, result.citations);
    assert.equal(response.structuredContent.stream_usage.usage.credits, 2);
    const batch = await call('verify_batch', { items: [{ quote: 'claim', source_text: 'text' }] });
    assert.equal(batch.structuredContent.results[0].binding.score, 0);
    assert.equal(batch.structuredContent.results[0].id, 'batch-real');
  });
  for (const failure of ['partial', 'missing-done', 'accounting-error']) await t.test(`stream ${failure} fails`, async () => {
    mode = failure;
    const response = await call('verify_claim_stream', { claim: 'claim' });
    assert.equal(response.isError, true);
    assert.equal(response.structuredContent.code, 'partial_result');
  });
  await t.test('named SSE events survive chunk boundaries', async () => {
    mode = 'named-stream';
    const response = await call('verify_claim_stream', { claim: 'claim' });
    assert.equal(response.isError, undefined);
    assert.deepEqual(response.structuredContent.citations, result.citations);
  });
  await t.test('invalid verify output is visible', async () => {
    mode = 'invalid-result';
    const response = await call('verify_claim', { claim: 'claim' });
    assert.equal(response.structuredContent.code, 'invalid_api_output');
  });
});

 test('verify idempotency key is an HTTP header and never part of the claim body', async () => {
 const original = global.fetch; let request;
 global.fetch = async (_url, init) => { request=init; return {ok:true,json:async()=>result}; };
 try { const client = new WebCiteApiClient('test-key','https://example.test');
 await client.verifyClaim({claim:'same claim',idempotency_key:'stable-retry-key'});
 assert.equal(request.headers['Idempotency-Key'],'stable-retry-key');
 assert.equal(JSON.parse(request.body).idempotency_key,undefined);
 } finally { global.fetch=original; }
 });

 test('unknown stance confidence does not display a placeholder zero as measured', () => {
  const { formatCitation } = require('../dist/formatters.js');
  const text = formatCitation({...source, stance:'inconclusive', stance_confidence_basis:'unknown'}, 0);
  assert.match(text, /confidence unknown/);
  assert.doesNotMatch(text, /0% model-reported stance confidence/);
  assert.match(formatCitation({...source, stance_confidence_basis:'measured'}, 0), /0% model-reported stance confidence/);
});
