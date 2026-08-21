/**
 * Coverage guard: the MCP tool list must stay in step with the WebCite public API.
 *
 * The failure this prevents: a route is added to the v1 API and no tool is added
 * here, so agents silently cannot reach it (which is how the server drifted three
 * releases behind the API).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { handlers } = require('../dist/handlers.js');
const { TOOLS } = require('../dist/tools.js');
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

test('every tool has a handler and every handler has a tool', () => {
  const toolNames = TOOLS.map((t) => t.name).sort();
  const handlerNames = Object.keys(handlers).sort();
  assert.deepEqual(handlerNames, toolNames);
});

test('every tool schema is well formed', () => {
  for (const tool of TOOLS) {
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
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('server version matches package.json', () => {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  assert.equal(SERVER_VERSION, pkg.version);
});
