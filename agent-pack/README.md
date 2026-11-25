# Webcite agent pack

Skills and plugin manifests that connect AI coding agents to [Webcite](https://webcite.co), which parses documents to Markdown and verifies claims against sources with citations bound to the passages they quote.

The pack connects the hosted Webcite MCP server at `https://api.webcite.co/mcp`, which signs in with OAuth. A Webcite account is required; sign up at [webcite.co](https://webcite.co).

## Skills

| Skill | Use it to |
| --- | --- |
| `webcite` | Choose the right Webcite workflow for a request |
| `webcite-parse-documents` | Convert PDFs, scans, images, spreadsheets and office files to Markdown, or chunk them for RAG |
| `webcite-verify-claims` | Check a claim against web sources, with citations, a stance for each source and a verdict |
| `webcite-check-quotes` | Check that quotes appear in the sources they cite |
| `webcite-review-document` | Fact-check every claim in a document, with a coverage report |
| `webcite-check-figures` | Extract financial figures and find numbers that conflict |

## Install

Replace `OWNER/REPO` with this repository's GitHub path.

| Agent | Command |
| --- | --- |
| Any agent supported by the `skills` CLI | `npx skills add OWNER/REPO` |
| Claude Code | `claude plugin marketplace add OWNER/REPO`, then `claude plugin install webcite@webcite` |
| Codex | `codex plugin marketplace add OWNER/REPO`, then install `webcite` from the Plugins Directory |
| Gemini CLI | `gemini extensions install https://github.com/OWNER/REPO` |

Without the pack, connect the MCP server directly: `claude mcp add --transport http webcite https://api.webcite.co/mcp`. Other clients are listed in the [webcite-mcp-server README](https://github.com/strategyconnect/webcite-mcp-server#install).

## Layout

- `plugins/webcite/`: the plugin (Claude Code `.claude-plugin/plugin.json` and `.mcp.json`; portable `plugin.json` and `mcp.json` for Codex and Cursor; Cursor `.cursor-plugin/plugin.json`; `skills/`).
- `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`: marketplaces for Claude Code and Codex.
- `gemini-extension.json` and `GEMINI.md`: the Gemini CLI extension.
- `context7.json`: Context7 indexing settings.

## License

MIT. See [LICENSE](LICENSE).
