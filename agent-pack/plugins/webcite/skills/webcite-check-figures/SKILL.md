---
name: webcite-check-figures
description: "Use when the user wants financial figures extracted from a spreadsheet, financial model, PDF or deck with their units and periods, totals recomputed, or numbers that conflict across documents found. Reads and cross-checks figures with Webcite. Triggers: extract figures, check the numbers, do these totals add up, conflicting figures."
license: MIT
compatibility: Needs the Webcite MCP server (https://api.webcite.co/mcp, OAuth sign-in) or a Webcite API key in WEBCITE_API_KEY for the REST API at https://api.webcite.co.
---

# Check figures with Webcite

## When to use

- Reading financial figures with units, periods and source locations (sheet, cell, page).
- Recomputing totals and finding figures that conflict across documents.

## MCP path

1. `extract_figures` on an uploaded document returns recognized financial metrics as tagged figures with provenance. It is not a complete inventory of every number; zero results do not mean the document has no numbers.
2. `analyze_conflicts` takes figures in that format (or your own) and recomputes totals and flags conflicts.
3. `analyze_document` analyzes figures in an uploaded PDF, spreadsheet or image in one call. Figures read from images are OCR or model reads and need source review.

## REST path

`POST /api/v1/extract/figures` with `{"asset_id": "..."}`, then `POST /api/v1/analyze/conflicts` with `{"figures": [...]}`, both with the `x-api-key` header at https://api.webcite.co.

Docs: https://webcite.co/api-docs/figures

## Authentication

- Hosted MCP signs in with OAuth in the client (for example `/mcp` in Claude Code). An account is required; sign up at https://webcite.co.
- REST calls send the key in the `x-api-key` header. Create a key at https://webcite.co/api-keys (sign-in required) and read it from `WEBCITE_API_KEY`.
- Never ask the user to paste an API key into the conversation.
- A 401 from `/api/v1/*` names the header, the key page and the docs in its body.
