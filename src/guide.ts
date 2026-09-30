/**
 * Zero-credit cold-start guide for MCP clients.
 */

export type GuideWorkflow =
  | 'quick_verify'
  | 'document_quote'
  | 'document_review'
  | 'source_trace'
  | 'numeric'
  | 'choose';

export function resolveGuideWorkflow(raw: unknown): GuideWorkflow {
  if (
    raw === 'quick_verify' ||
    raw === 'document_quote' ||
    raw === 'document_review' ||
    raw === 'source_trace' ||
    raw === 'numeric' ||
    raw === 'choose'
  ) {
    return raw;
  }
  return 'choose';
}

export function renderWebciteGuide(input: {
  workflow?: unknown;
  question?: unknown;
}): string {
  const workflow = resolveGuideWorkflow(input.workflow);
  const question =
    typeof input.question === 'string' && input.question.trim()
      ? input.question.trim()
      : undefined;

  const header = [
    '# Webcite guide',
    '',
    'Free plan: **100 credits/month**. This tool costs **0 credits**.',
    'Local and hosted MCP expose public API tools by default. Set `WEBCITE_MCP_PROFILE=core|docs|research|full` to change local discovery.',
    ...(question ? [`Your question: ${question}`] : []),
    '',
    '',
  ]
    .join('\n');

  if (workflow === 'quick_verify') {
    return (
      header +
      [
        '## Workflow: quick_verify',
        '1. Call `verify_claim` with:',
        '```json',
        JSON.stringify(
          {
            claim: question ?? 'The Eiffel Tower is 330 meters tall',
            include_stance: true,
            include_verdict: true,
          },
          null,
          2,
        ),
        '```',
        '2. Optional: `get_source_preview` on a citation URL/quote to show bind-back.',
        'Credits: typically 2–4 for verify_claim.',
      ].join('\n')
    );
  }

  if (workflow === 'document_quote') {
    return (
      header +
      [
        '## Workflow: document_quote',
        '1. Use the existing Webcite asset_id when available. For a Claude chat attachment or a file above the hosted tool limit, upload the binary in Webcite Playground or with HTTP multipart within the API\'s supported format and size limits, then use the returned asset_id. The remote MCP server cannot read a local path or automatically access a chat attachment. Use `upload_file` only for small files when the client directly supplies the original bytes as base64; never reconstruct bytes from extracted text.',
        '2. `extract_document` on the uploaded asset',
        '3. `get_source_preview` with the quote and asset_id / versioned ids',
        '4. Optional: `verify_batch` for many quotes',
        '',
        'Do **not** invent URLs.',
      ].join('\n')
    );
  }

  if (workflow === 'document_review') {
    return (
      header +
      [
        '## Workflow: document_review',
        '1. Call `get_credit_balance` (0 credits). If the file is already in Webcite, use its asset_id. For a Claude chat attachment or a file above the hosted tool limit, upload the binary in Webcite Playground or with HTTP multipart within the API\'s supported format and size limits, then use its asset_id; the remote MCP server cannot read a local path or automatically access the attachment. Use `upload_file` only when the client directly supplies original bytes for a small file, never reconstructed document text. Save the asset_id and source_version_id from upload, then call `extract_document`. Check read status and lost units. Some Claude connectors show only MCP text and omit structuredContent; the extraction text stops at 16,000 characters and lists links beyond that limit. For later content, use `get_latest_representation` with the actual source_version_id and `read_source_unit` with its returned IDs. An asset_id is not a source_version_id. If those IDs are unavailable, `extract_pages` costs 1 credit. Repeating `extract_document` or `extract_figures` incurs the stated per-call credits even when stored OCR is reused. Never call a partial read complete.',
        '2. Call `review_document` with a clear prompt, asset_ids and a stable thread_id. Pass official PDF URLs supplied by the user or found with `search_sources` in source_urls, with the required source filters. Save its job_id. There is no fixed claim count. The server checks claims in the background and saves each completed result.',
        '3. Compare the extracted claim list against every material figure, period, comparison and relationship in all readable pages/sheets. `extract_figures` can add recognized financial metrics, but zero results does not mean there are no numbers. Check omitted claims individually with `verify_claim` using distinct stable idempotency keys. Report an official PDF read failure instead of substituting secondary sources. Evidence must address the same metric, period, unit and geography.',
        '4. Poll `get_document_review_job` with job_id at zero credits. Once review_id appears, call `get_document_review` to read saved checked and pending claims, source coverage, uncovered spans and rejected candidates. Follow next_offset, next_gap_offset and next_rejected_offset until all pages are read. Inspect important citations with `get_source_preview`; `verify_batch` checks quote binding, not claim truth.',
        '5. If credits run out or the job fails, give the user the saved checked claims, unchecked claims, and uncovered source passages now. After credits are available or the failure is diagnosed, call `review_document` with the same prompt, thread_id, assets, source URLs, filters and billing flags plus a new idempotency_key. Completed claims replay without a new charge. Do not repeat separate `verify_claim` calls that already completed.',
        'Credits: extraction costs 1; document review charges per claim. Balance and saved-review readback cost 0.',
      ].join('\n')
    );
  }

  if (workflow === 'source_trace') {
    return (
      header +
      [
        '## Workflow: source_trace',
        '1. Call `extract_document` on the uploaded screenshot or slide. Read the actual table labels, units, years and distinctive figures. If extraction is incomplete, say which part is unreadable.',
        '2. Call `search_sources` with those exact details. If results are secondary or empty, refine the search using a likely regulator or report title suggested by the table. Do not treat a domain filter returning zero as proof that the official source does not exist.',
        '3. Open candidate URLs with `get_source_preview`. Identify the original publisher and page only when the same metric, period, unit, geography and table values are present. For a claim check, pass confirmed official PDFs to `verify_claim` in `source_urls`.',
        '4. If the original source or country is not established by the document and checked URLs, report it as unresolved. Do not infer a country from currency alone or cite a news summary as the original publication.',
        '`ask_document` checks numerical answers inside supplied text; it does not discover external source URLs.',
      ].join('\n')
    );
  }

  if (workflow === 'numeric') {
    return (
      header +
      [
        '## Workflow: numeric',
        '1. `extract_document` to read every page and identify its file format. `extract_figures` only finds recognized metrics; zero metrics does not mean the page has no numbers.',
        '2. Use `analyze_document` for PDF, spreadsheet or JPEG/PNG/WebP numeric analysis. Image figures are OCR/model reads and need source review. For a whole-slide external fact-check, also use `review_document`; use `analyze_conflicts` only when you have figures to compare.',
        '```json',
        JSON.stringify(
          {
            asset_id: 'asset_...',
          },
          null,
          2,
        ),
        '```',
      ].join('\n')
    );
  }

  return (
    header +
    [
      '## Choose a workflow',
      '- `quick_verify` — fact-check a sentence (most common cold start)',
      '- `document_quote` — bind a quote inside an uploaded document',
      '- `document_review` — check every material claim in an uploaded document',
      '- `source_trace` — find and check the original publication behind a screenshot or slide',
      '- `numeric` — figures and conflict analysis',
      '',
      'Re-call `webcite_guide` with `{ "workflow": "quick_verify" }` (or document_quote / document_review / source_trace / numeric).',
    ].join('\n')
  );
}

export const WEBCITE_GUIDE_TOOL = {
  name: 'webcite_guide',
  description: `Call this free guide first to choose a Webcite workflow. Use workflow=source_trace to identify the original source of a screenshot or slide; use workflow=document_review to check every claim in an uploaded file. Costs 0 credits.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      workflow: {
        type: 'string',
        enum: ['quick_verify', 'document_quote', 'document_review', 'source_trace', 'numeric', 'choose'],
        description: 'Which workflow to explain. Default choose lists options.',
      },
      question: {
        type: 'string',
        description: 'Optional user question or claim to embed in examples',
      },
    },
  },
};
