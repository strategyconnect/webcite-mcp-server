# Webcite agent pack

Instructions for coding agents working with this repository or using Webcite.

- Webcite parses documents to Markdown and verifies claims against sources. Use it through the hosted MCP server (`https://api.webcite.co/mcp`, OAuth sign-in) or the REST API (`https://api.webcite.co/api/v1/*`, `x-api-key` header).
- The skills in `plugins/webcite/skills/` describe each job: `webcite` (choose a workflow), `webcite-parse-documents`, `webcite-verify-claims`, `webcite-check-quotes`, `webcite-review-document`, `webcite-check-figures`.
- Skills must name only tools the Webcite MCP server ships. The list is in `tools/list` of `webcite-mcp-server` and in https://webcite.co/api-docs/mcp.
- Never ask the user to paste an API key into the conversation. Keys are created at https://webcite.co/api-keys and read from `WEBCITE_API_KEY`.
- Every statement in a skill must be true of the current server; when the server changes, update the skill in the same release.
