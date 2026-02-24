# WebCite MCP Server

MCP (Model Context Protocol) server for WebCite - enables any AI agent or tool to verify factual claims against authoritative sources.

Works with **any MCP-compatible client** including Claude Desktop, Claude Code, Cursor, Continue, Cody, Zed, Windsurf, OpenAI Agents SDK, LangChain, and more.

## Features

| Tool | Description | Credits |
|------|-------------|---------|
| `verify_claim` | Full fact verification with stance analysis and verdict | 2-4 |
| `verify_claim_stream` | Streaming verification for complex/long-running claims | 2-4 |
| `search_sources` | Quick citation search without analysis | 2 |
| `list_citations` | List your past verifications | Free |
| `get_citation` | Get details of a specific verification | Free |
| `upload_file` | Upload a document for use as verification context | - |

## Installation

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
        "WEBCITE_API_KEY": "wc_your_api_key_here"
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
export WEBCITE_API_KEY=wc_your_api_key_here
```

Or add to `~/.claude/claude_settings.json`:

```json
{
  "mcpServers": {
    "webcite": {
      "command": "npx",
      "args": ["-y", "webcite-mcp-server"],
      "env": {
        "WEBCITE_API_KEY": "wc_your_api_key_here"
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
        "WEBCITE_API_KEY": "wc_your_api_key_here"
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
          "WEBCITE_API_KEY": "wc_your_api_key_here"
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
        "WEBCITE_API_KEY": "wc_your_api_key_here"
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
        "WEBCITE_API_KEY": "wc_your_api_key_here"
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
WEBCITE_API_KEY=wc_xxx webcite-mcp-server

# Or with npx (no install)
WEBCITE_API_KEY=wc_xxx npx webcite-mcp-server
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

**Credit Cost:** Free

### get_citation

Get full details of a specific verification.

**Parameters:**
- `citation_id` (required): The citation ID to retrieve

**Credit Cost:** Free

### upload_file

Upload a file to WebCite for use as verification context. Supports documents (PDF, DOCX, TXT) and other common file types.

**Parameters:**
- `file_path` (required): Absolute path to the file to upload

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
