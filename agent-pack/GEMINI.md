# Webcite

Webcite reads documents and checks claims against sources. This extension connects the hosted Webcite MCP server at https://api.webcite.co/mcp. Run `/mcp auth webcite` to sign in with your Webcite account (sign up at https://webcite.co).

Which tool for which request:

- Convert a PDF, scan, image, spreadsheet or office file to Markdown: `upload_url` or `upload_file`, then `extract_document`. `extract_pages` returns chunks with page anchors for RAG.
- Check one claim against web sources, with citations, a stance for each source and a verdict: `verify_claim`.
- Check that quotes appear in their sources: `verify_batch`; show the passage behind a citation with `get_source_preview`.
- Fact-check every claim in a document: `review_document`, then `get_document_review_job` until a terminal status, then `get_document_review`. Claim full coverage only when `coverage_complete` is true.
- Extract and cross-check figures: `extract_figures`, `analyze_conflicts`.
- Find sources without a verdict: `search_sources`.

`webcite_guide` lists each workflow with its inputs, order and cost. Never ask the user to paste an API key into the conversation. The skills in `plugins/webcite/skills` give each workflow in more detail.
