const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filterToolsByProfile,
  resolveProfile,
  SERVER_INSTRUCTIONS,
} = require('../dist/profiles.js');
const { ALL_TOOLS } = require('../dist/tools.js');
const { WEBCITE_GUIDE_TOOL } = require('../dist/guide.js');
const { withAnnotations } = require('../dist/tool-annotations.js');
const { runSmoke } = require('../dist/index.js');
const { handlers } = require('../dist/handlers.js');

test('local profile defaults to all public tools', () => {
  assert.equal(resolveProfile(''), 'public');
  assert.equal(resolveProfile('nope'), 'public');
  const previous = process.env.WEBCITE_MCP_PROFILE;
  delete process.env.WEBCITE_MCP_PROFILE;
  try { assert.equal(resolveProfile(), 'public'); }
  finally {
    if (previous === undefined) delete process.env.WEBCITE_MCP_PROFILE;
    else process.env.WEBCITE_MCP_PROFILE = previous;
  }
  assert.equal(filterToolsByProfile(ALL_TOOLS, resolveProfile('')).length,
    filterToolsByProfile(ALL_TOOLS, 'public').length);
});

test('core profile is short and starts with guide', () => {
  const core = filterToolsByProfile(ALL_TOOLS, 'core');
  assert.equal(core.length, 16);
  for (const name of ['upload_url', 'review_document', 'get_document_review_job', 'get_document_review']) {
    assert.ok(core.some((t) => t.name === name), `${name} absent from core profile`);
  }
  assert.equal(core[0].name, 'webcite_guide');
  assert.deepEqual(core[0], withAnnotations(WEBCITE_GUIDE_TOOL));
  assert.ok(core[0].inputSchema.properties.workflow.enum.includes('document_review'));
  assert.ok(core.some((t) => t.name === 'verify_claim'));
  assert.ok(!core.some((t) => t.name === 'eval_catalog'));
});

test('full profile retains every tool', () => {
  assert.equal(
    filterToolsByProfile(ALL_TOOLS, 'full').length,
    ALL_TOOLS.length,
  );
});

test('public profile includes public workflows without internal controls', () => {
  const names = new Set(filterToolsByProfile(ALL_TOOLS, 'public').map((tool) => tool.name));
  for (const name of ['ask_document', 'get_ask_result', 'extract_pages', 'prepare_ocr_rescue', 'verify_numeric_claim']) {
    assert.ok(names.has(name), `${name} absent from public profile`);
  }
  for (const name of ['eval_catalog', 'reserve_operation', 'query_context']) {
    assert.ok(!names.has(name), `${name} leaked into public profile`);
  }
});

test('server instructions name verify_claim and carry no plan or start order', () => {
  assert.match(SERVER_INSTRUCTIONS, /verify_claim/);
  assert.match(SERVER_INSTRUCTIONS, /webcite_guide with workflow=choose/);
  // Directory listings reject plan promotion and imperative start orders.
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /free plan|credits\/month/i);
  assert.doesNotMatch(SERVER_INSTRUCTIONS, /\bSTART:/);
});

test('webcite_guide handler is zero-API', async () => {
  const result = await handlers.webcite_guide(
    { workflow: 'quick_verify' },
    /** @type {any} */ ({}),
  );
  assert.match(result.text, /verify_claim/);
});

test('source tracing uses extraction, source search and preview instead of numeric Q&A', async () => {
  const result = await handlers.webcite_guide(
    { workflow: 'source_trace' },
    /** @type {any} */ ({}),
  );
  assert.match(result.text, /extract_document/);
  assert.match(result.text, /search_sources/);
  assert.match(result.text, /get_source_preview/);
  assert.match(result.text, /ask_document.*does not discover external source URLs/);
  assert.match(SERVER_INSTRUCTIONS, /workflow: 'source_trace'/);
  assert.match(ALL_TOOLS.find((tool) => tool.name === 'ask_document').description,
    /does not search for external source URLs/);
});

