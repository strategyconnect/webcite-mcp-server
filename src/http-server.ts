#!/usr/bin/env node
/**
 * Hosted / remote MCP entry (Streamable HTTP).
 *
 * Intended for api.webcite.co/mcp (remote MCP) so Claude Connectors and Cursor can attach
 * without local Node/npx. Auth: Authorization Bearer <api_key> or x-api-key.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { WebCiteApiClient } from './api-client.js';
import { createMcpServer, runSmoke } from './index.js';
import { resolveProfile } from './profiles.js';
import { SERVER_VERSION } from './version.js';

const DEFAULT_API_URL = 'https://api.webcite.co';
const DEFAULT_PORT = 8787;

export function extractApiKey(req: IncomingMessage): string | undefined {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }
  if (Array.isArray(headerKey) && headerKey[0]?.trim()) {
    return headerKey[0].trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

type Session = {
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createMcpServer>;
};

export function createRemoteMcpApp(options?: {
  apiBaseUrl?: string;
  profile?: ReturnType<typeof resolveProfile>;
}): {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  sessions: Map<string, Session>;
} {
  const apiBaseUrl = options?.apiBaseUrl || process.env.WEBCITE_API_URL || DEFAULT_API_URL;
  const profile = options?.profile ?? resolveProfile(process.env.WEBCITE_MCP_PROFILE ?? 'public');
  const sessions = new Map<string, Session>();

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-api-key, mcp-session-id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/health' || url.pathname === '/') {
      const smoke = runSmoke(profile);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          service: 'webcite-mcp',
          version: SERVER_VERSION,
          transport: 'streamable-http',
          mcpPath: '/mcp',
          profile: smoke.profile,
          toolCount: smoke.toolCount,
          freeCreditsPerMonth: 100,
          docs: 'https://webcite.co/connect',
        }),
      );
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', hint: 'POST/GET https://api.webcite.co/mcp' }));
      return;
    }

    const apiKey = extractApiKey(req);
    if (!apiKey) {
      // Do not send WWW-Authenticate: Bearer — Claude treats that as OAuth and
      // auto-selects "Sign in now". This server is API-key only (static headers).
      res.writeHead(401, {
        'content-type': 'application/json',
      });
      res.end(
        JSON.stringify({
          error: 'unauthorized',
          message: 'Provide Authorization: Bearer <api_key> or x-api-key header',
          get_key: 'https://webcite.co/api-keys',
          claude:
            'Choose No sign-in, then add Authorization: Bearer <key> (or x-api-key) under Request headers',
        }),
      );
      return;
    }

    const sessionHeader = req.headers['mcp-session-id'];
    const sessionId =
      typeof sessionHeader === 'string'
        ? sessionHeader
        : Array.isArray(sessionHeader)
          ? sessionHeader[0]
          : undefined;

    try {
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        let bodyBytes = 0;
        for await (const chunk of req) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bodyBytes += bytes.length;
          if (bodyBytes > 30_000_000) {
            res.writeHead(413, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'request_too_large', maxBytes: 30_000_000 }));
            return;
          }
          chunks.push(bytes);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        let body: unknown = undefined;
        if (raw.trim()) {
          try {
            body = JSON.parse(raw);
          } catch {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_json' }));
            return;
          }
        }

        if (sessionId && sessions.has(sessionId)) {
          const existing = sessions.get(sessionId)!;
          await existing.transport.handleRequest(req, res, body);
          return;
        }

        if (!sessionId && isInitializeRequest(body)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });
          const client = new WebCiteApiClient(apiKey, apiBaseUrl);
          const server = createMcpServer(client, profile, true);
          await server.connect(transport);
          transport.onclose = () => {
            const id = transport.sessionId;
            if (id) sessions.delete(id);
          };
          await transport.handleRequest(req, res, body);
          if (transport.sessionId) {
            sessions.set(transport.sessionId, { transport, server });
          }
          return;
        }

        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'bad_request',
            message: 'Missing mcp-session-id for non-initialize request',
          }),
        );
        return;
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_session' }));
          return;
        }
        await sessions.get(sessionId)!.transport.handleRequest(req, res);
        return;
      }

      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
    } catch (error) {
      console.error('MCP HTTP error', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
    }
  };

  return { handler, sessions };
}

async function main() {
  if (process.argv.includes('--smoke')) {
    const report = runSmoke(resolveProfile());
    console.log(JSON.stringify({ ...report, mode: 'http' }, null, 2));
    process.exit(report.ok ? 0 : 1);
  }

  const port = Number(process.env.PORT || DEFAULT_PORT);
  const host = process.env.HOST || '0.0.0.0';
  const { handler } = createRemoteMcpApp();
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  server.listen(port, host, () => {
    console.error(
      `WebCite remote MCP ${SERVER_VERSION} on http://${host}:${port}/mcp (profile=${resolveProfile(process.env.WEBCITE_MCP_PROFILE ?? 'public')})`,
    );
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
