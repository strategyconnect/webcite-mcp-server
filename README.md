# WebCite MCP Server

> Remote Streamable HTTP MCP: **https://api.webcite.co/mcp**. Start at **https://webcite.co/connect**. The remote server uses the `public` profile for all supported public API workflows. Check the published npm version before pinning it, because repository changes can precede publication.


MCP (Model Context Protocol) server for WebCite — lets any AI agent verify factual claims against authoritative sources, bind quotes back to the passage they came from, and read the numbers out of documents deterministically.

Works with **any MCP-compatible client** including Claude Desktop, Claude Code, Cursor, Continue, Cody, Zed, Windsurf, OpenAI Agents SDK, LangChain, and more.

## Verification and document acceptance

On servers implementing retained generation navigation, a folder generation can include one navigation-query provider stage within the existing five-credit generation operation. Its route is selected before calling the provider, and a refusal, invalid reply, failure or unknown outcome remains an error without provider switching, automatic retry or silent original-query fallback. Public memo model and token usage keep their existing meaning; separate query-provider measurements are internal. Internal staged continuation is identity-bound and requires complete accounting with no draft dispatch. It does not expose a new public preparation feature. Confirm the serving release before relying on this behavior.

For an official-source requirement, supply `filters` on `verify_claim` or `verify_claim_stream`, for example `{"official_country":"ae","is_primary_source":true,"domain":["centralbank.ae"]}`. Pass a known public HTTPS report in `source_urls`; writing a URL or `site:` expression in the claim is not a substitute for these fields. Match the quoted metric, observation period, geography, currency and scale. Different official publications can remain unresolved rather than yielding one universal corrected figure.

Upload original image, PDF or PowerPoint bytes and wait for parsing before review. Inspect input coverage, unreadable regions, claim limits and per-claim source/page locators. A successful upload, a completed review, or many citations does not certify that every figure was read or verified. Citation links are not a guarantee of pixel-level highlighting on an uploaded slide. An extraction failure stays a failure; a bounded search with no evidence does not prove the data is unavailable. Open the original publisher passage before treating a stance badge as proof.

Preserve saved review, citation, job and operation IDs on a timeout or uncertain outcome. Read retained progress before retrying and reuse an explicit idempotency key only with the same request. Package publication does not deploy the hosted API, frontend or MCP binary. Check their actual serving identities before asserting that reported cases are fixed in production.

## 1.9.57 release notes

Updates the guide for original-document acceptance and scoped application access. App-bound keys cannot use legacy account administration or share personal UUID citations. Folder traces respect retained source and linked-memory visibility. Confirm the serving release before relying on these controls. Tool names and client interfaces are unchanged.

## 1.9.56 release notes

Adds hosted MCP `upload_url` and publishes the reviewed timeout and evidence workflows:

- `upload_url` stores bounded original bytes from public HTTPS URLs through public-address and redirect checks, returning owned asset references and usage. Upload success does not certify parsing or a full review.
- Local SDK and self-hosted MCP requests default to a 15-minute headers/body budget, with a validated `WEBCITE_API_TIMEOUT_MS` override. Supporting verification servers use a 600-second default, preserve `VERIFICATION_TIMEOUT` failures and keep the paid-work lock floor. Cancellation does not establish a refund.
- `source_trace` distinguishes extraction, source discovery and checked publication evidence. Search narrative fields separate model prose from literal fetched-snippet bindings; the bindings do not certify a claim.
- Supporting servers retain uniquely bound printed PDF table headings, captions, units and headers without changing TOTAL rows or borrowing ambiguous context.
- Claim-stated FX arithmetic uses one unambiguous explicit currency equality or unit ratio and printed source currency/scale. Rates are never fetched or assumed, and arithmetic does not independently promote a citation stance.

The bundled guide qualifies server capabilities by their serving release. Publishing this package does not deploy a server, enable billing or change existing subscription price snapshots. Other MCP tool and client contracts are preserved.

## 1.9.55 release notes

Updates the bundled `webcite_guide` with the reviewed credit overage contract:

- Held reservations are excluded from settled overage. Returning unused credits does not erase billing for the portion that was actually settled.
- Calendar renewal resets the period's overage watermark. Delayed activation preserves an existing period's allocation and spending.
- Durable overage events retain their identity across retries. Delivery retries use a fresh timestamp, including after a long outage.
- Reporting requires a meter and an explicit UTC activation time. Earlier billing periods are excluded, and a new meter does not change existing subscription price snapshots.

