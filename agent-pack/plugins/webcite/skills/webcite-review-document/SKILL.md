---
name: webcite-review-document
description: "Use when the user asks to audit, fact-check or check every claim or figure in a whole document, report, memo, deck or AI-generated draft, or wants a coverage report of what was and was not verified. Runs a Webcite document review job over an uploaded file. Triggers: audit this document, fact-check the whole report, check every figure, hallucination audit."
license: MIT
compatibility: Needs the Webcite MCP server (https://api.webcite.co/mcp, OAuth sign-in) or a Webcite API key in WEBCITE_API_KEY for the REST API at https://api.webcite.co.
---

# Fact-check a whole document with Webcite

## When to use

Every material claim in an uploaded document needs checking, with a record of coverage. Do not substitute a few single-claim checks for a full review.

## MCP path

1. Upload the original file once (`upload_url` or `upload_file`) to get an `asset_id`. No separate extraction step is needed; the review reads the stored source itself.
2. `review_document` with the `asset_id`, a prompt and a stable `thread_id`. It starts a job and returns a `job_id` immediately. Repeating the same input reuses the job without a new charge.
3. `get_document_review_job` reports progress. Obey `poll_after_ms`, wait at most 30 seconds between polls, and stop on a terminal status: `complete`, `partial_coverage`, `credits_exhausted` or `failed`.
4. `get_document_review` reads the saved claims, verdicts, citations and passages not covered.

## Reporting

Claim full coverage only when the saved review reports `coverage_complete: true` and no pending claims. Report pending, failed, rejected and uncovered counts separately; a null or missing count is unknown, not zero. A failed or credit-exhausted review keeps its completed claims and can resume on the same thread with the same inputs.

The document review runs through MCP; see https://webcite.co/api-docs/mcp.

## Authentication

- Hosted MCP signs in with OAuth in the client (for example `/mcp` in Claude Code). An account is required; sign up at https://webcite.co.
- REST calls send the key in the `x-api-key` header. Create a key at https://webcite.co/api-keys (sign-in required) and read it from `WEBCITE_API_KEY`.
- Never ask the user to paste an API key into the conversation.
- A 401 from `/api/v1/*` names the header, the key page and the docs in its body.
