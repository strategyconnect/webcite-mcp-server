# Claude Connectors Directory — listing kit

Use this copy when submitting Webcite to Anthropic’s Connectors Directory.

## Listing

| Field | Value |
| --- | --- |
| Name | Webcite |
| Short description | Evidence pipeline for AI: verify claims, bind quotes to sources, extract document figures |
| MCP server URL | `https://mcp.webcite.co/mcp` |
| Auth | API key via Bearer token or `x-api-key` header |
| Homepage | https://webcite.co |
| Connect help | https://webcite.co/connect |
| Privacy | https://webcite.co/privacy-policy |
| Support | support@webcite.co (or your ops inbox) |
| Categories | Research, Fact-checking, Documents |

## Long description

Webcite checks AI claims against sources, opens the passage a quote came from, and extracts figures from documents. Default tools are a short core set so Claude can pick them up easily. Free plan includes 100 credits per month. Get a key at webcite.co/api-keys, then add this connector URL.

## Screenshots to capture

1. webcite.co/connect page  
2. Claude Connectors showing Webcite connected  
3. A verify_claim / webcite_guide turn in chat  

## Verification checklist (before submit)

- [ ] `curl -s https://mcp.webcite.co/health` returns version + toolCount  
- [ ] Claude custom connector works with a Free API key  
- [ ] Cursor deeplink from /connect works  
- [ ] Privacy + ToS links live  

Submit via Anthropic’s Connectors Directory process (org Connectors / partner form as published by Anthropic at submission time).