The MCP tools and client API are unchanged from 1.9.54. Server billing still depends on its serving release, migrations and meter configuration; publishing the guide does not enable billing.

## 1.9.54 release notes

Clarifies the bundled `webcite_guide` for servers implementing the reviewed recovery fixes:

- Activation keeps valid provider billing dates; first calendar renewal can recover an older processing-time fallback without accepting stale or overlapping periods.
- No-carry renewal grants the full new allocation even when unresolved earlier reservations exceed it.
- A failed operation lock prevents provider admission. Fresh older extraction saves unknown usage before its cursor advances when receipt persistence fails.

The MCP tools and client API are unchanged from 1.9.53. Publishing this guide does not activate server features or apply migrations; confirm the serving release.

## 1.9.53 release notes

Updates the bundled `webcite_guide` with reviewed backend contracts:

- No-carry free and paid renewal, billing-period checks on refunds, and explicit reconciliation for ambiguous legacy reservations.
- Source-capable ASR servers, retained speech receipts, and validated cache replay on an owned, settled zero-credit operation.
- Recovered extraction usage priced using an available rate for its original occurrence time. Existing receipts keep their saved pricing without backfill; unknown pricing remains unknown.

The MCP tools and client API are unchanged from 1.9.52. These guide updates do not activate backend features or apply migrations. Confirm the serving release before relying on a server capability.

## 1.9.52 release notes

Adds the missing README release notes for 1.9.51. This documentation patch preserves its MCP tools, client API and bundled workflow guide.

## 1.9.51 release notes

Updates the bundled `webcite_guide` with the reviewed backend contracts:

- Billing-period handling for held credits, refunds, free-plan rollover and paid renewal.
- Provider-attempt admission on reserved operations, retained usage receipts and explicit retry behavior.
- Legacy document-extraction retry and incomplete table-repair handling, while durable reviews retain their fail-closed behavior.
- Email OTP delivery failures and per-key bot request limits, including configuration errors.

The MCP tools and client API are unchanged from 1.9.50. Publishing the SDK does not activate backend features or apply database migrations; those require their own server release.

## 1.9.41 release notes

Cancelling a `verify_claim_stream` MCP request now forwards its cancellation signal to the backend HTTP request. Stopping a stream early or encountering a terminal error cancels its unfinished response body. Partial events and original failures remain failures; a completed stream consumes its result, done marker and EOF without extra cancellation. Cancellation does not certify a refund or rollback of paid work. Direct SDK callers can pass an `AbortSignal` as the second argument to `verifyClaimStream` to interrupt a pending read.

## 1.9.21 workflow changes

Saved review pages fit as many compact claims and coverage records as the existing 20 KB response limit permits. Each list keeps its own continuation offset. An item that cannot fit returns an explicit blocked error and leaves the saved evidence available through the API. Claim text shortened for display is marked; citation URLs are retained in full.

Review jobs can return a review ID before they finish. Poll the job about 30 seconds apart and read final pages after a terminal status, unless interim results are requested. Saved outcomes and URLs are sufficient for a summary; source-detail tools are for a specific evidence question.

Base64 upload validation uses linear checks and a canonical byte round trip. The hosted limit remains 20 MB of original bytes. Empty, malformed and oversized inputs fail before upload. Larger files use the Playground or API multipart upload, then their asset ID.

For a local upload-contract corpus check, run `WEBCITE_LOCAL_CORPUS_CATALOG=/path/to/discovery.json node --test test/local-corpus-workflow.test.js` after building. This tests byte transport and refusal boundaries, not parsing or research. The catalog must contain `documents` with `path` and `format` fields; an optional `WEBCITE_CORPUS_RECEIPT` path records private source hashes and size metadata.

## 1.9.14 release notes

Saved document reviews distinguish model extraction dispositions from explicit analyst assessments. Model rows retain their source quote and classification reason; analyst rows retain their recorded reviewer identity and rationale. Reading either type does not create an analyst review or consume new review credits.

## 1.9.13 release notes

`review_document` now returns a job ID immediately. Poll `get_document_review_job` until it reaches `complete`, `partial_coverage`, `credits_exhausted`, or `failed`, then read claims and uncovered source passages with `get_document_review`. Claims and gaps have independent page offsets. A terminal failed or credit-exhausted job remains an immutable receipt; retry the same review inputs with a new `idempotency_key` after diagnosing the failure or adding credits. This flow requires the backend document-review-jobs API.

