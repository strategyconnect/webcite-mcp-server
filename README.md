# WebCite MCP Server

> Remote Streamable HTTP MCP: **https://api.webcite.co/mcp**. Start at **https://webcite.co/connect**. The remote server uses the `public` profile for all supported public API workflows. Check the published npm version before pinning it, because repository changes can precede publication.


MCP (Model Context Protocol) server for WebCite — lets any AI agent verify factual claims against authoritative sources, bind quotes back to the passage they came from, and read the numbers out of documents deterministically.

Works with **any MCP-compatible client** including Claude Desktop, Claude Code, Cursor, Continue, Cody, Zed, Windsurf, OpenAI Agents SDK, LangChain, and more.

## Tool profiles

| Profile | Tools exposed | When to use it |
| --- | --- | --- |
| `core` (local default) | `webcite_guide`, `verify_claim`, `search_sources`, `get_source_preview`, `verify_batch`, `upload_file`, `extract_document`, `extract_figures`, `list_citations`, `get_citation`, `analyze_conflicts` | Short local list for everyday verification. |
| `public` (remote default) | Core plus `verify_claim_stream`, `verify_feedback`, `analyze_document`, `classify_document`, `document_gaps`, `accuracy_report`, `ask_document`, `get_ask_result`, `extract_pages`, `prepare_ocr_rescue`, `verify_numeric_claim` | All supported public API workflows, including document questions and anchored evidence. |
| `docs` | Core plus `analyze_document`, `classify_document`, `document_gaps`, `accuracy_report`, `verify_feedback` | Deeper document work. |
| `research` | Docs plus `get_answer`, `query_context`, `get_evidence_packet`, `compare_assertions`, `get_change_impact`, `verify_claim_stream` | Context and research workflows where the backend enables them. |
| `full` | All tools registered by this package | Advanced local integrations and evaluation. Backend permissions and feature flags still apply. |

Set `WEBCITE_MCP_PROFILE=public|docs|research|full` for a local server. This changes tool discovery; it does not turn on a backend feature or grant access to another user's sources. Production graph retrieval, claim-first generation, research runs and OCR are separately gated. See the [V2.0.0 release notes](https://github.com/strategyconnect/webcite-backend/releases/tag/V2.0.0) for scope and limits.

## Tool reference

The table below describes common tools across profiles. It is not the remote server's default tool list.

| Tool | Description | Credits |
|------|-------------|---------|
| `webcite_guide` | Pick the appropriate verification, document or numeric workflow | 0 |
| `verify_claim` | Full fact verification with stance analysis and verdict | 2-4 |
| `verify_claim_stream` | Streaming verification for complex/long-running claims | 2-4 |
| `search_sources` | Quick citation search without analysis | 2 |
| `list_citations` | List your past verifications | 1 |
| `get_citation` | Get details of a specific verification | 1 |
| `upload_file` | Upload a document for use as verification context | 1 |
| `get_source_preview` | Resolve a citation to its source, with a bindBack check | 1 |
| `verify_batch` | Check up to 200 quotes against their sources in one call | 1 per item |
| `verify_feedback` | Accept, reject or flag a batch result | 1 |
| `analyze_conflicts` | Recompute and cross-check figures you already extracted | 1 |
| `analyze_document` | Extract, recompute and cross-check a spreadsheet or PDF | 3 |
| `classify_document` | Category + covered types for an uploaded document | 1 |
| `document_gaps` | "Usually also here" checklist for a category | 1 |
| `extract_document` | Any format to normalized text + units with provenance | 1 |
| `extract_figures` | Every number as a tagged, source-grounded figure | 2 |
| `accuracy_report` | The engine's measured accuracy against its gold set | 1 |

Verification tools bind a quote back to its source and report **how** it matched
(exact / normalized / fuzzy / unbound). A fuzzy match is capped at `needs_review` and
is never reported as verified. The numeric tools are deterministic: they recompute
figures rather than asking a model whether the numbers look right.

## Installation

### Non-technical (recommended): Claude or Cursor

1. Create an API key at [webcite.co/api-keys](https://webcite.co/api-keys).
2. Open [webcite.co/connect](https://webcite.co/connect).
3. **Claude:** Settings → Connectors → Add custom connector → paste `https://api.webcite.co/mcp` and your API key.
4. **Cursor:** use the one-click install button on `/connect`.

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

Long documents are truncated in the tool output; use `get_source_preview` for a specific page.

**Parameters:**
- `asset_id` or `asset_url` (one required)

**Credit Cost:** 1

### extract_figures

Every number in a document as a tagged, source-grounded figure: value normalized to its canonical unit, `metric`, `unit`, optional `entity`/`period`, a confidence `band`, whether it was confirmed against the cited cell (`bound`), and full `provenance`.

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
