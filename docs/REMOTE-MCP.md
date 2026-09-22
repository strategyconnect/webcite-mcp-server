# Remote MCP (mcp.webcite.co)

Non-technical users connect via **https://webcite.co/connect**.  
This service is the Streamable HTTP MCP endpoint behind that page.

## Run locally

```bash
cd /path/to/webcite-mcp-server
npm run build
PORT=8787 WEBCITE_MCP_PROFILE=core node dist/http-server.js
# Health: curl http://127.0.0.1:8787/health
# MCP:   POST http://127.0.0.1:8787/mcp  with Authorization: Bearer <api_key>
```

## Production (suggested)

1. DNS: `mcp.webcite.co` → your VM / load balancer.
2. TLS terminate (Caddy/nginx) → `127.0.0.1:8787`.
3. Process: `pm2 start dist/http-server.js --name webcite-mcp-http` with:
   - `WEBCITE_API_URL=https://api.webcite.co`
   - `WEBCITE_MCP_PROFILE=core`
   - `PORT=8787`
4. Frontend: `NEXT_PUBLIC_WEBCITE_MCP_URL=https://mcp.webcite.co/mcp`

## Auth

Clients send either:

- `Authorization: Bearer <api_key>`
- `x-api-key: <api_key>`

Keys are created at https://webcite.co/api-keys.

## Deploy coupling

When shipping API + MCP together:

1. Publish / deploy this HTTP binary (and npm package when Trusted Publishing is set up).
2. Bump `integrations/mcp-server/RELEASE.json` on the backend repo.
3. `deploy-vm.sh` MCP gate must pass.
