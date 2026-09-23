/**
 * Coverage guard: MCP tools must stay in step with WebCite public HTTP routes.
 *
 * v1 tools stay 1:1 with ENDPOINT_TOOLS. Context (v2) tools live in a separate
 * map so adding them cannot break the existing v1 guard.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { handlers } = require('../dist/handlers.js');
const {
  TOOLS,
  CONTEXT_TOOLS,
  ALL_TOOLS,
  CONTEXT_ENDPOINT_TOOLS,
  PUBLIC_EXTRA_TOOLS,
  PUBLIC_EXTRA_ENDPOINT_TOOLS,
} = require('../dist/tools.js');
const { SERVER_VERSION } = require('../dist/version.js');

/** Every public API v1 endpoint, and the tool that exposes it. */
const ENDPOINT_TOOLS = {
  'POST /api/v1/verify': 'verify_claim',
  'POST /api/v1/verify/stream': 'verify_claim_stream',
  'POST /api/v1/sources/search': 'search_sources',
  'GET /api/v1/citations': 'list_citations',
  'GET /api/v1/citations/:id': 'get_citation',
  'POST /api/v1/citations/source-preview': 'get_source_preview',
  'POST /api/v1/verify/batch': 'verify_batch',
  'POST /api/v1/verify/feedback': 'verify_feedback',
  'POST /api/v1/analyze/conflicts': 'analyze_conflicts',
  'POST /api/v1/analyze/document': 'analyze_document',
  'POST /api/v1/classify': 'classify_document',
  'POST /api/v1/gaps': 'document_gaps',
  'POST /api/v1/extract': 'extract_document',
  'POST /api/v1/extract/figures': 'extract_figures',
  'GET /api/v1/accuracy': 'accuracy_report',
  'POST /api/v1/upload': 'upload_file',
};

test('every documented API endpoint has a tool', () => {
  const names = new Set(TOOLS.map((t) => t.name));
  for (const [endpoint, tool] of Object.entries(ENDPOINT_TOOLS)) {
    assert.ok(names.has(tool), `${endpoint} has no tool named "${tool}"`);
  }
});

test('every tool maps to a documented endpoint', () => {
  const exposed = new Set(Object.values(ENDPOINT_TOOLS));
  for (const tool of TOOLS) {
    assert.ok(exposed.has(tool.name), `tool "${tool.name}" is not mapped to an endpoint`);
  }
});

test('v1 TOOLS count stays exactly ENDPOINT_TOOLS (1:1 guard)', () => {
  assert.equal(TOOLS.length, Object.keys(ENDPOINT_TOOLS).length);
  assert.equal(TOOLS.length, 16);
});

test('context tools map 1:1 to v2 CONTEXT_ENDPOINT_TOOLS', () => {
  const names = new Set(CONTEXT_TOOLS.map((t) => t.name));
  for (const [endpoint, tool] of Object.entries(CONTEXT_ENDPOINT_TOOLS)) {
    assert.ok(names.has(tool), `${endpoint} has no context tool named "${tool}"`);
  }
  const exposed = new Set(Object.values(CONTEXT_ENDPOINT_TOOLS));
  for (const tool of CONTEXT_TOOLS) {
    assert.ok(exposed.has(tool.name), `context tool "${tool.name}" is not mapped`);
  }
  assert.equal(CONTEXT_TOOLS.length, Object.keys(CONTEXT_ENDPOINT_TOOLS).length);
});

test('every added public route has a tool and handler', () => {
  const names = new Set(PUBLIC_EXTRA_TOOLS.map((tool) => tool.name));
  assert.equal(names.size, Object.keys(PUBLIC_EXTRA_ENDPOINT_TOOLS).length);
  for (const [route, name] of Object.entries(PUBLIC_EXTRA_ENDPOINT_TOOLS)) {
    assert.ok(names.has(name), `${route} has no tool`);
    assert.equal(typeof handlers[name], 'function', `${route} has no handler`);
  }
});

test('ALL_TOOLS is guide + TOOLS + CONTEXT_TOOLS without duplicates', () => {
  assert.equal(ALL_TOOLS.length, TOOLS.length + PUBLIC_EXTRA_TOOLS.length + CONTEXT_TOOLS.length + 1);
  assert.equal(ALL_TOOLS[0].name, 'webcite_guide');
  const names = ALL_TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('every tool has a handler and every handler has a tool', () => {
  const toolNames = ALL_TOOLS.map((t) => t.name).sort();
  const handlerNames = Object.keys(handlers).sort();
  assert.deepEqual(handlerNames, toolNames);
});

test('every tool schema is well formed', () => {
  for (const tool of ALL_TOOLS) {
    assert.equal(tool.inputSchema.type, 'object', `${tool.name}: schema is not an object`);
    assert.ok(tool.description.length > 40, `${tool.name}: description is too thin`);
    assert.ok(tool.inputSchema.properties, `${tool.name}: schema has no properties`);
    for (const required of tool.inputSchema.required ?? []) {
      assert.ok(
        Object.hasOwn(tool.inputSchema.properties, required),
        `${tool.name}: required field "${required}" is not declared in properties`,
      );
    }
  }
});

test('tool names are unique', () => {
  const names = ALL_TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('server version matches package.json', () => {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  assert.equal(SERVER_VERSION, pkg.version);
});

test('context tools do not advertise scope/tenant annotations as authority', () => {
  for (const tool of CONTEXT_TOOLS) {
    const blob = JSON.stringify(tool);
    assert.equal(
      /annotations/i.test(blob) && /readOnlyHint|idempotentHint/.test(blob),
      false,
      `${tool.name} must not rely on MCP annotations for scope`,
    );
    assert.match(
      tool.description,
      /API key|authenticated|authorized|HTTP:/i,
      `${tool.name} should document auth/HTTP authority`,
    );
  }
});