Version 1.9.18 adds `revise_document_claim_analysis` for an owned, settled claim in an inactive review. Read `original_result_hash` first. The operation applies the current evidence policy to saved snippets, with no research, model call or credit change. Original results and receipts remain in history; missing scope assessments stay inconclusive. The saved reader displays the current revision and retains the original analysis. Large evidence objects remain available through the API with explicit bounded metadata in MCP.

## 1.9.11 release notes

`review_document` now aborts a quiet, in-flight review before a 180-second Claude client deadline and bounds its saved-status check within the same call budget. If the backend has not released the review lock, the tool returns the saved review ID with an explicit error. Check progress with `get_document_review` before resuming.

## 1.9.10 release notes

Long `review_document` calls can return a time budget checkpoint. Webcite saves each completed claim; the tool confirms the backend has released the review before returning a normal checkpoint. Call `get_document_review` to inspect saved progress, then repeat the exact `resume_input` until the review is complete. An unconfirmed backend stop remains an error and should be checked before retrying. Version 1.9.10 could still exceed a 180-second client limit while waiting for an in-flight claim or backend lock.

Large review responses now point to saved, paginated results instead of exceeding Claude's tool output limit. Small responses retain their existing detail. The saved review and its citation evidence remain in Webcite. Check the registry and `/mcp-health` for the version in use.

## 1.9.2 release notes

The public profile includes 29 tools, including credit balance, saved document review, and review recovery. Whole-document requests now route through extraction and a saved review, with guidance to report unreadable pages and unchecked claims.

MCP responses retain complete structured results and label partial figure coverage. Sessions reject a different API key, and the credit-balance tool shows the current credit ledger without deprecated token fields. The guide carries discovered official sources into reviews and reminds clients to reuse completed extraction, since repeated extraction calls consume credits.

## 1.9.1 release notes

The `npx webcite-mcp-server` command now starts the local MCP server as documented. The `webcite-mcp` and `webcite-mcp-http` npm commands also start correctly.

Verification results now include their full evidence alongside the readable summary, so your assistant can inspect source receipts and real reference IDs. A score of zero stays zero; an unknown score stays unknown. Estimated scores are labeled, and source summaries are no longer presented as publisher quotations.

Saved verifications show their stored conclusion when available. Older records explicitly say when that conclusion is unavailable. Damaged records and interrupted streams report an error instead of appearing to be completed checks.

### Verification response contract

- `verify_claim` and `verify_claim_stream` return the backend verification object in MCP `structuredContent`, preserving optional fields, source receipts, and actual citation/request/operation/thread IDs. IDs and result URLs are never synthesized. Text summarizes the same validated object.
- `verify_batch` returns `{ results: [...] }` with unchanged item records, bindings, evidence and feedback tokens.
- `get_citation` returns the unchanged API `{ data: ... }` envelope plus normalized `citations` and, when present, `final_response` from `data.metadata.final_response` (or a verdict-bearing legacy object). Citation storage accepts a bare array or an object with `citations` or `claim_groups`, including JSON-encoded storage. It reads history without rerunning verification. Missing stored conclusions remain unavailable; malformed JSON or shapes return `invalid_api_output`.
- Source `evidence` is an optional versioned backend receipt. Receipt details remain intact, including unknown fields added by later backend versions. Missing legacy receipts do not imply that the publisher was read. `credibility_score` and verdict `confidence` can be `null`; `credibility_basis` and `confidence_basis` identify the backend's basis. `confidence_available: false` means calibrated confidence is unknown, even when a legacy `aggregation_score` is present. Heuristic scores are not calibrated truth probabilities. Provider-generated snippets remain labeled by `snippet_source`.
- A stream requires a full result followed by an explicit completion marker. Interrupted streams return an error with `partial_events`; a result without a completion marker is labeled `unconfirmed_result`. Credit refusals return `credit_exhausted` with required and remaining credits when the API supplies them. Successful usage receipts are retained as `stream_usage`. JSON `verify_claim` accepts optional `idempotency_key`, forwarded as `Idempotency-Key`. Policy 5 backends retain same-key, same-payload checkpoints for 24 hours; changed payloads return 409 and unresolved work returns 503 without repeating generation or charging. This does not promise idempotent streaming or batch retries.

