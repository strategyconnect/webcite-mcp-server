# Remote MCP (api.webcite.co/mcp)

Non-technical users connect via **https://webcite.co/connect**.  
This service is the Streamable HTTP MCP endpoint behind that page.

## Run locally

```bash
cd /path/to/webcite-mcp-server
npm run build
PORT=8787 WEBCITE_MCP_PROFILE=public node dist/http-server.js
# Health: curl http://127.0.0.1:8787/health
# MCP:   POST http://127.0.0.1:8787/mcp  with Authorization: Bearer <api_key>
```

## Production (observed 2026-09-30, before the durable review release)

Live URL (production Nginx proxies to the 1.9.12 PM2 process on `:8819`):

- MCP: `https://api.webcite.co/mcp`
- Health: `https://api.webcite.co/mcp-health`

Process env:

- `WEBCITE_API_URL=https://api.webcite.co`
- `WEBCITE_MCP_PROFILE=public`
- `PORT=8819`

The hosted endpoint and public npm package served 1.9.12 after the 2026-09-30
binary-upload release. Check `/mcp-health` and the npm registry before claiming
the durable review version is live. The 1.9.12 public profile exposes 29 tools;
the durable release adds `get_document_review_job`. The local run example above
uses port 8787 independently of production.

In 1.9.11, a long `review_document` call returns a time budget checkpoint after
the saved backend review stops, or an explicit saved-status error while it remains locked. Read the saved review with `get_document_review`
and resume using the exact original input. Large saved pages provide smaller
MCP summaries and explicit offsets; full citation records remain on the Webcite
API. A checkpoint never means every claim has been checked.

The next release starts a backend job and returns `job_id` without holding an MCP
request open. Poll `get_document_review_job`, then read the saved review and its
coverage gaps with `get_document_review`. Deploy the backend document-review-jobs
API before this MCP package.

The remote server's `public` profile exposes supported public API workflows documented in the
[package tool profiles](../README.md#tool-profiles). `docs`, `research` and
`full` are local operator choices, not a promise that every backend context
feature is enabled in production. The package source version may be ahead of
the version published on npm; check the registry before recommending a pin.

Frontend: `NEXT_PUBLIC_WEBCITE_MCP_URL=https://api.webcite.co/mcp`

Optional later: add GoDaddy A record `mcp` → prod IP and a dedicated vhost; until then use the API host path above.

## Auth

Two ways, both billed to the same account credits:

- **API key** (unchanged): `Authorization: Bearer <api_key>` or `x-api-key: <api_key>`. Keys are created at https://webcite.co/api-keys. In Claude, choose **No sign-in** and add the header under Request headers.
- **OAuth 2.1** (ChatGPT, Claude **Sign in**, MCP Inspector): a 401 without credentials carries `WWW-Authenticate: Bearer resource_metadata="https://api.webcite.co/.well-known/oauth-protected-resource/mcp", scope="webcite:mcp"`. The authorization server is the Webcite API (`https://api.webcite.co`, metadata at `/.well-known/oauth-authorization-server`): dynamic client registration, PKCE S256, consent at webcite.co, 1 hour access tokens (`webcite_oat_...`) and rotating 30 day refresh tokens. This server introspects OAuth access tokens (cached up to 60 s) and answers 401 `invalid_token` for an expired or revoked one. Design: webcite-backend `docs/plans/2026-11-24-mcp-oauth.md`.

## Deploy coupling

When shipping API + MCP together:

1. Publish the canonical npm package and deploy the reviewed HTTP binary.
2. Bump `integrations/mcp-server/RELEASE.json` on the backend repo.
3. `deploy-vm.sh` MCP gate must pass.
