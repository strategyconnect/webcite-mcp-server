#!/usr/bin/env node
/**
 * WebCite MCP Server
 *
 * Fact verification, citation binding, document intelligence, and context-graph
 * tools for any MCP-compatible agent. v1 tools map 1:1 to public API v1; context
 * tools map to API v2. Schemas live in tools.ts, implementations in handlers.ts.
 *
 * Local default WEBCITE_MCP_PROFILE=core is short; hosted default is public.
 * Set public|full|docs|research to widen local discovery.
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
import {
  filterToolsByProfile,
  profileExclusionMessage,
  resolveProfile,
  SERVER_INSTRUCTIONS,
  type McpProfile,
} from './profiles.js';

export function runSmoke(profile: McpProfile = resolveProfile()): {
  ok: boolean;
  profile: McpProfile;
  toolCount: number;
  tools: string[];
  version: string;
} {
  const tools = filterToolsByProfile(ALL_TOOLS, profile);
  return {
    ok: tools.length > 0 && tools[0]?.name === 'webcite_guide',
    profile,
    toolCount: tools.length,
    tools: tools.map((t) => t.name),
    version: SERVER_VERSION,
  };
}

export function createMcpServer(
  client: WebCiteApiClient,
  profile: McpProfile,
): Server {
  const tools = filterToolsByProfile(ALL_TOOLS, profile);
  const server = new Server(
    {
      name: 'webcite',
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!name || typeof name !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'tools/call requires a string tool name',
      );
    }

    if (!tools.some((t) => t.name === name)) {
      const known = Boolean(handlers[name]);
      if (known) {
        return {
          content: [
            {
              type: 'text',
              text: profileExclusionMessage(name, profile),
            },
          ],
          isError: true,
        };
      }
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    const handler = handlers[name];
    if (!handler) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }

    try {
      const result = await handler(args, client);
      return {
        content: [{ type: 'text', text: result.text }],
        ...(result.structuredContent
          ? { structuredContent: result.structuredContent }
          : {}),
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
          actionable:
            'Inspect the error text; retry chargeable calls with the same Idempotency-Key.',
        },
        isError: true,
      };
    }
  });

  return server;
}

async function main() {
  const profile = resolveProfile();
  const wantsSmoke = process.argv.includes('--smoke');

  if (wantsSmoke) {
    const report = runSmoke(profile);
    const hasKey = Boolean(process.env.WEBCITE_API_KEY);
    console.log(
      JSON.stringify(
        {
          ...report,
          apiKeyPresent: hasKey,
          hint: hasKey
            ? 'Key present. Start the server without --smoke to serve MCP.'
            : 'Set WEBCITE_API_KEY (https://webcite.co/api-keys). Free plan includes 100 credits/month.',
        },
        null,
        2,
      ),
    );
    process.exit(report.ok ? 0 : 1);
  }

  const API_KEY = process.env.WEBCITE_API_KEY;
  const BASE_URL = process.env.WEBCITE_API_URL || 'https://api.webcite.co';

  if (!API_KEY) {
    console.error(
      JSON.stringify({
        error: 'WEBCITE_API_KEY environment variable is required',
        get_key: 'https://webcite.co/api-keys',
        free_credits_per_month: 100,
        profile,
        hint: 'Add WEBCITE_API_KEY to your MCP server env, then retry.',
      }),
    );
    process.exit(1);
  }

  const client = new WebCiteApiClient(API_KEY, BASE_URL);
  const server = createMcpServer(client, profile);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `WebCite MCP Server ${SERVER_VERSION} running (profile=${profile}, tools=${filterToolsByProfile(ALL_TOOLS, profile).length})`,
  );
}

const isDirectRun =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('index.js') || process.argv[1].endsWith('index.ts'));

if (isDirectRun) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
