---
name: webcite-parse-documents
description: "Use when the user wants a PDF, scanned page, image, spreadsheet, Word or PowerPoint file converted to Markdown or text, OCR on a scan, tables pulled out, or a document split into citation-ready chunks for RAG. Parses documents with Webcite page by page with page and sheet locations. Triggers: pdf to markdown, OCR, parse document, extract text, chunk for RAG."
license: MIT
compatibility: Needs the Webcite MCP server (https://api.webcite.co/mcp, OAuth sign-in) or a Webcite API key in WEBCITE_API_KEY for the REST API at https://api.webcite.co.
---

# Parse documents with Webcite

## When to use

- Converting a PDF, scan, JPEG/PNG/WebP image, spreadsheet, DOCX, PPTX, HTML or text file to Markdown.
- Splitting a document into chunks with page, sheet or section anchors for indexing.

Not for checking whether the content is true: use `webcite-review-document` or `webcite-verify-claims`.

## MCP path

1. Get an `asset_id`: `upload_url` for a public HTTPS URL, or `upload_file` with the bytes. The hosted server cannot read a path on the user's computer; use the local server, or upload through the REST API.
2. `extract_document` with the `asset_id` returns whole-document Markdown and per-page or per-sheet units, each carrying its page or sheet. Scanned pages and images go through OCR.
3. `extract_pages` returns citation-ready chunks with anchors (1 credit).

Check each unit's read status: empty text is not proof that a page has no content. Keep the returned structured content and reuse it; repeating an extraction costs credits again.

## REST path

```bash
curl -s https://api.webcite.co/api/v1/upload -H "x-api-key: $WEBCITE_API_KEY" -F file=@report.pdf
curl -s https://api.webcite.co/api/v1/extract -H "x-api-key: $WEBCITE_API_KEY" \
  -H "content-type: application/json" -d '{"asset_id": "<asset_id from upload>"}'
```

Docs: https://webcite.co/api-docs/extraction

## Authentication

- Hosted MCP signs in with OAuth in the client (for example `/mcp` in Claude Code). An account is required; sign up at https://webcite.co.
- REST calls send the key in the `x-api-key` header. Create a key at https://webcite.co/api-keys (sign-in required) and read it from `WEBCITE_API_KEY`.
- Never ask the user to paste an API key into the conversation.
- A 401 from `/api/v1/*` names the header, the key page and the docs in its body.
