#!/usr/bin/env node
/**
 * WebCite MCP Server
 *
 * Fact verification, citation binding and document intelligence tools for any
 * MCP-compatible agent. Every tool maps to a WebCite public API v1 endpoint:
 * schemas live in tools.ts, implementations in handlers.ts.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebCiteApiClient } from './api-client.js';
import { handlers } from './handlers.js';
import { TOOLS } from './tools.js';
import { SERVER_VERSION } from './version.js';

const API_KEY = process.env.WEBCITE_API_KEY;
const BASE_URL = process.env.WEBCITE_API_URL || 'https://api.webcite.co';

if (!API_KEY) {
  console.error('Error: WEBCITE_API_KEY environment variable is required');
  console.error('Get your API key at https://webcite.co/api-keys');
  process.exit(1);
}

const client = new WebCiteApiClient(API_KEY, BASE_URL);

const server = new Server(
  {
    name: 'webcite',
    version: SERVER_VERSION,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];

  if (!handler) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const text = await handler(args, client);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`WebCite MCP Server ${SERVER_VERSION} running`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
