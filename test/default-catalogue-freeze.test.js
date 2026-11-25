const test = require('node:test');
const assert = require('node:assert/strict');
const { createMcpServer } = require('../dist/index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

// Frozen default catalogue. Directory reviews (OpenAI, Claude) rescan tool lists and
// descriptions, and the selection eval in eval/tool-selection scores against them, so
// a change to a default tool's name, position or first sentence, or to the always-loaded
// set, must be deliberate: update this list in the same change and rerun the eval.
// "First sentence" is the description up to the first ., ! or ? followed by whitespace.
const FROZEN_PUBLIC = [
  ["webcite_guide", "Lists Webcite workflows (parse a document, verify a claim, check quotes, review a whole document, check figures, trace a source) with inputs, order and cost."],
  ["get_credit_balance", "Read the authenticated account credit balance for an explicit balance question or an unresolved credit refusal."],
  ["verify_claim", "Fact-check one claim against web sources: returns citations, a stance for each source (supports/contradicts/neutral) and a verdict."],
  ["search_sources", "Search the web for sources on a query and return citations, without stance or verdict."],
  ["get_source_preview", "Open a citation at its quoted passage in the source, to show the evidence."],
  ["verify_batch", "Check that quotes appear in the sources you provide (text, URL or uploaded file), many at once."],
  ["upload_file", "Upload a PDF, scan, image, spreadsheet or office file to Webcite and get an asset_id for extraction or review."],
  ["extract_document", "Parse a PDF, scan, spreadsheet or office file to Markdown page by page (OCR included), with the page or sheet each part came from."],
  ["extract_figures", "Extract financial figures from a document with units, periods and source locations."],
  ["list_citations", "List your past verification results."],
  ["get_citation", "Get the full details of a specific past verification by its ID."],
  ["analyze_conflicts", "Recompute totals and flag figures that conflict across the figures you supply."],
  ["upload_url", "Upload a file from a public HTTPS URL to Webcite and get an asset_id for extraction or review."],
  ["analyze_document", "Analyze figures in an uploaded PDF, spreadsheet or JPEG/PNG/WebP image."],
  ["classify_document", "Classify a document into a coarse **category** plus the fine multi-type **covers** it holds (a bundled workbook covers several)."],
  ["document_gaps", "The \"usually also here\" checklist for a category."],
  ["accuracy_report", "The numeric engine's measured accuracy against its gold-set corpus: conflict detection rate and precision, and recompute correctness."],
  ["verify_feedback", "Record a human verdict on a verify_batch result."],
  ["verify_claim_stream", "Verify a factual claim using the streaming endpoint."],
  ["ask_document", "Check numerical answers inside supplied document text."],
  ["extract_pages", "Split an uploaded document into citation-ready chunks with page, sheet or section anchors, for RAG indexing."],
  ["get_ask_result", "Poll a document question job."],
  ["get_document_review", "Read a document review: claims, verdicts, citations and passages not covered."],
  ["get_document_review_job", "Check progress of a document review job."],
  ["get_latest_representation", "Locate the latest representation and source unit IDs of an owned retained source."],
  ["get_review_source_span", "Read the exact text of one owned saved uncovered source passage for review, including an inactive failed residual review."],
  ["prepare_ocr_rescue", "Prepare judged OCR rescue for an owned OCR source representation before previewing unresolved citations."],
  ["publish_text_representation", "Publish a deterministic text or CSV representation of an owned retained source."],
  ["read_source_unit", "Read one owned immutable source unit by the IDs returned from a source representation."],
  ["record_review_nonclaim", "Record an explicit assessment that an exact source-attested heading, table title or navigation passage contains no factual assertion."],
  ["register_source", "Register original text or CSV bytes for an uploaded, owned asset."],
  ["review_document", "Fact-check every material claim in an uploaded document and report coverage; starts a job and returns a job_id."],
  ["revise_document_claim_analysis", "Re-evaluate one owned, settled saved claim using retained snippets and the current evidence policy, without new research, model calls or credits."],
  ["verify_numeric_claim", "Assess arithmetic against one or two retained figures from owned source units."],
];

const ALWAYS_LOADED = ['webcite_guide', 'verify_claim', 'extract_document', 'review_document'];

// Hosted MCP replaces only upload_file's description (it cannot read a local path).
const HOSTED_UPLOAD_FILE = 'Small-file compatibility upload: caller-provided base64 bytes, up to 20 MB decoded.';

const firstSentence = (d) => d.split(/(?<=[.!?])\s/)[0];

async function listed(remote) {
  const server = createMcpServer(/** @type {any} */ ({}), 'public', remote);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'freeze-test', version: '1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

for (const remote of [false, true]) {
  test(`default profile keeps its 34 tool names, order and first sentences (remote=${remote})`, async () => {
    const tools = await listed(remote);
    const expected = FROZEN_PUBLIC.map(([name, sentence]) =>
      [name, remote && name === 'upload_file' ? HOSTED_UPLOAD_FILE : sentence]);
    assert.equal(tools.length, 34);
    assert.deepEqual(tools.map((t) => [t.name, firstSentence(t.description)]), expected);
  });

  test(`exactly the four always-loaded tools carry anthropic/alwaysLoad over MCP (remote=${remote})`, async () => {
    const tools = await listed(remote);
    assert.deepEqual(tools.filter((t) => t._meta?.['anthropic/alwaysLoad'] === true).map((t) => t.name).sort(), [...ALWAYS_LOADED].sort());
    for (const t of tools) {
      if (!ALWAYS_LOADED.includes(t.name)) assert.equal(t._meta, undefined, t.name);
    }
  });
}
