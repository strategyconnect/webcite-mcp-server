#!/usr/bin/env node
/**
 * WebCite MCP Server
 *
 * Fact verification, citation binding, document intelligence, and context-graph
 * tools for any MCP-compatible agent. v1 tools map 1:1 to public API v1; context
 * tools map to API v2. Schemas live in tools.ts, implementations in handlers.ts.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolFailure, WebCiteApiClient } from './api-client.js';
import { handlers } from './handlers.js';
import { ALL_TOOLS } from './tools.js';
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
  tools: ALL_TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!name || typeof name !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, 'tools/call requires a string tool name');
  }

  const handler = handlers[name];
  if (!handler) {
    // Protocol error for unknown tool (not isError application failure).
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }

  try {
    const result = await handler(args, client);
    return {
      content: [{ type: 'text', text: result.text }],
      ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
    };
  } catch (error) {
    if (error instanceof McpError) throw error;

    if (error instanceof ToolFailure) {
      const payload = error.toPayload();
      return {
        content: [
          {
            type: 'text',
            text: `Error [${payload.code}]: ${payload.message}${
              payload.actionable ? `\nAction: ${payload.actionable}` : ''
            }`,
          },
        ],
        structuredContent: payload as unknown as Record<string, unknown>,
        isError: true,
      };
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      structuredContent: {
        code: 'api_error',
        message,
        actionable: 'Inspect the error text; retry chargeable calls with the same Idempotency-Key.',
      },
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
