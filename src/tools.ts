/**
 * MCP tool schemas — one entry per WebCite public API v1 endpoint.
 *
 * Every endpoint the API exposes has a tool here; `tools.test.js` fails the build
 * if a tool has no handler or a handler has no tool.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const assetRefProperties = {
  asset_id: {
    type: 'string',
    description: 'An uploaded asset ID from upload_file. Provide this OR asset_url.',
  },
  asset_url: {
    type: 'string',
    description:
      'A direct URL to the file (e.g. your own signed storage URL), so the file need not be uploaded to WebCite. Provide this OR asset_id.',
  },
};

export const TOOLS: ToolDefinition[] = [
  {
    name: 'verify_claim',
    description: `Verify a factual claim against authoritative sources. Returns sources with stance analysis (supports/contradicts/neutral) and an overall verdict.

Use this when you need to:
- Fact-check a specific claim
- Find sources that support or contradict a statement
- Get a confidence score for a claim's accuracy

Credits: 2-4 depending on options (search: 2, +stance: 1, +verdict: 1)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        claim: {
          type: 'string',
          description: 'The factual claim to verify (e.g., "The Eiffel Tower is 330 meters tall")',
        },
        thread_id: {
          type: 'string',
          description:
            'Thread ID to group related verifications in a session. Pass the same thread_id to continue a conversation.',
        },
        include_stance: {
          type: 'boolean',
          description:
            'Include stance analysis (supports/contradicts) for each source. Adds 1 credit. Default: true',
          default: true,
        },
        include_verdict: {
          type: 'boolean',
          description:
            'Generate an overall verdict with confidence score. Adds 1 credit. Default: true',
          default: true,
        },
        decompose_claim: {
          type: 'boolean',
          description:
            'Break complex claims into sub-claims and verify each independently. Useful for multi-part claims.',
          default: false,
        },
      },
      required: ['claim'],
    },
  },
  {
    name: 'verify_claim_stream',
    description: `Verify a factual claim using the streaming endpoint. Collects all intermediate results (claim decomposition progress, per-sub-claim results) and returns the assembled result.

Prefer this over verify_claim when:
- The claim is complex and may take a long time to verify
- You want intermediate progress data (sub-claim decomposition, per-claim results)
- You want to avoid HTTP timeouts on long-running verifications

Returns the same formatted output as verify_claim. Credits: same as verify_claim.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        claim: {
          type: 'string',
          description: 'The factual claim to verify',
        },
        thread_id: {
          type: 'string',
          description:
            'Thread ID to group related verifications in a session. Pass the same thread_id to continue a conversation.',
        },
        include_stance: {
          type: 'boolean',
          description: 'Include stance analysis for each source. Default: true',
          default: true,
        },
        include_verdict: {
          type: 'boolean',
          description: 'Generate an overall verdict with confidence score. Default: true',
          default: true,
        },
        decompose_claim: {
          type: 'boolean',
          description: 'Break complex claims into sub-claims and verify each independently.',
          default: false,
        },
      },
      required: ['claim'],
    },
  },
  {
    name: 'search_sources',
    description: `Search for authoritative sources related to a query. Returns raw citations without stance analysis or verdict.

Use this when you need to:
- Find sources on a topic quickly
- Get raw search results for further analysis
- Save credits by skipping analysis

Credits: 2 (search only)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query or claim to find sources for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of sources to return (1-20)',
          default: 10,
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_citations',
    description: `List your past verification results. Useful for reviewing previous fact-checks or continuing a research session.

Credits: 1`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: {
          type: 'number',
          description: 'Page number (starts at 1)',
          default: 1,
          minimum: 1,
        },
        limit: {
          type: 'number',
          description: 'Results per page (max 50)',
          default: 10,
          minimum: 1,
          maximum: 50,
        },
        thread_id: {
          type: 'string',
          description: 'Filter by thread ID to get citations from a specific session',
        },
      },
    },
  },
  {
    name: 'get_citation',
    description: `Get the full details of a specific past verification by its ID.

Credits: 1`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        citation_id: {
          type: 'string',
          description: 'The citation ID to retrieve',
        },
      },
      required: ['citation_id'],
    },
  },
  {
    name: 'upload_file',
    description: `Upload a file to WebCite for use as verification context. Supports documents (PDF, DOCX, TXT) and other common file types.

Use this when you need to:
- Verify claims against a specific document
- Provide additional context for fact-checking
- Upload research papers or reports for analysis

Returns a file ID you can pass as asset_id to get_source_preview, extract_document, extract_figures, classify_document and analyze_document.

Credits: 1`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to upload',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'get_source_preview',
    description: `Resolve a citation back to its exact source and render it, so you can show the evidence behind a claim.

Use this when you need to:
- Show the exact passage a citation came from (not just the URL)
- Get a deep link that scrolls to the quote (web) or opens the cited PDF page
- Verify a quote is actually present in its source before relying on it

Works for two source types:
- **Web** (pass \`url\`): returns a text-fragment deep link (url#:~:text=quote).
- **Document** (pass \`asset_id\` from upload_file): returns the cited page's extracted text and an asset_url#page=N link. Spreadsheets return the sheet grid.

Every preview reports **bindBack**: whether the quote was found in the source (grounded) and how it matched (exact / normalized / unbound). A quote that cannot be bound back is never reported as grounded.

Credits: 1`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'Web source URL to preview (provide this OR asset_id).',
        },
        asset_id: {
          type: 'string',
          description:
            'Uploaded asset ID from upload_file (provide this OR url). Also accepts an "asset://<id>" citation url.',
        },
        page: {
          type: 'number',
          description: '1-based page (PDF) or sheet index (spreadsheet). Default: 1',
        },
        quote: {
          type: 'string',
          description: 'The cited quote to bind back against the source and highlight.',
        },
      },
    },
  },
  {
    name: 'verify_batch',
    description: `Check many quotes against their sources in one call. Each item is a quote plus its source: inline text, a URL, or an uploaded asset.

Per item you get back whether the quote is grounded, how it matched (exact / normalized / fuzzy / unbound), the best-matching passage and score even when unbound, a verification band, and a feedback_token.

A fuzzy match is capped at needs_review and never reported as verified.

Use this when you need to:
- Check every citation in a document at once
- Confirm quotes you (or another model) produced actually appear in their sources
- Get feedback tokens so a human can accept or reject each result

Deterministic — no model calls. Credits: 1 per item — the work is per item, so a 200-claim batch costs 200. Max 200 items per call.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array',
          description: 'The quotes to check, each against its own source (1-200 items).',
          minItems: 1,
          maxItems: 200,
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Your own id, echoed back on the result so you can map it.',
              },
              quote: { type: 'string', description: 'The claim or quote to check.' },
              source_text: {
                type: 'string',
                description: 'The source text to check the quote against. Provide this, or url, or asset_id.',
              },
              url: { type: 'string', description: 'A web source URL to resolve and check against.' },
              asset_id: {
                type: 'string',
                description: 'An uploaded asset ID (from upload_file) to check against.',
              },
              page: { type: 'number', description: '1-based page, for an asset source.' },
            },
            required: ['quote'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'verify_feedback',
    description: `Record a human verdict on a verify_batch result. Pass the feedback_token from that result plus your verdict; the token carries the result summary, so token + verdict is enough.

Feedback is stored, so corrections accumulate over time.

Credits: 1`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: {
          type: 'string',
          description: 'The feedback_token returned by verify_batch for the result being judged.',
        },
        verdict: {
          type: 'string',
          enum: ['correct', 'incorrect', 'unsure'],
          description: 'The verdict on that result.',
        },
        note: {
          type: 'string',
          description: 'Optional note or correction explaining the verdict.',
        },
      },
      required: ['token', 'verdict'],
    },
  },
  {
    name: 'analyze_conflicts',
    description: `Verify NUMBERS, not just text. Give the figures you already extracted (from extract_figures, or your own pipeline) and the engine:

- **recomputes** every derivable metric from its primitives (gross margin from revenue and COGS, growth from two periods) and flags where the stated value does not match the computed one;
- **detects cross-document conflicts** — figures for the same metric/entity/period that disagree beyond the metric's tolerance;
- **flags semantic conflicts** — values that are each plausible alone but jointly impossible;
- returns a **review** flag with the concrete reasons a human should look.

Deterministic — no model calls, so a conflict either exists or it does not. Credits: 1.

Prefer analyze_document when you have a file rather than a figure list.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        figures: {
          type: 'array',
          description: 'Figures extracted across one or more documents.',
          items: {
            type: 'object',
            properties: {
              metric: {
                type: 'string',
                description: 'Metric dictionary key, e.g. "gross_margin".',
              },
              value: {
                type: 'number',
                description: "Value normalized to the metric's canonical unit.",
              },
              unit: {
                type: 'string',
                enum: ['percent', 'multiple', 'currency', 'ratio', 'count', 'months'],
                description: 'Canonical unit.',
              },
              entity: { type: 'string', description: 'Entity scope, e.g. "subscription".' },
              period: { type: 'string', description: 'Period, e.g. "FY2024".' },
              provenance: {
                type: 'object',
                description: 'Where the value came from.',
                properties: {
                  assetId: { type: 'string' },
                  documentName: { type: 'string' },
                  page: { type: 'number', description: '1-based page.' },
                  sheet: { type: 'string' },
                  cell: { type: 'string', description: 'Cell reference, e.g. B4.' },
                  method: {
                    type: 'string',
                    enum: ['rule', 'model'],
                    description: 'How the value was extracted.',
                  },
                },
                required: ['assetId', 'documentName', 'method'],
              },
            },
            required: ['metric', 'value', 'unit', 'provenance'],
          },
        },
      },
      required: ['figures'],
    },
  },
  {
    name: 'analyze_document',
    description: `Document-in numeric analysis. Give an uploaded asset ID; the file is downloaded, its figures extracted, then recomputed and cross-checked. Returns the figures alongside conflicts, recomputations, a review flag, and the document's category.

- **Spreadsheets** (xlsx/xls/csv): extracted deterministically with exact cell provenance. No model calls.
- **PDFs**: a vision model reads the printed figures (it never computes); those are model reads, capped at needs_review. Requires a configured vision model.

Credits: 3. The document is downloaded, parsed and — for PDFs — read page by page by a vision model. Rate-limited more strictly than compute-only endpoints.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        asset_id: {
          type: 'string',
          description: 'The uploaded asset ID (from upload_file) to analyze. Spreadsheet or PDF.',
        },
      },
      required: ['asset_id'],
    },
  },
  {
    name: 'classify_document',
    description: `Classify a document into a coarse **category** plus the fine multi-type **covers** it holds (a bundled workbook covers several). Deterministic and model-free — works with no model configured.

Use this when you need to:
- File an uploaded document into a data-room category
- Know what a workbook actually contains before reading it
- Feed \`category\` and \`covers\` into document_gaps

Credits: 1`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        ...assetRefProperties,
        taxonomy: {
          type: 'string',
          enum: ['vc', 'ma'],
          description: 'Taxonomy preset: "vc" (venture data-room) or "ma" (M&A). Default: vc',
          default: 'vc',
        },
      },
    },
  },
  {
    name: 'document_gaps',
    description: `The "usually also here" checklist for a category. Given the documents already filed in it, returns each expected document type flagged present or absent. An item counts as present when any document matches it by filename, category, or covered type.

Advisory — nothing blocks. Pure and deterministic, no I/O and no model calls.

Credits: 1`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'The category whose expected-documents checklist to compute.',
        },
        docs: {
          type: 'array',
          description: 'The documents currently filed in that category.',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string' },
              label: { type: 'string' },
              category: { type: 'string' },
              covers: {
                type: 'array',
                items: { type: 'string' },
                description: 'Fine types this document covers, e.g. from classify_document.',
              },
            },
          },
        },
        taxonomy: {
          type: 'string',
          enum: ['vc', 'ma'],
          description: 'Taxonomy preset. Default: vc',
          default: 'vc',
        },
        stage: {
          type: 'string',
          enum: ['early', 'growth'],
          description: 'Company stage, to tailor the checklist.',
        },
      },
      required: ['category'],
    },
  },
  {
    name: 'extract_document',
    description: `Extract any document into normalized text with provenance: whole-doc markdown, per-page/sheet units carrying their page or sheet, and (for spreadsheets) sheet names.

Handles PDF, spreadsheets, docx, pptx, html and txt. Deterministic-first; scanned PDFs fall back to vision OCR. Extraction never hard-fails — an unreadable asset returns empty text.

Long documents are truncated in the tool output; use get_source_preview for a specific page.

Credits: 1`,
    inputSchema: {
      type: 'object' as const,
      properties: { ...assetRefProperties },
    },
  },
  {
    name: 'extract_figures',
    description: `Extract every number from a document as a tagged, source-grounded figure: the value normalized to its canonical unit, what it means (\`metric\`), \`unit\`, optional \`entity\`/\`period\`, a confidence \`band\`, whether it was confirmed against the cited cell (\`bound\`), and full \`provenance\` (asset, sheet, cell, page).

This is deterministic financial-model reading: header scale ("$M" / "'000"), accounting negatives, period columns (FY2023 vs FY2024) and unit declarations are all honoured, so a percentage is never mis-read as a currency.

Reads spreadsheets (cell-level), PDFs with a text layer (grounded and cited by page), and other text formats deterministically. Scanned pages and images go through vision OCR first, then grounding, and are marked as model reads.

Feed the result straight into analyze_conflicts. Credits: 2`,
    inputSchema: {
      type: 'object' as const,
      properties: { ...assetRefProperties },
    },
  },
  {
    name: 'accuracy_report',
    description: `The numeric engine's measured accuracy against its gold-set corpus: conflict detection rate and precision, and recompute correctness. Reproducible and gated on every build — an accuracy regression cannot ship.

Use this when you need to state how accurate the verification is, rather than assert it.

Credits: 1`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];
