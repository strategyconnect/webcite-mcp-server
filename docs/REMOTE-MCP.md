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

## Serving release

The public endpoint, hosted binary and npm package have separate release identities. Read `https://api.webcite.co/mcp-health`, the backend health identity and the npm registry before reporting a feature as deployed. A repository version or published package does not establish that production has the same backend, tool catalog or billing policy.

The public profile includes `review_document`, `get_document_review_job` and `get_document_review`. A durable document review returns a saved job ID; read its progress and retained results before resuming. Preserve the exact original input and any unresolved stop, lock or credit outcome. A checkpoint does not mean every claim was checked. See the [current tool profiles](../README.md#tool-profiles) and `webcite_guide` for supported workflows.

## Historical production observation (2026-09-30)

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

The durable review release starts a backend job and returns `job_id` without holding an MCP
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

API key only (no OAuth). Clients send either:

- `Authorization: Bearer <api_key>`
- `x-api-key: <api_key>`

Keys are created at https://webcite.co/api-keys.

**Claude custom connector:** choose **No sign-in** (not Sign in now), then under
Request headers add `Authorization` = `Bearer <key>` (or `x-api-key` = `<key>`).

Do **not** send `WWW-Authenticate: Bearer` on 401 — Claude treats that as OAuth
and auto-selects Sign in now / CIMD registration.

## Deploy coupling

When shipping API + MCP together:

1. Publish the canonical npm package and deploy the reviewed HTTP binary.
2. Bump `integrations/mcp-server/RELEASE.json` on the backend repo.
3. `deploy-vm.sh` MCP gate must pass.
