---
name: webcite
description: Use when a task involves reading documents or checking facts and you need to choose the right Webcite workflow: parsing a PDF, scan or office file to Markdown, verifying a claim, checking quotes, fact-checking a whole document, or checking figures. Routes to the matching Webcite skill.
license: MIT
compatibility: Needs the Webcite MCP server (https://api.webcite.co/mcp, OAuth sign-in) or a Webcite API key in WEBCITE_API_KEY for the REST API at https://api.webcite.co.
---

# Webcite: choose the workflow

Webcite reads documents and checks claims against sources. Pick the skill that matches the request:

| Request | Skill | First MCP tool |
| --- | --- | --- |
| Convert a PDF, scan, image, spreadsheet or office file to Markdown, or chunk it for RAG | `webcite-parse-documents` | `upload_file` or `upload_url`, then `extract_document` |
| Is this claim true? Add citations to a statement | `webcite-verify-claims` | `verify_claim` |
| Do these quotes appear in their sources? | `webcite-check-quotes` | `verify_batch` |
| Fact-check every claim in a document | `webcite-review-document` | `review_document` |
| Extract financial figures or find numbers that conflict | `webcite-check-figures` | `extract_figures`, `analyze_conflicts` |
| Find sources without a verdict | (this skill) | `search_sources` |

`webcite_guide` (MCP, no credits) lists each workflow with its inputs, order and cost. When unsure, call it with `workflow: "choose"`.

## Setup

Hosted MCP, no key in the command:

```bash
claude mcp add --transport http webcite https://api.webcite.co/mcp
codex mcp add webcite --url https://api.webcite.co/mcp && codex mcp login webcite
```

The local stdio server (`npx -y webcite-mcp-server` with `WEBCITE_API_KEY`) can read files by path; the hosted server cannot. For a self-hosted API, set `WEBCITE_API_URL`.

For current API details, read https://webcite.co/llms.txt or https://webcite.co/api-docs.

## Authentication

- Hosted MCP signs in with OAuth in the client (for example `/mcp` in Claude Code). An account is required; sign up at https://webcite.co.
- REST calls send the key in the `x-api-key` header. Create a key at https://webcite.co/api-keys (sign-in required) and read it from `WEBCITE_API_KEY`.
- Never ask the user to paste an API key into the conversation.
- A 401 from `/api/v1/*` names the header, the key page and the docs in its body.
