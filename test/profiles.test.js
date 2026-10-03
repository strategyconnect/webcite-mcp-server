const test = require('node:test');
const assert = require('node:assert/strict');
const {
  filterToolsByProfile,
  resolveProfile,
  SERVER_INSTRUCTIONS,
} = require('../dist/profiles.js');
const { ALL_TOOLS } = require('../dist/tools.js');
const { WEBCITE_GUIDE_TOOL } = require('../dist/guide.js');
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
  assert.ok(core.length <= 12);
  assert.equal(core[0].name, 'webcite_guide');
  assert.deepEqual(core[0], WEBCITE_GUIDE_TOOL);
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

test('server instructions mention free credits and verify_claim', () => {
  assert.match(SERVER_INSTRUCTIONS, /100 credits/);
  assert.match(SERVER_INSTRUCTIONS, /verify_claim/);
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
  assert.match(result.text, /OCR output is not certification and does not provide bounding boxes/);
  assert.match(result.text, /partial, unreadable and error states and their OCR method across PDF and PowerPoint/);
  assert.match(result.text, /mixed full-scope review includes narrative assertions and scope qualifications as well as numbers/);
  assert.match(result.text, /Bind HTML table numbers to exact original cells and headers, including uniquely matched footer years/);
  assert.match(result.text, /Do not flatten table cells into prose or guess ambiguous years; leave unresolved bindings as source gaps/);
  assert.match(result.text, /source_assessment \(version: 1\)/);
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
  assert.match(description('extract_document'), /use review_document for a whole-document or whole-slide/);
  assert.match(description('review_document'), /Do not substitute separate verify_claim calls/);
  assert.match(description('extract_document'), /Claude connectors omit structuredContent.*read_source_unit/);
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


test('numeric guide preserves exact-config durable context reads without API execution', async () => {
  const api = new Proxy({}, { get() { throw new Error('Guide must not execute an API request'); } });
  const result = await handlers.webcite_guide({ workflow: 'numeric' }, api);
  assert.match(result.text, /automaticExtractionContext/);
  assert.match(result.text, /automaticSourceLedger/);
  assert.match(result.text, /never invokes a provider/);
  assert.match(result.text, /not_requested/);
  assert.match(result.text, /Graph-operator refusal is independent of ledger availability/);
  assert.match(result.text, /never relabelled as resolved graph assertions/);
  assert.match(result.text, /Contradictory or unmarked scope stays unknown/);
  assert.match(result.text, /fiscal quarters retain fiscal identity without inventing an interval/);
});

test('numeric guide pins the composed evidence request and response wording without API execution', async () => {
  const api = new Proxy({}, { get() { throw new Error('Guide must not execute an API request'); } });
  const result = await handlers.webcite_guide({ workflow: 'numeric' }, api);
  assert.match(result.text, /add evidence \{include, maxItems\?, maxChars\?\} with an explicit contextPath/);
  assert.match(result.text, /passages, readings, findings, notes and source_diagnostics/);
  assert.match(result.text, /The evidence policy is part of the signed query body/);
  assert.match(result.text, /composedEvidence \(version product-query-evidence\/1\)/);
  assert.match(result.text, /no provider, model or extraction call/);
  assert.match(result.text, /Notes stay unverified user assertions and never corroborate a source/);
  assert.match(result.text, /Unavailable values appear only as diagnostics/);
  assert.match(result.text, /omitted as incomplete_witness_group/);
  assert.match(result.text, /one id with two different payloads is a 409 integrity error/);
  assert.match(result.text, /Defaults are 100 items and 12000 characters.*maxima 2000 and 200000.*200000 UTF-8 bytes/);
  assert.match(result.text, /Without evidence the response is unchanged/);
  assert.match(result.text, /maxChars counts only rendered text in UTF-16 units: passage snippet, note text/);
  assert.match(result.text, /each passage carries the same contextScope \(meeting or company\) and order as the top-level refs, as payload outside its id/);
  assert.match(result.text, /coverage\.notes\.included counts offered notes/);
  assert.match(result.text, /outsideQueriedSourceVersionIds counts finding witnesses from sources outside the queried selection/);
});