test('document review guide covers every claim without treating metric extraction as complete', async () => {
  const result = await handlers.webcite_guide(
    { workflow: 'document_review' },
    /** @type {any} */ ({}),
  );
  assert.match(result.text, /every material figure/);
  assert.match(result.text, /zero results does not mean there are no numbers/);
  assert.match(result.text, /verify_claim/);
  assert.match(result.text, /get_document_review/);
  assert.match(result.text, /There is no fixed claim count/);
  assert.match(result.text, /one structured OCR pass.*partial reads and errors/);
  assert.match(result.text, /PDF coordinates preserve table year\/value bindings/);
  assert.match(result.text, /PPTX native rendering retains the slide inventory, including unreadable slides/);
  assert.match(result.text, /Native-only source reads do not establish complete raster coverage/);
  const ordinaryOcr = /Ordinary text OCR does not provide bounding boxes or certification/;
  const visualEvidence = /separate model-generated partial representation[\s\S]*server rechecks source bytes, literal offsets and geometry/;
  assert.match(result.text, ordinaryOcr);
  assert.match(result.text, visualEvidence);
  assert.match(result.text, /partial, unreadable and error states and their OCR method across PDF and PowerPoint/);
  assert.match(result.text, /mixed full-scope review includes narrative assertions and scope qualifications as well as numbers/);
  assert.match(result.text, /Bind HTML table numbers to exact original cells and headers, including uniquely matched footer years/);
  assert.match(result.text, /Do not flatten table cells into prose or guess ambiguous years; leave unresolved bindings as source gaps/);
  assert.match(result.text, /source_assessment \(version: 1\)/);
  assert.match(result.text, /source_assessment_summary separately from the original report claim/);
  assert.match(result.text, /Literal Unicode table labels remain anchored to the original source cells and headers/);
  assert.match(result.text, /Numeric-only labels and unresolved bindings remain unknown/);
  assert.match(result.text, /short source label alone does not establish that external retrieval found readable evidence/);
  assert.match(result.text, /summary is not the exact saved stance identity/);
  assert.match(result.text, /outer claim and claim_id retain the original report description and identity/);
  assert.match(result.text, /basis is original_claim or source_table/);
  assert.match(result.text, /Missing metadata on older saved rows is unknown/);
  assert.match(result.text, /changing its predicate requires fresh analysis/);
  assert.match(result.text, /Structural topic headings and connectors between retained literal clauses do not become extra claims; omitted qualifications remain coverage gaps/);
  assert.match(result.text, /Source evidence and successful judgments retain their server-verified identity across response projection and cache replay for the exact claim/);
  assert.match(result.text, /A copied or changed receipt cannot supply that identity/);
  assert.match(result.text, /literal source context without treating proximity or relevance as proof of a metric, observation period or unit/);
  assert.match(result.text, /standard ISO currency codes, literal currency symbols and explicit nonfinancial Unit: or Units: declarations/);
  assert.match(result.text, /Unknown or ambiguous headers, units and periods stay unknown/);
  assert.match(result.text, /do not infer a currency from an ambiguous symbol/);
  assert.match(SERVER_INSTRUCTIONS, /document_review/);
});

test('full slide audits and image numerics route to supported tools', () => {
  const publicTools = filterToolsByProfile(ALL_TOOLS, 'public');
  const description = (name) => publicTools.find((tool) => tool.name === name)?.description ?? '';
  assert.match(SERVER_INSTRUCTIONS, /every figure on a slide.*review_document/i);
  assert.match(description('review_document'), /check every figure on this slide/i);
  assert.match(description('analyze_document'), /JPEG\/PNG\/WebP image/);
  assert.match(description('verify_claim'), /one specific claim/);
  assert.match(description('webcite_guide'), /workflow=document_review/);
  assert.match(description('extract_document'), /whole-document or whole-slide external fact-checking is done by review_document/);
  assert.match(description('review_document'), /Unlike separate single-claim checks, it covers every claim/);
  assert.match(description('extract_document'), /MCP clients omit structuredContent.*read_source_unit/);
  for (const name of ['verify_claim', 'verify_claim_stream']) {
    assert.equal(publicTools.find((tool) => tool.name === name).inputSchema.properties.source_urls.maxItems, 5);
  }
  const numericGuide = require('../dist/guide.js').renderWebciteGuide({ workflow: 'numeric' });
  assert.match(numericGuide, /zero metrics does not mean/);
  assert.match(numericGuide, /JPEG\/PNG\/WebP.*review_document/);
  assert.match(numericGuide, /Rejected prose may retain its original assumption-basis annotation as context only/);
  assert.match(numericGuide, /A year, date or year-range label or identifier with any basis annotation remains ineligible/);
  assert.match(numericGuide, /date label, ordered year-range label/);
  assert.match(numericGuide, /whole retained spreadsheet cell under its Date or Year context/);
  assert.match(numericGuide, /not a public MCP tool or an approved Figure/);
  assert.match(numericGuide, /count contextual decisions separately from reviewed numeric assertions/);
  assert.match(numericGuide, /candidate\.raw can be printed display text.*sourceRawLexeme is the sealed stored cell value/);
  assert.match(numericGuide, /expectedRawLexeme must use that stored value, never the rounded display/);
});

