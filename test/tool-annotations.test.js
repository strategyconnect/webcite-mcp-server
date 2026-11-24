const test = require('node:test');
const assert = require('node:assert/strict');
const { ALL_TOOLS } = require('../dist/tools.js');
const { ANNOTATED_TOOL_NAMES, toolAnnotations } = require('../dist/tool-annotations.js');
const { createMcpServer } = require('../dist/index.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

test('every advertised tool has a title and behaviour hints, and no hint entry is stale', () => {
  const names = ALL_TOOLS.map((t) => t.name);
  assert.deepEqual([...names].sort(), [...ANNOTATED_TOOL_NAMES].sort());
  for (const tool of ALL_TOOLS) {
    assert.ok(tool.title && tool.title.length <= 60, `${tool.name} title`);
    assert.equal(tool.annotations.title, tool.title);
    assert.equal(typeof tool.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof tool.annotations.destructiveHint, 'boolean');
    assert.ok(!(tool.annotations.readOnlyHint && tool.annotations.destructiveHint), tool.name);
  }
});

test('an unknown tool name fails loudly instead of shipping without hints', () => {
  assert.throws(() => toolAnnotations('not_a_tool'), /no title or behaviour hints/);
});

test('hints follow the route: reads are read-only, paid checks are additive, settlement is destructive', () => {
  const hints = (name) => ALL_TOOLS.find((t) => t.name === name).annotations;
  assert.equal(hints('get_citation').readOnlyHint, true);
  assert.equal(hints('webcite_guide').readOnlyHint, true);
  assert.deepEqual([hints('verify_claim').readOnlyHint, hints('verify_claim').destructiveHint, hints('verify_claim').openWorldHint], [false, false, true]);
  assert.equal(hints('upload_file').openWorldHint, false);
  assert.equal(hints('settle_operation').destructiveHint, true);
});

test('tools/list over MCP carries title and annotations on every public and remote tool', async () => {
  for (const remote of [false, true]) {
    const server = createMcpServer({}, 'public', remote);
    const client = new Client({ name: 'annotations-test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      assert.ok(tools.length >= 30);
      for (const tool of tools) {
        assert.ok(tool.title, `${tool.name} has no title`);
        assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', `${tool.name} readOnlyHint`);
        assert.equal(typeof tool.annotations?.destructiveHint, 'boolean', `${tool.name} destructiveHint`);
      }
    } finally {
      await client.close();
    }
  }
});
