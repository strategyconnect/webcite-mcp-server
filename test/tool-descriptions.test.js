const test = require('node:test');
const assert = require('node:assert/strict');
const { ALL_TOOLS } = require('../dist/tools.js');
const { createMcpServer } = require('../dist/index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

// Directory listings (Claude, ChatGPT) reject tool descriptions that tell the
// model to call other tools, and promotional or free-plan wording. Workflow
// guidance lives in the webcite_guide output and the server instructions.
const toolNames = ALL_TOOLS.map((t) => t.name).join('|');
const INSTRUCTION_PATTERNS = [
  /\b(call|use|run|invoke)\b.{0,40}\b(webcite_|get_|extract_|upload_|review_|verify_)/i,
  new RegExp(`\\b(call|calls|use|run|invoke|poll|prefer|feed|inspect|then|first)\\b[^.\\n]{0,60}\\b(${toolNames})\\b`, 'i'),
  new RegExp(`\\b(${toolNames})\\b[^.\\n]{0,40}\\b(first|before)\\b`, 'i'),
  /\bdo not substitute\b/i,
  /\bprefer this\b/i,
  /(?<!-)\bfree\b/i,
];

function offending(description) {
  return INSTRUCTION_PATTERNS.filter((re) => re.test(description)).map(String);
}

async function listedTools(remote) {
  const server = createMcpServer(/** @type {any} */ ({}), 'full', remote);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

test('pattern set catches cross-tool instructions (positive control)', () => {
  for (const sample of [
    'Call this free guide first to choose a Webcite workflow.',
    'call review_document once with its asset_id',
    'Poll get_document_review_job until terminal, then page through get_document_review.',
    'Feed the result straight into analyze_conflicts.',
    'Prefer this over verify_claim when the claim is complex.',
    'Inspect its full text first with get_review_source_span',
  ]) {
    assert.notDeepEqual(offending(sample), [], sample);
  }
  assert.deepEqual(offending('Returns a job ID accepted by get_ask_result. Costs 0 credits.'), []);
});

for (const remote of [false, true]) {
  test(`no listed tool description instructs calls to other tools (remote=${remote})`, async () => {
    const tools = await listedTools(remote);
    assert.equal(tools.length, ALL_TOOLS.length);
    const bad = tools
      .map((t) => ({ name: t.name, hits: offending(t.description ?? '') }))
      .filter((t) => t.hits.length > 0);
    assert.deepEqual(bad, []);
  });
}