test('runSmoke reports core defaults', () => {
  const smoke = runSmoke('core');
  assert.equal(smoke.ok, true);
  assert.equal(smoke.toolCount, filterToolsByProfile(ALL_TOOLS, 'core').length);
});

test('the default public profile serves the same tools in the same order as 1.9.65', () => {
  assert.deepEqual(filterToolsByProfile(ALL_TOOLS, 'public').map((t) => t.name), ["webcite_guide", "get_credit_balance", "verify_claim", "search_sources", "get_source_preview", "verify_batch", "upload_file", "extract_document", "extract_figures", "list_citations", "get_citation", "analyze_conflicts", "upload_url", "analyze_document", "classify_document", "document_gaps", "accuracy_report", "verify_feedback", "verify_claim_stream", "ask_document", "extract_pages", "get_ask_result", "get_document_review", "get_document_review_job", "get_latest_representation", "get_review_source_span", "prepare_ocr_rescue", "publish_text_representation", "read_source_unit", "record_review_nonclaim", "register_source", "review_document", "revise_document_claim_analysis", "verify_numeric_claim"]);
  assert.deepEqual(filterToolsByProfile(ALL_TOOLS, resolveProfile('')).map((t) => t.name),
    filterToolsByProfile(ALL_TOOLS, 'public').map((t) => t.name));
});

test('server instructions open with what Webcite does and which tool does each job, then keep the reporting caveats', () => {
  assert.ok(SERVER_INSTRUCTIONS.startsWith('Webcite reads documents and checks claims against sources. Use it to: (1) convert a PDF'));
  const opening = SERVER_INSTRUCTIONS.slice(0, 800);
  for (const name of ['upload_file', 'upload_url', 'extract_document', 'verify_claim', 'verify_batch', 'review_document',
    'get_document_review_job', 'get_document_review', 'extract_figures', 'analyze_conflicts', 'search_sources', 'webcite_guide']) {
    assert.ok(opening.includes(name), `${name} absent from the opening`);
  }
  assert.doesNotMatch(opening, /Compact fields omitted/);
  for (const caveat of [/Compact fields omitted are unknown, not absent/, /pending_claims is unfinished work and includes failed_claims/,
    /Null or missing counts are unknown, never zero/, /obey poll_after_ms with waits of at most 30 seconds/,
    /coverage_complete=true and no pending claims/, /Never invent citation URLs/]) {
    assert.match(SERVER_INSTRUCTIONS, caveat);
  }
});

test('a hosted selection narrows the list and never widens it', () => {
  const { parseToolSelection, applyToolSelection } = require('../dist/profiles.js');
  const publicTools = filterToolsByProfile(ALL_TOOLS, 'public');
  const names = (query) => applyToolSelection(publicTools, parseToolSelection(new URLSearchParams(query))).map((t) => t.name);
  const all = publicTools.map((t) => t.name);
  for (const query of ['', 'profile=', 'profile=full', 'profile=nope', 'read_only=false', 'read_only=1', 'other=1']) {
    assert.deepEqual(names(query), all, query);
  }
  assert.deepEqual(names('profile=public'), all);
  assert.deepEqual(names('profile=CORE'), filterToolsByProfile(ALL_TOOLS, 'core').map((t) => t.name));
  const research = names('profile=research');
  assert.ok(research.includes('verify_claim_stream'));
  assert.ok(!research.includes('query_context'), 'research selection must not add tools outside the served profile');
  const readOnly = names('read_only=true');
  assert.ok(readOnly.length > 0 && readOnly.length < all.length);
  for (const name of readOnly) assert.equal(ALL_TOOLS.find((t) => t.name === name).annotations.readOnlyHint, true, name);
  for (const name of ['verify_claim', 'upload_file', 'review_document', 'extract_document']) assert.ok(!readOnly.includes(name), name);
  assert.deepEqual(names('profile=core&read_only=true'), readOnly.filter((name) => names('profile=core').includes(name)));
});

test('an unauthorized API answer tells the agent what its user does next', () => {
  const { ApiClientError } = require('../dist/api-client.js');
  for (const status of [401, 403]) {
    const failure = new ApiClientError(status, '{"message":"Unauthorized"}').toToolFailure().toPayload();
    assert.equal(failure.code, 'unauthorized');
    assert.match(failure.actionable, /sign in with OAuth at https:\/\/api\.webcite\.co\/mcp/);
    assert.match(failure.actionable, /create an API key at https:\/\/webcite\.co\/api-keys and send it as Authorization: Bearer <key>/);
    assert.match(failure.actionable, /https:\/\/webcite\.co\/api-docs\/mcp/);
    assert.doesNotMatch(failure.actionable, /No sign-in/);
  }
});
