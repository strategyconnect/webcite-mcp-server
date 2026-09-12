/**
 * MCP tool schemas — v1 tools stay 1:1 with public API v1 endpoints.
 *
 * Context/evidence (v2) tools live in CONTEXT_TOOLS so the v1 ENDPOINT_TOOLS
 * coverage guard in `tools.test.js` stays exact. ListTools serves ALL_TOOLS.
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

const claimScopeProperties = {
  entityId: { type: 'string', description: 'Entity scope id, or omit/null when unknown.' },
  metric: { type: 'string', description: 'Metric key, e.g. revenue.' },
  period: { type: 'string', description: 'Period label, e.g. FY2024.' },
  unit: { type: 'string', description: 'Unit when known.' },
  currency: { type: 'string', description: 'ISO currency when known.' },
  scale: { type: 'string', description: 'Scale declaration when known.' },
  basis: {
    type: 'string',
    enum: ['actual', 'forecast', 'assumption', 'unknown'],
    description: 'Claim basis.',
  },
  definition: { type: 'string', description: 'Definition text when known.' },
};

/**
 * W1 context/evidence tools — map to WebCite HTTP v2 routes.
 * Scope always comes from the authenticated API key, never from MCP annotations.
 */
export const CONTEXT_TOOLS: ToolDefinition[] = [
  {
    name: 'get_answer',
    description: `Resolve an immutable answer revision by ID. Returns the sealed answer text, packet identities, justifications, spans and presentation numbers.

Does not regenerate evidence or call a model — retrieval only. Unknown or unauthorized IDs fail explicitly.

Credits: 1. HTTP: GET /api/v2/answers/:revisionId`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        revision_id: {
          type: 'string',
          description: 'Immutable answer revision ID (not the logical history id alone).',
        },
      },
      required: ['revision_id'],
    },
  },
  {
    name: 'get_evidence_packet',
    description: `Resolve a sealed evidence packet by ID. Returns the frozen packet, refs and presentation numbers without re-running extraction or support checks.

Credits: 1. HTTP: GET /api/v2/evidence-packets/:id`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        packet_id: {
          type: 'string',
          description: 'Sealed evidence packet ID.',
        },
      },
      required: ['packet_id'],
    },
  },
  {
    name: 'query_context',
    description: `Query persisted context for numbers or passages. A successful no-match (status refuse / empty refs) is not a tool failure — it means nothing matched under current authorization.

Never supply tenant/scope fields; the API derives scope from the API key.

Credits: 1. HTTP: POST /api/v2/context/query`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'Natural-language query (e.g. "What was revenue in FY2024?").',
        },
        source_texts: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional inline source texts to materialize for the query.',
        },
        source_version_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional persisted source version IDs aligned with source_texts.',
        },
        filters: {
          type: 'object',
          description: 'Optional claim-scope filters (metric, period, entityId, …).',
          properties: claimScopeProperties,
        },
        max_hops: {
          type: 'number',
          enum: [0, 1, 2],
          description: 'Authorized expansion hops. Default: 1',
          default: 1,
        },
        limit: {
          type: 'number',
          description: 'Max passage refs to return. Default: 10',
          default: 10,
          minimum: 1,
          maximum: 50,
        },
        idempotency_key: {
          type: 'string',
          description: 'Logical idempotency key for chargeable/settled calls. Not a scope field.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'compare_assertions',
    description: `Compare two claim scopes. Returns same, different, or unknown — unknown is never treated as contradiction.

Credits: 1. HTTP: POST /api/v2/context/compare-assertions`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        left: {
          type: 'object',
          description: 'Left claim scope.',
          properties: claimScopeProperties,
        },
        right: {
          type: 'object',
          description: 'Right claim scope.',
          properties: claimScopeProperties,
        },
        idempotency_key: {
          type: 'string',
          description: 'Logical idempotency key. Not a scope field.',
        },
      },
      required: ['left', 'right'],
    },
  },
  {
    name: 'resolve_fragment_uses',
    description: `A_SELECT_USES: resolve authorized fragment uses for a selector. Returns matchKind (exact/contains/contained/overlap); semanticSupport is always false — overlap never implies support. Successful refuse is not a tool failure. Prefer packet_id or answer_revision_id for a sealed server catalog; client fragments/groups/links are refused when either sealed id is set.

Credits: 1. HTTP: POST /api/v2/context/fragments/resolve-uses`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        selector: {
          type: 'object',
          description:
            'FragmentSelector with kind (tokens|image) and representationId. Unsupported kinds refuse.',
        },
        packet_id: {
          type: 'string',
          description:
            'Sealed evidence packet id — catalog loaded server-side. Mutually exclusive with answer_revision_id; omit client catalog rows.',
        },
        answer_revision_id: {
          type: 'string',
          description:
            'Sealed answer revision id — evidence catalog loaded server-side. Mutually exclusive with packet_id; omit client catalog rows.',
        },
        fragments: {
          type: 'array',
          description:
            'Optional authorized SourceFragment catalog (empty → no matches). Forbidden when packet_id or answer_revision_id is set.',
          items: { type: 'object' },
        },
        groups: {
          type: 'array',
          description:
            'Optional EvidenceGroup rows for groupIds on matches. Forbidden when a sealed id is set.',
          items: { type: 'object' },
        },
        links: {
          type: 'array',
          description:
            'Optional EvidenceLink rows for linkIds on matches. Forbidden when a sealed id is set.',
          items: { type: 'object' },
        },
        consumers: {
          type: 'array',
          description:
            'Optional consumer rows (fragment_id/consumer_id/use_age). Forbidden when a sealed id is set.',
          items: { type: 'object' },
        },
        allowed_fragment_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional authorization allow-list; fragments outside are ignored. Forbidden when a sealed id is set.',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor from a prior nextCursor.',
        },
        limit: {
          type: 'number',
          description: 'Max matches to return. Default: 50',
          default: 50,
          minimum: 1,
          maximum: 200,
        },
        idempotency_key: {
          type: 'string',
          description: 'Logical idempotency key. Not a scope field.',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'get_change_impact',
    description: `Inspect freshness and/or packet change impact (W3). Pass answer_revision_id for sealed-answer freshness, and/or changed_ids (+ optional links/packet_id/window) for packet dependency impact. Blank/whitespace/padded changed_ids → incomplete_changed_ids; blank/whitespace/padded link endpoints → incomplete_dependency_graph; incomplete sealed-packet or dependency graphs fail closed as change_impact_incomplete — never silent empty "no impact". Historical answer content stays sealed.

Credits: 1. HTTP: POST /api/v2/context/change-impact`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        answer_revision_id: {
          type: 'string',
          description: 'Answer revision to inspect for source freshness/change impact.',
        },
        packet_id: {
          type: 'string',
          description:
            'Optional sealed packet id. When set with changed_ids, missing packets fail closed (change_impact_incomplete).',
        },
        changed_ids: {
          type: 'array',
          description:
            'Changed source/node ids for packet dependency impact. Blank/whitespace/padded entries → incomplete_changed_ids (never stripped into certified empty impact).',
          items: {
            type: 'string',
            description: 'Non-blank unpadded root id; blank/whitespace/padded → incomplete_changed_ids.',
          },
        },
        links: {
          type: 'array',
          description:
            'Dependency links (source_id → consumer_id). Blank/whitespace/padded endpoints → incomplete_dependency_graph (never trimmed into certified match / empty impact). Omit → missing_dependency_graph.',
          items: {
            type: 'object',
            properties: {
              source_id: {
                type: 'string',
                description:
                  'Non-blank unpadded source id; blank/whitespace/padded → incomplete_dependency_graph.',
              },
              consumer_id: {
                type: 'string',
                description:
                  'Non-blank unpadded consumer id; blank/whitespace/padded → incomplete_dependency_graph.',
              },
            },
            required: ['source_id', 'consumer_id'],
          },
        },
        observed_at_ms: {
          type: ['number', 'null'],
          description: 'Observation time for optional impact window (null is unresolved).',
        },
        window: {
          type: 'object',
          description: 'Half-open observation window { start_ms, end_ms }.',
          properties: {
            start_ms: { type: 'number' },
            end_ms: { type: 'number' },
          },
          required: ['start_ms', 'end_ms'],
        },
        idempotency_key: {
          type: 'string',
          description: 'Logical idempotency key. Not a scope field.',
        },
      },
    },
  },
  {
    name: 'create_evidence_packet',
    description: `Create a sealed evidence packet from authorized source bindings. The server builds and seals the packet — clients cannot supply a certified payload.

Scope comes from the authenticated API. Pass idempotency_key to settle once under retries.

Credits: 2. HTTP: POST /api/v2/context/evidence-packets`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        claim_text: {
          type: 'string',
          description: 'Claim text frozen into the packet assertions.',
        },
        operator_class: {
          type: 'string',
          description: 'Optional operator class label (default select_passage).',
        },
        bindings: {
          type: 'array',
          description: 'Authorized source unit bindings to seal.',
          items: {
            type: 'object',
            properties: {
              source_version_id: { type: 'string' },
              source_unit_id: { type: 'string' },
              representation_id: { type: 'string' },
              snippet: { type: 'string' },
              seed: { type: 'string' },
            },
            required: ['source_version_id', 'source_unit_id', 'representation_id'],
          },
          minItems: 1,
        },
        idempotency_key: {
          type: 'string',
          description: 'Logical idempotency key so retries settle once.',
        },
      },
      required: ['claim_text', 'bindings'],
    },
  },
  {
    name: 'assess_support',
    description: `Assess evidence support for a claim revision. Exact binding alone never invents support; tier ceilings cap machine judgments (I3).

Scope comes from the authenticated API.

Credits: 1. HTTP: POST /api/v2/context/assess-support`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        claim_revision_id: {
          type: 'string',
          description: 'Claim revision under assessment.',
        },
        claim_hash: {
          type: 'string',
          description: 'Hash of the claim text checked against the evidence group.',
        },
        evidence_group_revision_id: {
          type: 'string',
          description: 'Evidence group revision providing candidate support.',
        },
        alternative_fragment_id: {
          type: 'string',
          description: 'Optional competing fragment id when comparing alternatives.',
        },
        tier: {
          type: 'integer',
          enum: [1, 2, 3],
          description: 'Claim structure tier ceiling (default 3).',
        },
        proposed: {
          type: 'string',
          description: 'Optional proposed machine support before the tier ceiling.',
        },
        binding: {
          type: 'string',
          description: 'Optional binding state (exact/normalized/fuzzy/ambiguous/unresolved).',
        },
        idempotency_key: {
          type: 'string',
          description: 'Logical idempotency key. Not a scope field.',
        },
      },
      required: ['claim_revision_id', 'claim_hash', 'evidence_group_revision_id'],
    },
  },
  {
    name: 'assess_meaning',
    description: `Assess meaning / authority / false-claim facets independently (C5). Never collapses into one badge.

Credits: 1. HTTP: POST /api/v2/context/assess-meaning`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        assessment: {
          type: 'object',
          description: 'MeaningAssessment payload (ids, semanticReview, operationId, …).',
        },
        known_false_claim: {
          type: 'boolean',
          description: 'When true, evaluate false-claim support facet.',
        },
        idempotency_key: { type: 'string' },
      },
      required: ['assessment'],
    },
  },
  {
    name: 'number_inventory',
    description: `W2 A_WORKBENCH_COUNTS: count numeric occurrences by recognition state (read/uncertain/unreadable). Dedupes by occurrence id only — same magnitude at two locations stays two rows. Incomplete identity (blank/whitespace or surrounding-padded id or fragment_id)/blank or surrounding-padded raw/non-null blank or surrounding-padded normalized_decimal/invalid or missing method/invalid interpretation/recognition, or unreadable rows that claim a normalized decimal, fail closed as number_inventory_incomplete (never silently repaired; never invent method=native). Coverage complete means certified counts; unknown must not be treated as a certified inventory.

Credits: 1. HTTP: POST /api/v2/context/numbers/inventory`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        occurrences: {
          type: 'array',
          description:
            'NumericOccurrence rows. recognition_state + non-blank unpadded raw + valid method required for complete coverage (method is never defaulted to native). Non-blank unpadded id + fragment_id required (whitespace/padded → missing_occurrence_identity). Blank/padded raw → missing_occurrence_raw.',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description:
                  'Occurrence identity; blank/whitespace/padded (id !== trim) → missing_occurrence_identity.',
              },
              raw: {
                type: 'string',
                description:
                  'Non-blank unpadded glyph text; blank/whitespace or surrounding-padded (raw !== trim) → missing_occurrence_raw.',
              },
              fragment_id: {
                type: 'string',
                description:
                  'Fragment identity; blank/whitespace/padded → missing_occurrence_identity.',
              },
              fragmentId: {
                type: 'string',
                description:
                  'Alias of fragment_id; blank/whitespace/padded → missing_occurrence_identity.',
              },
              normalized_decimal: {
                type: ['string', 'null'],
                description:
                  'Optional magnitude; non-null blank/whitespace or surrounding-padded → blank_normalized_decimal. null allowed.',
              },
              normalizedDecimal: {
                type: ['string', 'null'],
                description:
                  'Alias of normalized_decimal; non-null blank/padded → blank_normalized_decimal.',
              },
              interpretation: {
                type: 'string',
                enum: [
                  'measure',
                  'date',
                  'identifier',
                  'ordinal',
                  'range',
                  'formula',
                  'unknown',
                ],
              },
              method: {
                type: 'string',
                enum: ['native', 'ocr', 'asr', 'human', 'chart_estimate'],
                description:
                  'Capture method. Omit/blank/invalid → invalid_occurrence_method (HTTP never invents native).',
              },
              recognition_state: {
                type: 'string',
                enum: ['read', 'uncertain', 'unreadable'],
              },
              recognitionState: {
                type: 'string',
                enum: ['read', 'uncertain', 'unreadable'],
              },
            },
          },
        },
        idempotency_key: { type: 'string' },
      },
      required: ['occurrences'],
    },
  },
  {
    name: 'find_contradictions',
    description: `Find pairwise contradiction candidates over interval-valued claims (W3). Unknown/open/blank bounds never invent a contradiction. Blank/whitespace interval endpoints and missing/blank decimals on conflicting or unknown pairs fail closed as contradiction_scan_incomplete (unknown_interval_bounds / missing_decimal_value) — never treat an empty pair list as a certified all-clear. Coverage complete means a certified scan.

Credits: 1. HTTP: POST /api/v2/context/contradictions`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        claims: {
          type: 'array',
          minItems: 2,
          description:
            'Interval-valued claims. Blank/whitespace from/to → unknown bounds; missing/blank decimal_value on overlapping/unknown pairs → missing_decimal_value (HTTP refuses).',
          items: {
            type: 'object',
            properties: {
              interval: {
                type: 'object',
                properties: {
                  from: {
                    type: ['string', 'null'],
                    description: 'Inclusive start; blank/whitespace is unknown (never invents a bound).',
                  },
                  to: {
                    type: ['string', 'null'],
                    description: 'Exclusive end; blank/whitespace is unknown (never invents a bound).',
                  },
                },
                required: ['from', 'to'],
              },
              decimal_value: {
                type: ['string', 'null'],
                description:
                  'Exact decimal text. Null/blank on conflicting or unknown-bound pairs → contradiction_scan_incomplete: missing_decimal_value.',
              },
            },
            required: ['interval', 'decimal_value'],
          },
        },
        idempotency_key: { type: 'string' },
      },
      required: ['claims'],
    },
  },
  {
    name: 'formal_eligibility',
    description: `Check exact-proof obligation eligibility (P1). Uncertain recognition never promotes.

Credits: 1. HTTP: POST /api/v2/context/formal/eligibility`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        decimal: { type: ['string', 'null'] },
        unit: { type: ['string', 'null'] },
        scale: { type: ['string', 'null'] },
        basis_reviewed: { type: 'boolean' },
        recognition: { type: 'string', enum: ['native', 'reviewed', 'uncertain'] },
        idempotency_key: { type: 'string' },
      },
      required: ['basis_reviewed', 'recognition'],
    },
  },
  {
    name: 'formal_check',
    description: `Check a bounded Lean certificate (P2). Static gates always run; Lean exec is optional.

Credits: 1. HTTP: POST /api/v2/context/formal/check`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: {
          type: 'string',
          description: 'Lean source text to check (template subset only).',
        },
        toolchain_version: { type: 'string', description: 'Approved pin, e.g. v4.33.1' },
        checker_digest: { type: 'string' },
        require_lean: { type: 'boolean' },
        timeout_ms: { type: 'number' },
        idempotency_key: { type: 'string' },
      },
      required: ['source'],
    },
  },
  {
    name: 'create_claim_relation',
    description: `Persist a formalized claim relation (C1). Unrecognised predicates are refused.

Credits: 1. HTTP: POST /api/v2/context/claim-relations`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        predicate: { type: 'string' },
        argument_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        arguments_resolved: { type: 'boolean' },
        claim_revision_id: { type: ['string', 'null'] },
        idempotency_key: { type: 'string' },
      },
      required: ['predicate', 'argument_ids', 'arguments_resolved'],
    },
  },
  {
    name: 'list_claim_relations',
    description: `List persisted claim relations for the authenticated tenant (C1).

Credits: 1. HTTP: GET /api/v2/context/claim-relations`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        predicate: { type: 'string' },
        claim_revision_id: { type: 'string' },
      },
    },
  },
  {
    name: 'create_metric_definition',
    description: `Persist an immutable metric definition revision (C1c).

Credits: 1. HTTP: POST /api/v2/context/metric-definitions`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        definition: { type: 'object', description: 'MetricDefinition payload' },
        idempotency_key: { type: 'string' },
      },
      required: ['definition'],
    },
  },
  {
    name: 'list_metric_definitions',
    description: `List persisted metric definition revisions (C1c).

Credits: 1. HTTP: GET /api/v2/context/metric-definitions`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        metric: { type: 'string' },
      },
    },
  },
  {
    name: 'claim_structure_tier',
    description: `Compute the claim tier ceiling from assertion structure and definition resolution (C1b). Does not persist.

Credits: 1. HTTP: POST /api/v2/context/claim-structure/tier`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        assertion: { type: 'object', description: 'TieredAssertion payload' },
        definition: {
          type: ['object', 'null'],
          description: 'Resolved MetricDefinition, if any',
        },
        ambiguity: {
          type: ['object', 'null'],
          description: 'Ambiguity with candidates when definition is unresolved',
        },
        idempotency_key: { type: 'string' },
      },
      required: ['assertion'],
    },
  },
  {
    name: 'claim_structure_resolve_definition',
    description: `Resolve an attributed metric definition or surface ambiguity (C1c). Does not persist.

Credits: 1. HTTP: POST /api/v2/context/claim-structure/resolve-definition`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        metric: { type: 'string' },
        knowledge_as_of: { type: 'string' },
        effective_at: { type: 'string' },
        catalog: {
          type: 'array',
          items: { type: 'object' },
          description: 'Candidate MetricDefinition revisions',
        },
        decision: {
          type: ['object', 'null'],
          description: 'Optional InterpretationDecision to disambiguate',
        },
        idempotency_key: { type: 'string' },
      },
      required: ['metric', 'knowledge_as_of', 'effective_at', 'catalog'],
    },
  },
  {
    name: 'formalize_claim_relation',
    description: `Dry-run formalize a claim relation without persisting (C1). Unrecognised predicates or unresolved args return formalized:false.

Credits: 1. HTTP: POST /api/v2/context/claim-relations/formalize`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        predicate: { type: 'string' },
        argument_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        arguments_resolved: { type: 'boolean' },
        idempotency_key: { type: 'string' },
      },
      required: ['predicate', 'argument_ids', 'arguments_resolved'],
    },
  },
  {
    name: 'create_research_run',
    description: `Create a durable research run checkpoint (C3). Scope comes from the API key. Omitting root_operation_id auto-opens a shared root budget. Gated by CONTEXT_GRAPH_RESEARCH (default off) — flag-off refuses fail-closed; do not invent a run.

Credits: 1. HTTP: POST /api/v2/context/research-runs`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        objective: { type: 'string' },
        snapshot_id: { type: 'string' },
        workflow_version: { type: 'string' },
        deal_id: { type: 'string' },
        session_id: { type: 'string' },
        budget: {
          type: 'object',
          properties: {
            max_credits: { type: 'number' },
            max_tokens: { type: 'number' },
            deadline_ms: { type: 'number' },
          },
          required: ['max_credits', 'max_tokens', 'deadline_ms'],
        },
        root_operation_id: { type: ['string', 'null'] },
        root_idempotency_key: {
          type: 'string',
          description: 'Idempotency key when auto-opening a root budget',
        },
        open_requirement_ids: { type: 'array', items: { type: 'string' } },
        max_steps: { type: 'number' },
        idempotency_key: { type: 'string' },
      },
      required: ['objective', 'snapshot_id', 'workflow_version', 'budget'],
    },
  },
  {
    name: 'get_research_run',
    description: `Load a research run by id (C3). Gated by CONTEXT_GRAPH_RESEARCH (default off) — flag-off refuses fail-closed; do not invent a run.

Credits: 1. HTTP: GET /api/v2/context/research-runs/:runId`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'list_research_runs',
    description: `List durable research runs for the authenticated tenant only (C3). Never invents foreign-tenant rows; empty when none. Gated by CONTEXT_GRAPH_RESEARCH (default off) — flag-off refuses fail-closed; do not invent a list.

Credits: 1. HTTP: GET /api/v2/context/research-runs`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'checkpoint_research_run',
    description: `Compare-and-swap a research-run checkpoint (C3). Stale revisions conflict. When run.wait is set, subjectId and subjectRevisionId must be non-blank/unpadded (whitespace/pad → incomplete_wake_subject_identity) and scope.tenantId must be non-blank/unpadded (whitespace/pad → incomplete_wake_tenant_identity; equal blanks/pads never wake). Gated by CONTEXT_GRAPH_RESEARCH (default off) — flag-off refuses fail-closed; do not invent a checkpoint.

Credits: 1. HTTP: POST /api/v2/context/research-runs/:runId/checkpoints`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string' },
        expected_revision: { type: 'number' },
        run: {
          type: 'object',
          description:
            'Full ResearchRun payload. Optional wait requires non-blank unpadded subjectId + subjectRevisionId (blank/whitespace/padded → incomplete_wake_subject_identity) and non-blank unpadded scope.tenantId (blank/whitespace/padded → incomplete_wake_tenant_identity).',
        },
        idempotency_key: { type: 'string' },
      },
      required: ['run_id', 'expected_revision', 'run'],
    },
  },
  {
    name: 'resolve_seeds',
    description: `Resolve entry-point seeds from ClaimScope vocabulary (C2). No embedding fallback. Omit index to use the SQL metric-definition catalog.

Credits: 1. HTTP: POST /api/v2/context/resolve-seeds`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string' },
        filters: { type: 'object' },
        index: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              scope: { type: 'object' },
              terms: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'scope', 'terms'],
          },
          description: 'Inline vocabulary. Omit to load from the SQL catalog.',
        },
        idempotency_key: { type: 'string' },
      },
      required: ['text'],
    },
  },
  {
    name: 'expand_seeds',
    description: `Bounded authorized seed expansion (C2). Unauthorized intermediates cannot be traversed; hops are capped at 2.

Credits: 1. HTTP: POST /api/v2/context/expand-seeds`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        seeds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
            },
            required: ['from', 'to'],
          },
        },
        allowed: { type: 'array', items: { type: 'string' } },
        hops: { type: 'number', description: 'Requested hops; kernel caps at 2' },
        idempotency_key: { type: 'string' },
      },
      required: ['seeds', 'edges', 'allowed'],
    },
  },
  {
    name: 'learning_judge',
    description: `E2 judge control: hard failures reject; uncertain may request evidence once.

Credits: 1. HTTP: POST /api/v2/context/learning/judge`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        hard_failures: { type: 'array', items: { type: 'string' } },
        verdict: { type: 'string', enum: ['pass', 'fail', 'uncertain', 'error'] },
        attempts: { type: 'number' },
        idempotency_key: { type: 'string' },
      },
      required: ['verdict', 'attempts'],
    },
  },
  {
    name: 'learning_apply',
    description: `Apply a learning proposal only when an explicit policy gate allows it (E2).

Credits: 1. HTTP: POST /api/v2/context/learning/apply`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        proposal: { type: 'object' },
        gate: {
          type: ['object', 'null'],
          properties: {
            gateId: { type: 'string' },
            allowed: { type: 'boolean' },
            reason: { type: 'string' },
          },
        },
        idempotency_key: { type: 'string' },
      },
      required: ['proposal'],
    },
  },
  {
    name: 'learning_placeholder',
    description: `Return a non-authoritative placeholder calibration checkpoint (E2).

Credits: 1. HTTP: GET /api/v2/context/learning/placeholder`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        criterion: { type: 'string' },
      },
    },
  },
  {
    name: 'format_certify',
    description: `Certify planted spreadsheet/office/text/image/container/media inventory coverage (F1–F4). Fails closed. Media requires decode_finished.

Credits: 1. HTTP: POST /api/v2/context/format/certify`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        kind: {
          type: 'string',
          enum: ['spreadsheet', 'office', 'text', 'image', 'container', 'media'],
        },
        expected: { type: 'array' },
        found: { type: 'array' },
        decode_finished: { type: 'boolean' },
        alignments: { type: 'array' },
        require_precise_timing: { type: 'boolean' },
        idempotency_key: { type: 'string' },
      },
      required: ['kind', 'expected', 'found'],
    },
  },
  {
    name: 'reserve_research_budget',
    description: `Reserve credits under a research run's root operation (I4). Missing root refuses. Gated by CONTEXT_GRAPH_RESEARCH (default off) — flag-off refuses fail-closed.

Credits: 1. HTTP: POST /api/v2/context/research-runs/:runId/reserve`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string' },
        idempotency_key: { type: 'string' },
        kind: { type: 'string' },
        credits: { type: 'number' },
        tokens: { type: 'number' },
      },
      required: ['run_id', 'idempotency_key', 'kind', 'credits'],
    },
  },
  {
    name: 'open_operation_root',
    description: `Open the run-level root EvidenceOperation whose budget every child shares (I4). Same idempotency key replays the existing root.

Credits: 1. HTTP: POST /api/v2/context/operations/open-root`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        idempotency_key: { type: 'string' },
        kind: { type: 'string' },
        max_credits: { type: 'number' },
        max_tokens: { type: 'number' },
        deadline_ms: { type: 'number' },
      },
      required: [
        'idempotency_key',
        'kind',
        'max_credits',
        'max_tokens',
        'deadline_ms',
      ],
    },
  },
  {
    name: 'reserve_operation',
    description: `Reserve credits for one logical EvidenceOperation call (I4). Optional root_operation_id holds against a shared root budget without requiring a research run.

Credits: 1. HTTP: POST /api/v2/context/operations/reserve`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        idempotency_key: { type: 'string' },
        kind: { type: 'string' },
        credits: { type: 'number' },
        tokens: { type: 'number' },
        root_operation_id: { type: 'string' },
      },
      required: ['idempotency_key', 'kind', 'credits'],
    },
  },
  {
    name: 'get_operation',
    description: `Read one EvidenceOperation the caller owns (I4), including settlement fields.

Credits: 1. HTTP: GET /api/v2/context/operations/:operationId`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation_id: { type: 'string' },
      },
      required: ['operation_id'],
    },
  },
  {
    name: 'get_operation_availability',
    description: `Read root budget availability as the ledger sees it (I4). Clients must not re-derive this weakly.

Credits: 1. HTTP: GET /api/v2/context/operations/:operationId/availability`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation_id: { type: 'string' },
      },
      required: ['operation_id'],
    },
  },
  {
    name: 'settle_operation',
    description: `Settle a reserved EvidenceOperation once (I4). Pass settled_credits null to mark reconciliation_required without inventing an amount.

Credits: 1. HTTP: POST /api/v2/context/operations/:operationId/settle`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation_id: { type: 'string' },
        settled_credits: {
          type: ['number', 'null'],
          description: 'Credits to settle, or null for reconciliation_required',
        },
        idempotency_key: { type: 'string' },
      },
      required: ['operation_id', 'settled_credits'],
    },
  },
  {
    name: 'release_operation',
    description: `Release an undispatched reservation and return credits to the account (I4). Dispatched operations cannot be released.

Credits: 1. HTTP: POST /api/v2/context/operations/:operationId/release`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation_id: { type: 'string' },
      },
      required: ['operation_id'],
    },
  },
  {
    name: 'record_operation_attempt',
    description: `Persist an EvidenceAttempt BEFORE dispatch so a lost outcome stays attributable (I4).

Credits: 1. HTTP: POST /api/v2/context/operations/:operationId/attempts`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation_id: { type: 'string' },
        provider: { type: 'string' },
        model: { type: ['string', 'null'] },
        provider_idempotency_key: { type: ['string', 'null'] },
        idempotency_key: { type: 'string' },
      },
      required: ['operation_id', 'provider'],
    },
  },
  {
    name: 'resolve_operation_attempt',
    description: `Resolve one attempt outcome (I4). Missing price stays unknown, never zero.

Credits: 1. HTTP: POST /api/v2/context/attempts/:attemptId/resolve`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        attempt_id: { type: 'string' },
        state: {
          type: 'string',
          enum: ['succeeded', 'failed', 'outcome_unknown'],
        },
        failure_class: { type: ['string', 'null'] },
        measurements: { type: 'object' },
        price: {
          type: ['object', 'null'],
          properties: {
            amount: { type: 'string' },
            currency: { type: 'string' },
            priceRevision: { type: 'string' },
          },
        },
        idempotency_key: { type: 'string' },
      },
      required: ['attempt_id', 'state'],
    },
  },
  {
    name: 'link_operation_consumer',
    description: `Link a consumer to an operation without re-charging the provider (I4).

Credits: 1. HTTP: POST /api/v2/context/operations/:operationId/consumers`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation_id: { type: 'string' },
        consumer_kind: { type: 'string' },
        consumer_id: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: ['operation_id', 'consumer_kind', 'consumer_id'],
    },
  },
  {
    name: 'get_consumer_usage',
    description: `Customer-credit usage for everything one consumer consumed (I4).

Credits: 1. HTTP: GET /api/v2/context/usage/consumer`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        consumer_kind: { type: 'string' },
        consumer_id: { type: 'string' },
      },
      required: ['consumer_kind', 'consumer_id'],
    },
  },
  {
    name: 'get_provider_cost',
    description: `Provider spend for operations, measured on attempts — never derived from customer credits (I4).

Credits: 1. HTTP: POST /api/v2/context/usage/provider-cost`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        operation_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
        },
        idempotency_key: { type: 'string' },
      },
      required: ['operation_ids'],
    },
  },
  {
    name: 'formal_resolution_state',
    description: `Classify negative formal/search states without collapsing them (P4).

Credits: 1. HTTP: POST /api/v2/context/formal/resolution-state`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        missing_operands: { type: 'boolean' },
        undefined_definition: { type: 'boolean' },
        proof_search_failed: { type: 'boolean' },
        proof_timed_out: { type: 'boolean' },
        counterexample_found: { type: 'boolean' },
        checked_negation: { type: 'boolean' },
        idempotency_key: { type: 'string' },
      },
    },
  },
  {
    name: 'formal_revenue_bridge',
    description: `Discharge a revenue-bridge obligation over exact consistent scopes (P4).

Credits: 1. HTTP: POST /api/v2/context/formal/revenue-bridge`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        totalPoints: { type: 'string' },
        currency: { type: 'string' },
        period: { type: 'string' },
        entityId: { type: 'string' },
        scale: { type: 'string' },
        components: { type: 'array' },
        idempotency_key: { type: 'string' },
      },
      required: ['totalPoints', 'currency', 'period', 'entityId', 'scale', 'components'],
    },
  },
  {
    name: 'eval_catalog',
    description: `List the authorized evaluation suite catalog. Private gold remains denied to non-evaluator callers (private_gold_denied: true).

Credits: 1. HTTP: GET /api/v2/context/eval/catalog`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'certify_private_upload',
    description: `I1: Certify private evidence upload configuration for cutover/eval. Missing EVIDENCE_STORAGE_ROOT or EVIDENCE_BUCKET_NAME returns ok:false with not_run — never a pass.

Credits: 1. HTTP: GET /api/v2/context/private-upload/certify`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'certify_retrieve_flag',
    description: `C2: Report CONTEXT_GRAPH_RETRIEVE posture for cutover/eval. Default remains off; enabled:false is ok (default_off: true), not a misconfiguration.

Credits: 1. HTTP: GET /api/v2/context/retrieve/flag`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'proofs_applies',
    description: `Probe whether a proof receipt still binds under the current premise hash and approved toolchains (P3). Does not invent proved status.

Credits: 1. HTTP: GET /api/v2/context/proofs/applies`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string' },
        binding_hash: { type: 'string' },
        toolchain_version: { type: 'string' },
        current_binding_hash: { type: 'string' },
        approved_toolchains: { type: 'array', items: { type: 'string' } },
        checker_digest: { type: 'string' },
      },
      required: [
        'status',
        'binding_hash',
        'toolchain_version',
        'current_binding_hash',
      ],
    },
  },
  {
    name: 'publish_context_workflow',
    description: `Publish an immutable saved-context workflow revision. Returns the stored revision identity. Scope comes from the API key.

Credits: 1. HTTP: POST /api/v2/context/workflows`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        workflow: {
          type: 'object',
          description: 'SavedWorkflow payload (id, revision, kind, schemas, trigger, budget, reviewDestination).',
        },
        idempotency_key: { type: 'string' },
      },
      required: ['workflow'],
    },
  },
  {
    name: 'get_context_workflow',
    description: `Read one immutable saved-context workflow revision.

Credits: 1. HTTP: GET /api/v2/context/workflows/:revisionId`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        revision_id: { type: 'string', description: 'Workflow revision ID.' },
      },
      required: ['revision_id'],
    },
  },
  {
    name: 'run_saved_workflow',
    description: `Run a saved workflow in preview or propose mode. Preview keeps reviewItem and proposalId null and must not deliver notifications. Propose creates one typed review item. Idempotent on tenant/revision/mode/event_id/input.

Credits: 2. HTTP: POST /api/v2/context/workflows/:revisionId/runs`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        revision_id: { type: 'string' },
        mode: { type: 'string', enum: ['preview', 'propose'] },
        event_id: { type: 'string' },
        input: { type: 'object', description: 'Validated workflow input object.' },
        idempotency_key: { type: 'string' },
      },
      required: ['revision_id', 'mode', 'event_id', 'input'],
    },
  },
  {
    name: 'get_workflow_run',
    description: `Fetch an authorized workflow run artifact by run ID.

Credits: 1. HTTP: GET /api/v2/context/runs/:runId`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'get_evaluation',
    description: `Describe an authorized evaluation run. Private gold stays denied.

Credits: 1. HTTP: GET /api/v2/context/evaluations/:runId`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'compare_evaluations',
    description: `Compare two frozen evaluation runs via the E1 comparator (does not recompute grades).

Credits: 1. HTTP: POST /api/v2/context/evaluations/compare`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        baseline_run_id: { type: 'string' },
        candidate_run_id: { type: 'string' },
        idempotency_key: { type: 'string' },
      },
      required: ['baseline_run_id', 'candidate_run_id'],
    },
  },
  {
    name: 'get_evaluation_case',
    description: `Open one evaluation case artifact from a stored run without synthesizing a winner.

Credits: 1. HTTP: GET /api/v2/context/evaluations/:runId/cases/:caseId`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string' },
        case_id: { type: 'string' },
      },
      required: ['run_id', 'case_id'],
    },
  },
];

