#!/usr/bin/env node
/**
 * Hosted / remote MCP entry (Streamable HTTP).
 *
 * Intended for api.webcite.co/mcp (remote MCP) so Claude Connectors and Cursor can attach
 * without local Node/npx. Auth: Authorization Bearer <api_key> or x-api-key.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { WebCiteApiClient } from './api-client.js';
import { createCredentialCheck } from './credential-check.js';
import { createMcpServer, runSmoke } from './index.js';
import { parseToolSelection, resolveProfile } from './profiles.js';
import { SERVER_VERSION } from './version.js';

const DEFAULT_API_URL = 'https://api.webcite.co';
const DEFAULT_PORT = 8787;
const OAUTH_SCOPE = 'webcite:mcp';

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

/**
 * The MCP-Protocol-Version this server answers a request under. A well-formed revision newer than
 * the latest one the SDK implements (Claude sends 2026-07-28) is served at LATEST_PROTOCOL_VERSION,
 * the version initialize negotiates for it, instead of a 400. Supported versions, a missing header
 * and malformed or unknown older values are left to the SDK, which answers the last two with 400.
 */
export function servedProtocolVersion(header: string | undefined): string | undefined {
  return header !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(header) && header > LATEST_PROTOCOL_VERSION
    ? LATEST_PROTOCOL_VERSION
    : header;
}

/** Rewrites the header in place on this request: the transport reads rawHeaders, Node code reads headers. */
function applyServedProtocolVersion(req: IncomingMessage): void {
  const raw = req.headers['mcp-protocol-version'];
  const sent = Array.isArray(raw) ? raw[0] : raw;
  const served = servedProtocolVersion(sent);
  if (served === sent || served === undefined) return;
  req.headers['mcp-protocol-version'] = served;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === 'mcp-protocol-version') req.rawHeaders[i + 1] = served;
  }
}

export function createRemoteMcpApp(options?: {
  apiBaseUrl?: string;
  profile?: ReturnType<typeof resolveProfile>;
  /** Longest a request waits for its credential check (default 5 s); tests shorten it. */
  credentialCheckDeadlineMs?: number;
}): {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} {
  const apiBaseUrl = options?.apiBaseUrl || process.env.WEBCITE_API_URL || DEFAULT_API_URL;
  const profile = options?.profile ?? resolveProfile(process.env.WEBCITE_MCP_PROFILE ?? 'public');
  const resourceMetadata = `${new URL(apiBaseUrl).origin}/.well-known/oauth-protected-resource/mcp`;
  const challenge = `resource_metadata="${resourceMetadata}", scope="${OAUTH_SCOPE}"`;
  const checkCredential = createCredentialCheck(apiBaseUrl, { deadlineMs: options?.credentialCheckDeadlineMs });

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-api-key, mcp-session-id');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
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

    // /mcp/ is the same endpoint as /mcp.
    if (url.pathname !== '/mcp' && url.pathname !== '/mcp/') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found', hint: 'POST/GET https://api.webcite.co/mcp' }));
      return;
    }

    const xKey = req.headers['x-api-key'];
    const headerKey = (Array.isArray(xKey) ? xKey[0] : xKey)?.trim();
    const bearerKey = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (headerKey && bearerKey && headerKey !== bearerKey) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'conflicting_api_keys', message: 'Authorization and x-api-key identify different accounts. Send one key.' }));
      return;
    }
    const apiKey = extractApiKey(req);
    if (!apiKey) {
      // OAuth discovery for ChatGPT, Claude and other MCP clients. Clients that send an API key
      // never reach this branch, so static-header connections are unchanged.
      res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': `Bearer ${challenge}` });
      res.end(
        JSON.stringify({
          error: 'unauthorized',
          message: 'Connect with OAuth at https://api.webcite.co/mcp and sign in, or create an API key at https://webcite.co/api-keys and send it as Authorization: Bearer <api_key> (an x-api-key header also works). Docs: https://webcite.co/api-docs/mcp',
          get_key: 'https://webcite.co/api-keys',
          docs: 'https://webcite.co/connect',
        }),
      );
      return;
    }
    // Every request proves its credential before any JSON-RPC handling (cached, see credential-check.ts).
    const credential = await checkCredential(apiKey);
    if (credential.status === 'invalid') {
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': `Bearer error="invalid_token", error_description="The API key or access token is invalid, expired or revoked", ${challenge}`,
      });
      res.end(JSON.stringify({
        error: 'invalid_token',
        message: 'This API key or access token is invalid, expired or revoked. Sign in again with OAuth, or create an API key at https://webcite.co/api-keys.',
        get_key: 'https://webcite.co/api-keys',
      }));
      return;
    }
    if (credential.status === 'unavailable') {
      // Undecided is not invalid: serve the request as before the check existed; a tool call still meets the API's own auth.
      console.error(`MCP credential check skipped (${credential.reason}); request passed to the MCP handler`);
    }

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

        // Backend job IDs carry durable state. A fresh transport avoids lost browser
        // session headers or process restarts blocking otherwise authenticated tools.
        applyServedProtocolVersion(req);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = createMcpServer(new WebCiteApiClient(apiKey, apiBaseUrl), profile, true, parseToolSelection(url.searchParams));
        res.once('close', () => { void server.close().catch(error => console.error('MCP transport close failed', error)); });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method === 'GET' || req.method === 'DELETE') {
        res.writeHead(405, { 'content-type': 'application/json', allow: 'POST' });
        res.end(JSON.stringify({ error: 'method_not_allowed', message: 'This MCP transport is stateless. Send authenticated POST requests.' }));
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

  return { handler };
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
      `Webcite remote MCP ${SERVER_VERSION} on http://${host}:${port}/mcp (profile=${resolveProfile(process.env.WEBCITE_MCP_PROFILE ?? 'public')})`,
    );
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
