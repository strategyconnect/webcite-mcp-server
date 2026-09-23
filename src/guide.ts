/**
 * Zero-credit cold-start guide for MCP clients.
 */

export type GuideWorkflow =
  | 'quick_verify'
  | 'document_quote'
  | 'numeric'
  | 'choose';

export function resolveGuideWorkflow(raw: unknown): GuideWorkflow {
  if (
    raw === 'quick_verify' ||
    raw === 'document_quote' ||
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
      '- `numeric` — figures and conflict analysis',
      '',
      'Re-call `webcite_guide` with `{ "workflow": "quick_verify" }` (or document_quote / numeric).',
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
        enum: ['quick_verify', 'document_quote', 'numeric', 'choose'],
        description: 'Which workflow to explain. Default choose lists options.',
      },
      question: {
        type: 'string',
        description: 'Optional user question or claim to embed in examples',
      },
    },
  },
};