These changes do not repair or regenerate historical evidence. Backend policy and cache versions determine which evidence policy produced a result; this package preserves that metadata.

## Tool profiles

| Profile | Tools exposed | When to use it |
| --- | --- | --- |
| `core` | `webcite_guide`, `get_credit_balance`, `verify_claim`, `search_sources`, `get_source_preview`, `verify_batch`, `upload_file`, `extract_document`, `extract_figures`, `list_citations`, `get_citation`, `analyze_conflicts` | Short local list for everyday verification. |
| `public` (local and remote default) | Core plus `review_document`, `get_document_review_job`, `get_document_review`, `verify_claim_stream`, `verify_feedback`, `analyze_document`, `classify_document`, `document_gaps`, `accuracy_report`, `ask_document`, `get_ask_result`, `extract_pages`, `prepare_ocr_rescue`, `verify_numeric_claim`, `register_source`, `publish_text_representation`, `get_latest_representation`, `read_source_unit` | All supported public API workflows, including saved document reviews and anchored evidence. |
| `docs` | Core plus `analyze_document`, `classify_document`, `document_gaps`, `accuracy_report`, `verify_feedback` | Deeper document work. |
| `research` | Docs plus `get_answer`, `query_context`, `get_evidence_packet`, `compare_assertions`, `get_change_impact`, `verify_claim_stream` | Context and research workflows where the backend enables them. |
| `full` | All tools registered by this package | Advanced local integrations and evaluation. Backend permissions and feature flags still apply. |

