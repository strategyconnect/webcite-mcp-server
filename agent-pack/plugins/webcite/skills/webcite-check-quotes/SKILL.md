---
name: webcite-check-quotes
description: Use when the user wants to confirm that quotes or cited passages actually appear in the sources they cite, check every citation in a draft, or see the exact passage behind a citation. Checks many quote and source pairs at once with Webcite. Triggers: check quotes, verify citations, does the source say this, misquote.
license: MIT
compatibility: Needs the Webcite MCP server (https://api.webcite.co/mcp, OAuth sign-in) or a Webcite API key in WEBCITE_API_KEY for the REST API at https://api.webcite.co.
---

# Check quotes with Webcite

## When to use

- A list of quotes, each with its source as inline text, a URL or an uploaded file.
- Showing the passage a citation points to.

## MCP path

- `verify_batch` with `items`, each a quote plus its source. Each item is bound back to its own source; a fuzzy match is capped at needs review, never verified.
- `get_source_preview` opens a citation at its quoted passage.
- `list_citations` and `get_citation` read past results.

## REST path

`POST https://api.webcite.co/api/v1/verify/batch` with `{"items": [...]}` and the `x-api-key` header.

Docs: https://webcite.co/api-docs/batch

## Authentication

- Hosted MCP signs in with OAuth in the client (for example `/mcp` in Claude Code). An account is required; sign up at https://webcite.co.
- REST calls send the key in the `x-api-key` header. Create a key at https://webcite.co/api-keys (sign-in required) and read it from `WEBCITE_API_KEY`.
- Never ask the user to paste an API key into the conversation.
- A 401 from `/api/v1/*` names the header, the key page and the docs in its body.
