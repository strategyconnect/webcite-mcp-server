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
  assert.match(SERVER_INSTRUCTIONS, /document_review/);
});

test('full slide audits and image numerics route to supported tools', () => {
  const publicTools = filterToolsByProfile(ALL_TOOLS, 'public');
  const description = (name) => publicTools.find((tool) => tool.name === name)?.description ?? '';
  assert.match(SERVER_INSTRUCTIONS, /every figure on a slide.*review_document/i);
  assert.match(description('review_document'), /check every figure on this slide/i);
  assert.match(description('analyze_document'), /JPEG\/PNG\/WebP image/);
  assert.match(description('verify_claim'), /one specific claim/);
  assert.match(description('extract_document'), /Claude connectors omit structuredContent.*read_source_unit/);
  for (const name of ['verify_claim', 'verify_claim_stream']) {
    assert.equal(publicTools.find((tool) => tool.name === name).inputSchema.properties.source_urls.maxItems, undefined);
  }
  const numericGuide = require('../dist/guide.js').renderWebciteGuide({ workflow: 'numeric' });
  assert.match(numericGuide, /zero metrics does not mean/);
  assert.match(numericGuide, /JPEG\/PNG\/WebP.*review_document/);
});

test('runSmoke reports core defaults', () => {
  const smoke = runSmoke('core');
  assert.equal(smoke.ok, true);
  assert.equal(smoke.toolCount, filterToolsByProfile(ALL_TOOLS, 'core').length);
});