Set `WEBCITE_MCP_PROFILE=core|docs|research|full` to change a local server's tool discovery. This does not turn on a backend feature or grant access to another user's sources. Production graph retrieval, claim-first generation, research runs and OCR are separately gated. See the [V2.0.0 release notes](https://github.com/strategyconnect/webcite-backend/releases/tag/V2.0.0) for scope and limits.

On the hosted connector, `upload_file` is a small-file compatibility path accepting `filename` and `file_base64` (up to 20 MB decoded). It does not read a path from the server. Local stdio usage still accepts `file_path`. Public, docs and research profiles also expose `upload_url`: the authenticated server fetches original bytes from a public HTTPS URL with a 100 MB cap, a 30-second budget and checked DNS/redirects. It forwards no caller credentials and returns owned `asset_id`, `asset_url` and `source_version_id`. This does not access a private chat attachment or local file. Preserve the receipt on an uncertain failure before retrying.

A file attached to a Claude chat is not automatically passed to a remote MCP tool. Upload the original binary through Webcite Playground or the authenticated multipart/resumable HTTP API within the parser's format and size limits, then use its asset ID with the same Webcite account in Claude. If upload completion returns `parse_job_id`, wait for parsing; if it returns `parse_required`, call its `parse_endpoint`. Do not base64-encode extracted text as a substitute for the original file. A client that directly supplies original bytes may still use `upload_file` for small files.

## Tool reference

The table below describes common tools across profiles. It is not the remote server's default tool list.

| Tool | Description | Credits |
|------|-------------|---------|
| `webcite_guide` | Pick verification, full-document, source-tracing or numeric workflow, or read the billing reference | 0 |
| `verify_claim` | Full fact verification with stance analysis and verdict | 2-4 |
| `get_credit_balance` | Read remaining, used and total credits | 0 |
| `get_document_review` | Page saved claims and uncovered source passages independently | 0 |
| `get_document_review_job` | Poll a durable review job | 0 |
| `revise_document_claim_analysis` | Apply the current policy to retained saved snippets, preserving original analysis and receipts | 0 |
| `review_document` | Start a full review and return its job ID immediately | Per claim after start |
| `verify_claim_stream` | Streaming verification for complex/long-running claims | 2-4 |
| `search_sources` | Quick citation search without analysis | 2 |
| `list_citations` | List your past verifications | 1 |
| `get_citation` | Get details of a specific verification | 1 |
| `upload_file` | Upload a document for use as verification context | 1 |
| `upload_url` | Store original file bytes from a public HTTPS URL, with public-address, redirect and size guards | 1 on successful storage |
| `get_source_preview` | Resolve a citation to its source, with a bindBack check | 1 |
| `verify_batch` | Check up to 200 quotes against their sources in one call | 1 per item |
| `verify_feedback` | Accept, reject or flag a batch result | 1 |
| `analyze_conflicts` | Recompute and cross-check figures you already extracted | 1 |
| `analyze_document` | Extract, recompute and cross-check a spreadsheet or PDF | 3 |
| `classify_document` | Category + covered types for an uploaded document | 1 |
| `document_gaps` | "Usually also here" checklist for a category | 1 |
| `extract_document` | Any format to normalized text + units with provenance | 1 |
| `extract_figures` | Recognized financial metrics as tagged, source-grounded figures | 2 |
| `accuracy_report` | The engine's measured accuracy against its gold set | 1 |

Saved reviews retain candidate IDs and positions. A `duplicate` row links to an earlier
claim through `duplicate_of_id` and `duplicate_of_index`; it has no separate verdict,
citation or charge. `duplicate_claims` is separate from completed and non-factual
counts. A `source_recovery` record preserves the original candidate when a temporal
relationship is restored from the document's literal text.

Automatic nonclaim dispositions with `reason: structure` identify a proven list
marker or coordination token. `grounded_claim_ids` links the surrounding source
assertions. These records describe source coverage, not external verification.

Verification tools bind a quote back to its source and report **how** it matched
(exact / normalized / fuzzy / unbound). A fuzzy match is capped at `needs_review` and
is never reported as verified. The numeric tools are deterministic: they recompute
figures rather than asking a model whether the numbers look right.

To identify the original publication behind a screenshot or slide, call
`webcite_guide` with `workflow=source_trace`. Extract the file, search for its
distinctive table values, and inspect candidate URLs. `ask_document` checks
numbers inside supplied text; it does not discover external sources.

## Installation

### Claude remote connector (recommended)

1. Create an API key at [webcite.co/api-keys](https://webcite.co/api-keys).
2. Open [webcite.co/connect](https://webcite.co/connect).
3. **Claude:** Settings → Connectors → Add custom connector → paste `https://api.webcite.co/mcp`. Choose **No sign-in**, then add a Request header named `x-api-key` with your API key as its value.

No Node, no `npx`, no JSON config files.

### Claude Desktop

Add to `claude_desktop_config.json`:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "webcite": {
      "command": "npx",
      "args": ["-y", "webcite-mcp-server"],
      "env": {
        "WEBCITE_API_KEY": "webcite_your_api_key_here"
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
# Add to Claude Code
claude mcp add webcite -- npx -y webcite-mcp-server

# Set API key
export WEBCITE_API_KEY=webcite_your_api_key_here
```

Or add to `~/.claude/claude_settings.json`:

```json
{
  "mcpServers": {
    "webcite": {
      "command": "npx",
      "args": ["-y", "webcite-mcp-server"],
      "env": {
        "WEBCITE_API_KEY": "webcite_your_api_key_here"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "webcite": {
      "command": "npx",
      "args": ["-y", "webcite-mcp-server"],
      "env": {
        "WEBCITE_API_KEY": "webcite_your_api_key_here"
      }
    }
  }
}
```

### Continue

Add to `~/.continue/config.json`:

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "webcite-mcp-server"]
        },
        "env": {
          "WEBCITE_API_KEY": "webcite_your_api_key_here"
        }
      }
    ]
  }
}
```

### Cody (VS Code)

Add to VS Code settings (`settings.json`):

```json
{
  "cody.experimental.mcp.servers": {
    "webcite": {
      "command": "npx",
      "args": ["-y", "webcite-mcp-server"],
      "env": {
        "WEBCITE_API_KEY": "webcite_your_api_key_here"
      }
    }
  }
}
```

### Zed

Add to `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "webcite": {
      "command": {
        "path": "npx",
        "args": ["-y", "webcite-mcp-server"]
      },
      "env": {
        "WEBCITE_API_KEY": "webcite_your_api_key_here"
      }
    }
  }
}
```

### Generic / Direct Usage

```bash
# Install globally
npm install -g webcite-mcp-server

# Run with API key
WEBCITE_API_KEY=webcite_xxx webcite-mcp-server

# Or with npx (no install)
WEBCITE_API_KEY=webcite_xxx npx webcite-mcp-server
```

## Getting Your API Key

1. Sign up at [webcite.co](https://webcite.co)
2. Log in and go to **API Keys** in the sidebar
3. Create a new API key
4. Add it to your MCP configuration

## Usage Examples

### Verify a Claim

```
User: Verify this claim: "The Great Wall of China is visible from space"

# Fact Check: "The Great Wall of China is visible from space"

## Verdict: CONTRADICTED
Confidence: 92%
Summary: Multiple authoritative sources confirm this is a common misconception.

Source Breakdown:
- Supporting: 0
- Contradicting: 4
- Neutral: 1

## Sources

1. NASA - Great Wall of China
   URL: https://www.nasa.gov/...
   Stance: contradicts (95% confidence)
   Credibility: 98/100
   Analysis: NASA explicitly states the wall is not visible from low Earth orbit...
```

### Verify with Thread Context

Use `thread_id` to group related verifications in a session:

```
User: Verify "Einstein won the Nobel Prize for relativity" with thread_id "research-session-1"

# The thread_id links this verification to others in the same session,
# so you can later retrieve all related fact-checks together.
```

### Stream a Complex Verification

Use `verify_claim_stream` for complex or multi-part claims that may take longer to process:

```
User: Stream-verify "The iPhone was released in 2007, was the first smartphone,
      and was designed by Steve Wozniak"

# The streaming tool collects intermediate results (sub-claim decomposition,
# per-claim verification) and returns the assembled result.
```

### Search for Sources

```
User: Search for sources about "quantum computing breakthroughs 2024"

# Search Results: "quantum computing breakthroughs 2024"

Found 8 sources:

1. Nature - Quantum Error Correction Milestone
   URL: https://nature.com/...
   Credibility: 95/100
   Snippet: "Researchers achieved a significant breakthrough in..."
```

### Upload a Document

```
User: Upload my research paper for verification context

# File Uploaded Successfully

File ID: f_abc123
Filename: research-paper.pdf
Type: application/pdf
Size: 245832 bytes
```

### Check Every Citation in a Draft at Once

```
User: Check every quote in this draft against its source

# Batch Verification: 12 item(s)

**Grounded:** 10/12

1. ✓ "Revenue grew 40% in FY2024."
   Binding: grounded (normalized, score 0.97)
   Matched: "in FY2024 revenue grew 40%"
   Verification: verified | layer bindback | confidence 92
   Feedback token: ft_abc123

7. ✗ "Headcount doubled."
   Binding: not grounded (unbound, score 0.21)
   Verification: unverified | layer none | confidence 10 | review: no passage matched
```

Reject a wrong result with `verify_feedback` using its token — corrections accumulate.

### Read the Numbers Out of a Model

```
User: Upload this financial model and tell me if the numbers hold up

# Document Analysis

**Category:** financials | **Covers:** p&l, cap table

**Review:** ⚠ needs review
- Recomputed gross_margin does not match the stated value.

## Conflicts (1)

1. **arr** — delta 500000
   - 4500000 currency from model.xlsx (sheet P&L B4) [rule read]
   - 5000000 currency from deck.pdf (p.7) [model read]
   Ask: Which ARR is current — the deck or the model?

## Recomputations (1)

1. ✗ **gross_margin** — computed 58 percent, stated 62 percent
   - revenue = 1000 from model.xlsx (sheet P&L B4) [rule read]
```

`extract_figures` returns the same figures on their own; `analyze_conflicts` runs the
check over figures from your own pipeline.

### Review Past Verifications

```
User: Show my recent fact-checks

# Your Verification History

Page 1 of 3 (28 total)

1. The Earth is 4.5 billion years old
   ID: abc123...
   Date: Jan 30, 2025

2. Coffee causes cancer
   ID: def456...
   Date: Jan 29, 2025
```

## Tool Details

### verify_claim

Full fact verification with optional stance analysis and verdict generation.

**Parameters:**
- `claim` (required): The factual claim to verify
- `thread_id` (optional): Thread ID to group related verifications in a session
- `include_stance` (optional, default: true): Include stance analysis per source (+1 credit)
- `include_verdict` (optional, default: true): Generate overall verdict (+1 credit)
- `decompose_claim` (optional, default: false): Break complex claims into sub-claims

**Credit Cost:**
- Base search: 2 credits
- With stance: +1 credit
- With verdict: +1 credit
- Full verification: 4 credits

### verify_claim_stream

Streaming verification for complex or long-running claims. Uses the SSE streaming endpoint to avoid HTTP timeouts and capture intermediate results (sub-claim decomposition, per-claim progress). Returns the same formatted output as `verify_claim`.

Prefer this over `verify_claim` when:
- The claim is complex and may take a long time to verify
- You want intermediate progress data (sub-claim decomposition, per-claim results)
- You want to avoid HTTP timeouts on long-running verifications

**Parameters:**
- `claim` (required): The factual claim to verify
- `thread_id` (optional): Thread ID to group related verifications in a session
- `include_stance` (optional, default: true): Include stance analysis per source
- `include_verdict` (optional, default: true): Generate overall verdict
- `decompose_claim` (optional, default: false): Break complex claims into sub-claims

**Credit Cost:** Same as `verify_claim` (2-4 credits)

### search_sources

Quick citation search without analysis - returns raw sources.

**Parameters:**
- `query` (required): Search query or claim
- `limit` (optional, default: 10): Max sources to return (1-20)

**Credit Cost:** 2 credits

### list_citations

List your past verification results.

**Parameters:**
- `page` (optional, default: 1): Page number
- `limit` (optional, default: 10): Results per page (max 50)
- `thread_id` (optional): Filter by conversation thread

**Credit Cost:** 1

### get_citation

Get full details of a specific verification.

**Parameters:**
- `citation_id` (required): The citation ID to retrieve

**Credit Cost:** 1

### upload_file

Upload a file to WebCite for use as verification context. Supports documents (PDF, DOCX, TXT) and other common file types. Returns a file ID usable as `asset_id` everywhere below.

**Parameters:**
- `file_path` (required): Absolute path to the file to upload

**Credit Cost:** 1

### get_source_preview

Resolve a citation back to its exact source and render it, so you can show the evidence behind a claim.

- **Web** (`url`): returns a text-fragment deep link (`url#:~:text=quote`).
- **Document** (`asset_id`): returns the cited page's extracted text and an `asset_url#page=N` link. Spreadsheets return the sheet grid.

Every preview reports **bindBack** — whether the quote was found in the source and how it matched (exact / normalized / unbound). A quote that cannot be bound back is never reported as grounded.

**Parameters:**
- `url`: Web source URL (provide this OR `asset_id`)
- `asset_id`: Uploaded asset ID (provide this OR `url`); also accepts `asset://<id>`
- `page`: 1-based page (PDF) or sheet index (spreadsheet)
- `quote`: The cited quote to bind back and highlight

**Credit Cost:** 1

### verify_batch

Check many quotes against their sources in one call. Each item carries its own source: inline text, a URL, or an uploaded asset.

Per item you get back whether the quote is grounded, how it matched (exact / normalized / fuzzy / unbound), the best-matching passage and score even when unbound, a verification band, and a `feedback_token`. A fuzzy match is capped at `needs_review`, never verified.

**Parameters:**
- `items` (required): 1-200 items, each `{ id?, quote, source_text? | url? | asset_id?, page? }`

**Credit Cost:** 1 per item — the work is per item, so a 200-claim batch costs 200

### verify_feedback

Record a human verdict on a `verify_batch` result. The token carries the result summary, so token plus verdict is enough. Feedback is stored, so corrections accumulate.

**Parameters:**
- `token` (required): The `feedback_token` from a batch result
- `verdict` (required): `correct` | `incorrect` | `unsure`
- `note`: Optional note or correction

**Credit Cost:** 1

### analyze_conflicts

Verify numbers, not just text. Give figures you already extracted and the engine recomputes every derivable metric from its primitives, detects cross-document conflicts, flags jointly-impossible values, and returns a review flag with concrete reasons.

Deterministic — a conflict either exists or it does not, so this is a flag with reasons, not a probability.

**Parameters:**
- `figures` (required): `{ metric, value, unit, entity?, period?, provenance }[]`

**Credit Cost:** 1 (deterministic, no model calls, but still server compute)

### analyze_document

Document-in numeric analysis. Give an uploaded asset ID; the file is downloaded, its figures extracted, then recomputed and cross-checked. Returns figures plus conflicts, recomputations, a review flag and the document's category.

Spreadsheets are read deterministically with exact cell provenance. PDFs are read by a vision model (it never computes) — those are model reads, capped at `needs_review`.

**Parameters:**
- `asset_id` (required): Uploaded spreadsheet or PDF

**Credit Cost:** 3 — the document is downloaded, parsed and, for PDFs, read page by page by a vision model

### classify_document

Coarse **category** plus the fine multi-type **covers** a document holds (a bundled workbook covers several). Deterministic and model-free — works with no model configured.

**Parameters:**
- `asset_id` or `asset_url` (one required)
- `taxonomy`: `vc` (venture data-room, default) or `ma`

**Credit Cost:** 1

### document_gaps

The "usually also here" checklist for a category: each expected document type flagged present or absent. An item is present when any document matches it by filename, category, or covered type. Advisory — nothing blocks.

**Parameters:**
- `category` (required)
- `docs`: `{ filename?, label?, category?, covers? }[]` already filed in that category
- `taxonomy`: `vc` (default) or `ma`
- `stage`: `early` or `growth`

**Credit Cost:** 1

### extract_document

Extract supported documents into normalized text with provenance: whole-doc markdown, per-page/sheet units, and sheet names for spreadsheets. PDF, spreadsheets, DOCX, PPTX, HTML and text have reader paths; coverage and recognition vary by format. Unreadable or partial content must be treated as an explicit limitation, not as an empty successful extraction.

The readable text preview stops at 16,000 characters and lists source links beyond that limit. The full backend extraction, including page and sheet units and any lost-unit status, is returned in MCP `structuredContent`. If the client omits `structuredContent`, use the actual source version ID with `get_latest_representation` and `read_source_unit`, or use `extract_pages` when that ID is unavailable. An asset ID is not a source version ID. Check every unit before calling a review complete. If units are unreadable, report that gap rather than treating it as no claims.

**Parameters:**
- `asset_id` or `asset_url` (one required)

**Credit Cost:** 1

### extract_figures

Recognized financial metrics in a document as tagged, source-grounded figures: value normalized to its canonical unit, `metric`, `unit`, optional `entity`/`period`, a confidence `band`, whether it was confirmed against the cited cell (`bound`), and full `provenance`. Zero results do not mean the document contains no numbers.

Header scale (`$M`, `'000`), accounting negatives, period columns and unit declarations are all honoured, so a percentage is never mis-read as a currency. Feed the result straight into `analyze_conflicts`.

**Parameters:**
- `asset_id` or `asset_url` (one required)

**Credit Cost:** 2

### accuracy_report

The numeric engine's measured accuracy against its gold-set corpus: conflict detection rate and precision, and recompute correctness. Reproducible and gated on every build.

**Parameters:** none

**Credit Cost:** 1

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WEBCITE_API_KEY` | Your WebCite API key (required) | - |
| `WEBCITE_API_URL` | API base URL | `https://api.webcite.co` |
| `WEBCITE_API_TIMEOUT_MS` | Headers and body timeout for each API request, in milliseconds (positive integer; invalid values fall back to the default with a warning) | `900000` (15 minutes) |

For new agent conversations using MongoDB checkpoints, configure your local SDK or self-hosted MCP server with the durable API base:

```bash
# WEBCITE_API_KEY must already be configured.
WEBCITE_API_URL=https://api.webcite.co/durable npx webcite-mcp-server
```

For development, use `https://devapi.webcite.co/durable`. Keep the same API base, authenticated owner and `thread_id` for every continuation. Existing conversations keep their original base; changing the base does not move their in-memory checkpoints. Saved review and job records are already durable, separately from agent checkpoints.

The public hosted MCP at `https://api.webcite.co/mcp` keeps its existing API base. `/durable` is an API base, not a hosted MCP connection URL. Self-hosted HTTP servers can also set the existing `apiBaseUrl` option when creating `createRemoteMcpApp`.

## Response Format

All verification results include:

- **Verdict**: Overall assessment (supported/contradicted/mixed/unverifiable)
- **Confidence**: 0-100% confidence score
- **Sources**: List of authoritative citations
- **Stance Analysis**: Per-source support/contradict assessment
- **Key Findings**: Important facts extracted from sources
- **Corrections**: When the claim contains inaccuracies

## Pricing

| Plan | Monthly Credits | Price |
|------|-----------------|-------|
| Free | 50 | $0 |
| Builder | 500 | $20/month |
| Enterprise | 10,000+ | [Contact Sales](https://webcite.co/#pricing) |

## Support

- Documentation: [webcite.co/api-docs/playground](https://webcite.co/api-docs/playground)
- Email: support@webcite.co

## License

MIT
