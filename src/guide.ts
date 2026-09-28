/**
 * Zero-credit cold-start guide for MCP clients.
 */

export type GuideWorkflow =
  | 'quick_verify'
  | 'document_quote'
  | 'document_review'
  | 'numeric'
  | 'choose';

export function resolveGuideWorkflow(raw: unknown): GuideWorkflow {
  if (
    raw === 'quick_verify' ||
    raw === 'document_quote' ||
    raw === 'document_review' ||
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
        '1. If the file is already in Webcite, use its asset_id. Otherwise call `upload_file` with filename and file_base64. A Claude chat attachment is not automatically available to a remote MCP server; use bytes only when the client supplies them.',
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
        '1. Call `get_credit_balance` (0 credits). If the file is already in Webcite, use its asset_id; otherwise call `upload_file` only when the client supplies filename and file_base64. A Claude chat attachment is not automatically available to a remote MCP server. Then call `extract_document`. Save the asset_id and full structuredContent units. Check read status and lost units. The text display may stop at 8,000 characters; inspect the saved units before calling `extract_pages` or `get_source_preview` for missing content. Repeating `extract_document` or `extract_figures` incurs the stated per-call credits even when stored OCR is reused. Never call a partial read complete.',
        '2. Call `review_document` with a clear prompt, asset_ids and a stable thread_id. Pass official PDF URLs supplied by the user or found with `search_sources` in source_urls, with the required source filters. Save its review_id and resume_input. There is no fixed claim count. The server charges per claim, saves each completed result and stops when credits run out.',
        '3. Compare the extracted claim list against every material figure, period, comparison and relationship in all readable pages/sheets. `extract_figures` can add recognized financial metrics, but zero results does not mean there are no numbers. Check omitted claims individually with `verify_claim` using distinct stable idempotency keys. Report an official PDF read failure instead of substituting secondary sources. Evidence must address the same metric, period, unit and geography.',
        '4. Call `get_document_review` with review_id to recover completed and pending claims at zero credits. Follow next_offset until all pages are read. Inspect important citations with `get_source_preview`; `verify_batch` checks quote binding, not claim truth.',
        '5. If credits run out or a call fails, give the user the completed results, unchecked claims and missing pages now. Include review_id, thread_id, total, completed and pending counts, and required/remaining credits when known. After credits are available, call `review_document` with the exact resume_input, including source_urls, filters and billing flags. Completed claims replay without a new charge. Do not repeat separate `verify_claim` calls that already completed.',
        'Credits: extraction costs 1; document review charges per claim. Balance and saved-review readback cost 0.',
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
      '- `numeric` — figures and conflict analysis',
      '',
      'Re-call `webcite_guide` with `{ "workflow": "quick_verify" }` (or document_quote / document_review / numeric).',
    ].join('\n')
  );
}

export const WEBCITE_GUIDE_TOOL = {
  name: 'webcite_guide',
  description: `Start here. Returns the next Webcite tools to call and example JSON. Costs 0 credits. Use before verify_claim or document workflows when unsure.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      workflow: {
        type: 'string',
        enum: ['quick_verify', 'document_quote', 'document_review', 'numeric', 'choose'],
        description: 'Which workflow to explain. Default choose lists options.',
      },
      question: {
        type: 'string',
        description: 'Optional user question or claim to embed in examples',
      },
    },
  },
};
