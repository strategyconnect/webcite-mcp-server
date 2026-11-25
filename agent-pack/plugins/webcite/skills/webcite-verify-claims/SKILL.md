---
name: webcite-verify-claims
description: Use when the user asks to fact-check, verify or source a claim, statistic or statement, asks whether something is true, or wants citations added to generated text. Verifies a claim against web sources with Webcite and returns citations, a stance for each source and a verdict. Triggers: fact-check, verify, is this true, cite sources, hallucination check.
license: MIT
compatibility: Needs the Webcite MCP server (https://api.webcite.co/mcp, OAuth sign-in) or a Webcite API key in WEBCITE_API_KEY for the REST API at https://api.webcite.co.
---

# Verify claims with Webcite

## When to use

- One factual claim or statistic to check against web sources.
- Adding citations to a statement.

For many quotes with known sources use `webcite-check-quotes`; for every claim in a document use `webcite-review-document`.

## MCP path

- `verify_claim` with `{ "claim": "..." }`. Optional `source_urls` limits the check to sources you name.
- `get_source_preview` opens a returned citation at its quoted passage, to show the evidence.
- `verify_claim_stream` does the same check with streamed progress.

## Reading the result

A source match, a stance for each source (supports, contradicts or neutral) and the overall verdict are separate results. An absent verdict is not support. Report contradicting sources as well as supporting ones, and never invent citation URLs.

## REST path

```bash
curl -s https://api.webcite.co/api/v1/verify -H "x-api-key: $WEBCITE_API_KEY" \
  -H "content-type: application/json" -d '{"claim": "Global EV sales passed 17 million in 2024."}'
```

Docs: https://webcite.co/api-docs/verify

## Authentication

- Hosted MCP signs in with OAuth in the client (for example `/mcp` in Claude Code). An account is required; sign up at https://webcite.co.
- REST calls send the key in the `x-api-key` header. Create a key at https://webcite.co/api-keys (sign-in required) and read it from `WEBCITE_API_KEY`.
- Never ask the user to paste an API key into the conversation.
- A 401 from `/api/v1/*` names the header, the key page and the docs in its body.