/** All tools advertised over ListTools (v1 + context v2). */
export const ALL_TOOLS: ToolDefinition[] = [...TOOLS, ...CONTEXT_TOOLS];

/** HTTP route each context tool maps to — used by tests and docs. */
export const CONTEXT_ENDPOINT_TOOLS: Record<string, string> = {
  'GET /api/v2/answers/:revisionId': 'get_answer',
  'GET /api/v2/evidence-packets/:id': 'get_evidence_packet',
  'POST /api/v2/context/query': 'query_context',
  'POST /api/v2/context/compare-assertions': 'compare_assertions',
  'POST /api/v2/context/fragments/resolve-uses': 'resolve_fragment_uses',
  'POST /api/v2/context/change-impact': 'get_change_impact',
  'POST /api/v2/context/evidence-packets': 'create_evidence_packet',
  'POST /api/v2/context/assess-support': 'assess_support',
  'POST /api/v2/context/assess-meaning': 'assess_meaning',
  'POST /api/v2/context/numbers/inventory': 'number_inventory',
  'POST /api/v2/context/contradictions': 'find_contradictions',
  'POST /api/v2/context/formal/eligibility': 'formal_eligibility',
  'POST /api/v2/context/formal/check': 'formal_check',
  'POST /api/v2/context/claim-relations': 'create_claim_relation',
  'GET /api/v2/context/claim-relations': 'list_claim_relations',
  'POST /api/v2/context/claim-relations/formalize': 'formalize_claim_relation',
  'POST /api/v2/context/metric-definitions': 'create_metric_definition',
  'GET /api/v2/context/metric-definitions': 'list_metric_definitions',
  'POST /api/v2/context/claim-structure/tier': 'claim_structure_tier',
  'POST /api/v2/context/claim-structure/resolve-definition':
    'claim_structure_resolve_definition',
  'POST /api/v2/context/research-runs': 'create_research_run',
  'GET /api/v2/context/research-runs': 'list_research_runs',
  'GET /api/v2/context/research-runs/:runId': 'get_research_run',
  'POST /api/v2/context/research-runs/:runId/checkpoints': 'checkpoint_research_run',
  'POST /api/v2/context/resolve-seeds': 'resolve_seeds',
  'POST /api/v2/context/expand-seeds': 'expand_seeds',
  'POST /api/v2/context/learning/judge': 'learning_judge',
  'POST /api/v2/context/learning/apply': 'learning_apply',
  'GET /api/v2/context/learning/placeholder': 'learning_placeholder',
  'POST /api/v2/context/format/certify': 'format_certify',
  'POST /api/v2/context/research-runs/:runId/reserve': 'reserve_research_budget',
  'POST /api/v2/context/operations/open-root': 'open_operation_root',
  'POST /api/v2/context/operations/reserve': 'reserve_operation',
  'GET /api/v2/context/operations/:operationId': 'get_operation',
  'GET /api/v2/context/operations/:operationId/availability':
    'get_operation_availability',
  'POST /api/v2/context/operations/:operationId/settle': 'settle_operation',
  'POST /api/v2/context/operations/:operationId/release': 'release_operation',
  'POST /api/v2/context/operations/:operationId/attempts': 'record_operation_attempt',
  'POST /api/v2/context/attempts/:attemptId/resolve': 'resolve_operation_attempt',
  'POST /api/v2/context/operations/:operationId/consumers': 'link_operation_consumer',
  'GET /api/v2/context/usage/consumer': 'get_consumer_usage',
  'POST /api/v2/context/usage/provider-cost': 'get_provider_cost',
  'POST /api/v2/context/formal/resolution-state': 'formal_resolution_state',
  'POST /api/v2/context/formal/revenue-bridge': 'formal_revenue_bridge',
  'GET /api/v2/context/eval/catalog': 'eval_catalog',
  'GET /api/v2/context/private-upload/certify': 'certify_private_upload',
  'GET /api/v2/context/retrieve/flag': 'certify_retrieve_flag',
  'GET /api/v2/context/proofs/applies': 'proofs_applies',
  'POST /api/v2/context/workflows': 'publish_context_workflow',
  'GET /api/v2/context/workflows/:revisionId': 'get_context_workflow',
  'POST /api/v2/context/workflows/:revisionId/runs': 'run_saved_workflow',
  'GET /api/v2/context/runs/:runId': 'get_workflow_run',
  'GET /api/v2/context/evaluations/:runId': 'get_evaluation',
  'POST /api/v2/context/evaluations/compare': 'compare_evaluations',
  'GET /api/v2/context/evaluations/:runId/cases/:caseId': 'get_evaluation_case',
};
