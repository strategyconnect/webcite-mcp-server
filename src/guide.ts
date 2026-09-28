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
    'Hosted MCP exposes supported public API tools. Local default is `core`; set `WEBCITE_MCP_PROFILE=public|docs|research|full` to change local discovery.',
    question ? `Your question: ${question}` : '',
    '',
  ]
    .filter(Boolean)
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
        '1. `upload_file` (content_base64 + filename)',
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
        '1. `upload_file`, then `extract_document` with its asset_id. Check read status and the number of pages/sheets. If text is truncated or units are missing, read those pages with `get_source_preview` or `extract_pages` before claiming full coverage.',
        '2. Build a checklist from every material figure, period, comparison, and stated relationship in the extracted text. Keep its page/sheet for each item. `extract_figures` can add recognized financial metrics, but zero results does not mean there are no numbers.',
        '3. Call `verify_claim` for each independently checkable checklist item. Reuse a thread_id and use distinct idempotency keys. Supply an authoritative source URL or filters when the user requires them. A source must address the same metric, period, unit, and geography.',
        '4. Use `get_source_preview` to inspect cited passages. `verify_batch` checks whether quotes appear in sources; it does not fact-check the underlying claims.',
        '5. Report checklist count, checked count, supported/contradicted/unverified counts, missing pages, and any items not checked. Continue in batches until every item is accounted for. Never label a partial read a full review.',
        'Credits: extraction costs 1; each full claim verification usually costs 4. Check usage before a large batch.',
      ].join('\n')
    );
  }

  if (workflow === 'numeric') {
    return (
      header +
      [
        '## Workflow: numeric',
        '1. `extract_figures` from the document',
        '2. `analyze_conflicts` (or document analyze) for mismatches',
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
