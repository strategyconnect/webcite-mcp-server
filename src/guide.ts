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
    'When metadata.retrieval_attempts is returned, preserve its search scope and evidence limitation. An unresolved supplied source or a bounded search with insufficient evidence does not prove that the data does not exist. Official-only restrictions apply to the final publisher after redirects. For numerical claims, match metric, observation period, currency and scale; publication year alone is not the observation period. Keep conflicting official publications distinct until their scope and precision are reconciled.',
    'Retain literal source context without treating proximity or relevance as proof of a metric, observation period or unit. HTML table units can retain standard ISO currency codes, literal currency symbols and explicit nonfinancial Unit: or Units: declarations. Unknown or ambiguous headers, units and periods stay unknown; do not infer a currency from an ambiguous symbol.',
    'Local and hosted MCP expose public API tools by default. Set `WEBCITE_MCP_PROFILE=core|docs|research|full` to change local discovery.',
    'Keep the public thread_id stable when continuing work with the same authenticated owner. Internal agent checkpoints bind the owner and thread together; sharing a thread_id across accounts does not share agent history. Older unscoped agent checkpoints are not resumed because their owner cannot be established. This does not change saved review IDs, claims or completed receipts. In-memory agent checkpoints do not survive a process restart; use saved job and review receipts to recover completed work.',
    'Standalone document searches and mappings require active, undeleted assets owned by the authenticated account. Asset IDs supplied by a model are checked before document retrieval. The ownership check also applies to cached document responses. A missing, inactive or foreign asset fails the ownership check; do not treat that failure as evidence that its document has no relevant content.',
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
        'Cancelling a verify_claim_stream MCP request forwards cancellation to its backend HTTP request. A stopped or failed stream requests cancellation of its unfinished response body. Partial events do not confirm a result without a done marker. Cancellation does not establish completion, rollback or a credit refund; inspect saved operation receipts before retrying uncertain paid work.',
        'Credits: typically 2–4 for verify_claim.',
      ].join('\n')
    );
  }

  if (workflow === 'document_quote') {
    return (
      header +
      [
        '## Workflow: document_quote',
        '1. Use the existing Webcite asset_id when available. For a Claude chat attachment or a file above the hosted tool limit, upload the original binary in Webcite Playground or through authenticated HTTP multipart/resumable upload within the parser\'s format and size limits. Use the returned asset_id. If the upload returns parse_job_id, wait for parsing; if it returns parse_required, call parse_endpoint. The remote MCP server cannot read a local path or automatically access a chat attachment. Use `upload_file` only for small files when the client directly supplies original bytes as base64; never reconstruct bytes from extracted text.',
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
        'Canonical binary upload reuses one structured OCR pass for raster content and preserves partial reads and errors. Native PDF coordinates preserve table year/value bindings; unreadable raster regions remain partial. PPTX native rendering retains the slide inventory, including unreadable slides. Native-only source reads do not establish complete raster coverage. OCR output is not certification and does not provide bounding boxes; inspect the original for exact visual placement and unresolved content.',
        'Extraction preserves retained source units\' partial, unreadable and error states and their OCR method across PDF and PowerPoint, including image-only slides. A mixed full-scope review includes narrative assertions and scope qualifications as well as numbers; numerical extraction alone does not complete it. Bind HTML table numbers to exact original cells and headers, including uniquely matched footer years. Do not flatten table cells into prose or guess ambiguous years; leave unresolved bindings as source gaps. Partial or unknown coverage remains explicit and does not certify the source.',
        'For a numbered heading with ordered actions, keep the complete literal action sequence and its exact numbered source passage. Identical action wording at separate numbered locations is distinct evidence; do not merge it by text alone.',
        'Split independently checkable facts using ordered literal source_fragments and the complete source passage. Keep shared conditions, qualifications and negation on each applicable claim. A composed source_quote can be anchored back to one uniquely matching literal source unit; the claim must still pass wording and scope checks. Ambiguous anchors or invented wording remain rejected.',
        'Structural topic headings and connectors between retained literal clauses do not become extra claims; omitted qualifications remain coverage gaps. Source evidence and successful judgments retain their server-verified identity across response projection and cache replay for the exact claim. A copied or changed receipt cannot supply that identity.',
        'Document-review result rows and claim-verification-result events may include source_assessment (version: 1). Its claim is the assessed assertion; the outer claim and claim_id retain the original report description and identity. judgment_claim preserves the exact stance identity with separately marked interpretation context, which adds no claims. basis is original_claim or source_table; optional source_asset_id and source_quote_hash reference retained source evidence; a hash alone does not establish claim truth. Missing metadata on older saved rows is unknown, never proof of a factual projection or a reason to rerun settled work. A policy-only revision reuses the saved assessment identity; changing its predicate requires fresh analysis.',
        'Literal Unicode table labels remain anchored to the original source cells and headers; recognizing a label does not translate it or supply missing metric, year, value or unit proof. Numeric-only labels and unresolved bindings remain unknown. A short source label alone does not establish that external retrieval found readable evidence for its assessed assertion.',
        'Compact saved-review pages retain optional source_assessment_summary separately from the original report claim. Normal assessed assertions and their basis remain available; claim_truncated and judgment_claim_truncated explicitly mark shortened text. A summary is not the exact saved stance identity and must not supply a new judgment or cache attestation. The full source_assessment remains saved; absent legacy metadata stays unknown.',
        'Input source coverage describes the uploaded report, separately from publisher reader coverage on its citations. A verified claim or complete input review does not establish a complete publisher read. Saved review text and compact citation_reader_coverage qualifiers preserve explicit partial reads; missing, legacy or unrecognized publisher coverage stays unknown. citation_index is the one-based position in the saved citation list. Limitation details are bounded, with omitted counts and text truncation marked; full saved evidence remains available. These qualifiers do not change verdicts, confidence or source_assessment identity. Verification stream cancellation still leaves incomplete results and credit outcomes unconfirmed; inspect retained receipts before retrying.',
        'When parsing omits list numbers, literal inline heading boundaries still distinguish headings from their factual body. Structural choice headings are not facts; procedural requirements, action ordering and shared conditions remain part of the review.',
        'Extraction retries identify the same grounded assertion when its literal source quote changes from heading plus body to body alone, preserving the first stored claim instead of appending a second claim to check. Separate source occurrences, assets and page identities remain distinct. Verification runs at most three funded claim tasks at once, bounded by available credits and the remaining consecutive-failure budget; completed results remain saved if another task fails.',
        '1. If the file is already in Webcite, use its asset_id. Hosted MCP uses stateless authenticated POST requests; missing or obsolete mcp-session-id headers do not block tools. Backend job_id and review_id preserve workflow progress across reconnects. No balance preflight is required: use inline credit_usage from normal responses, and get_credit_balance only for an explicit balance question or unresolved credit refusal. Missing receipt fields remain unknown. For a Claude chat attachment or a file above the hosted tool limit, upload the original binary in Webcite Playground or through authenticated HTTP multipart/resumable upload within the parser\'s format and size limits. Use the returned asset_id; the remote MCP server cannot read a local path or automatically access the attachment. If completion returns parse_job_id, wait for parsing; if it returns parse_required, call parse_endpoint. Use `upload_file` only when the client directly supplies original bytes for a small file, never reconstructed document text. Save the asset_id and source_version_id from upload. For a full review, proceed directly to review_document: the server reads the stored representation and waits for parsing when needed. Do not pay for extract_document merely as a review prerequisite. Use extract_document only when the user also needs extracted content or a specific source-read anomaly requires inspection; its per-call charge can apply even when stored OCR is reused. Never call a partial read complete.',
        'Optional source inspection: some connectors show only MCP text and omit structuredContent. Extraction text is bounded at 16,000 characters and lists links beyond that limit. An asset_id is not a source_version_id. Use get_latest_representation and read_source_unit for complete stored units when needed; extract_pages costs 1 credit per call. Repeating `extract_document` or `extract_figures` incurs the stated per-call credits. These are anomaly/content inspection tools, not mandatory review preflights.',
        '2. Call `review_document` with a clear prompt, asset_ids and a stable thread_id. Pass official PDF URLs supplied by the user or found with `search_sources` in source_urls, with the required source filters. Save its job_id. There is no fixed claim count. The server checks claims in the background and saves each completed result.',
        '3. Inspect the saved claim list and source coverage for every material figure, period, comparison and relationship in all readable pages/sheets. Do not infer full source coverage when coverage_complete or source_read_complete is missing or false. `extract_figures` can add recognized financial metrics, but zero results does not mean there are no numbers. Check omitted claims individually with `verify_claim` using distinct stable idempotency keys. Report an official PDF read failure instead of substituting secondary sources. Evidence must address the same metric, period, unit and geography.',
        '4. Poll `get_document_review_job` with job_id at zero credits, waiting about 30 seconds between checks. A review_id can appear before work finishes. Unless the user requests interim results, wait for a terminal job status before reading result pages, then call `get_document_review` to read saved checked and pending claims, source coverage, uncovered spans, rejected candidates and explicit nonclaim dispositions. Copy the returned next_page_input exactly for each next call, including exhausted-stream offsets, until it is null. Do not reset exhausted offsets to zero. The individual next_offset, next_gap_offset, next_rejected_offset and next_disposition_offset remain available. For a source-attested heading, table title or navigation gap, read its exact text with `get_review_source_span`; record a nonclaim with `record_review_nonclaim` only after assessing the entire passage and giving a rationale that it contains no factual assertion. Structural role alone never closes a gap. Leave any assertion-bearing passage uncovered. For the final report, use the saved claim outcomes, verdict summaries and citation URLs on these pages. A compact view can omit detailed evidence; omission from the view does not mean it was never saved. Compact fields omitted are unknown, not absent. Report known material_claims (physical rows excluding duplicates), total_claims (all physical rows), duplicate_claims and non_factual_claims separately. Material counts can include non-factual rows and do not imply all rows are factual assertions. A duplicate display alias can have a different id; original_claim_id is its stored original identity and duplicate_of_id identifies the canonical assertion. Display aliases do not change stored IDs, citations or paid operations. Report pending, failed, rejected and uncovered counts separately. pending_claims is unfinished work and includes failed_claims; failed is a subset, never add it again to a total. Counts do not establish attempt history; do not call other unfinished rows never attempted without recorded attempt data. A provider access error does not rule out incomplete extraction or source coverage. Null or missing counts are unknown, never zero. Do not group unknown rejected or uncovered counts with known zero pending or failed counts. A completed job means processing finished; it does not prove complete source coverage. For a queued or running review, obey poll_after_ms with waits of at most 30 seconds. Never multiply remaining claims by per-claim latency into a long blind sleep. Stop polling immediately on a terminal status and report failed or interrupted work. Do not infer source weighting, prioritization or analysis absence from omissions. Fetch verbose evidence details only when that specific audit requires them, not routinely. A null summary is unknown and a summary_truncated flag means the complete saved summary was not displayed. Use source titles as link labels and complete returned URLs as link targets; never replace URL paths with ellipses. Extra citation/source-unit endpoints are needed only for requested evidence details or a specific anomaly. Inspect those citations with `get_source_preview`; `verify_batch` checks quote binding, not claim truth.',
        '5. If credits run out or the job fails, give the user the saved checked claims, unchecked claims, and uncovered source passages now. After credits are available or the failure is diagnosed, call `review_document` with the same prompt, thread_id, assets, source URLs, filters and billing flags plus retry_failed: true and the returned retry_idempotency_key. Keep the original thread and file. The failed job receipt is retained; completed claims replay without a new charge. A failed or interrupted execution releases only its own inner review lease for prompt explicit retry, preserves saved outputs, and leaves foreign, newer or terminal leases unchanged. Completed extraction responses are also reused when the source, extraction request and model settings are unchanged. A failed or incomplete extraction response is not reused as a successful result. Do not repeat separate `verify_claim` calls that already completed.',
        '6. To apply the current evidence policy to a settled claim, read its original_result_hash and call `revise_document_claim_analysis` after the review stops. This reuses saved snippets without new research, model calls or credits. The original result and receipt remain in revision history. A missing scope assessment stays inconclusive; this operation does not promise fresh semantic analysis.',
        'Credits: optional extraction costs 1; document review charges per claim. Upload responses retain available credit_usage in both text and structured output; a missing upload receipt means unknown charge, never zero. credit_usage describes this HTTP request; review_usage describes accumulated operation-ledger charges, not polling costs. Balance and saved-review readback cost 0.',
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
        'For a selected original spreadsheet cell, retain its sheet and address, literal display and number format, and nearby labels. A source-only cell reading is not an approved Figure or a recalculated formula result.',
        'Retain formula presence and available formula text or metadata even for self-closing formula nodes or shared-formula followers with no local text. An absent or whitespace-only cached value is absent; a literal cached zero is present. A cached formula value marked present_unverified remains unresolved. Spreadsheet parsing and native source construction do not verify or recalculate formulas and are not calculation authority.',
        'Use scope.period only for the exact source-supported period. Preserve an analyst literal opaque or partial label, such as an eight-month period, without reconstructing annual boundaries. effectiveTime: null means the effective interval is unknown; it does not establish a full year. Period, actual versus forecast basis and comparable metric meaning still require original source evidence before review.',
        'In the dedicated DD host workflow, signed selected model and Figure inputs retain evidence.entityId, rawLexeme, displayLexeme, numberFormat, scopeEvidence and effectiveTime from the selected occurrence and reviewed interpretation. The input manifest binds this evidence; the existing assertion identity is unchanged. Preserve the literal raw reading separately from valueDecimal and carry unknown intervals as null. These inputs are not public MCP tools and do not approve a report Figure or verify a formula cache.',
        'If a selected input contains semanticScope.measurement or signed evidence.measurement, preserve each optional fact and its exact source clue: retention horizonMonths, cohort and ratioMeaning; workforce basis and geography; ACV basis, cohort and contractId; and costConvention. Supplemental facts require proof from the retained selected source; they may fill missing facts without changing assertion identity, review identity or semantic role. Conflicting explicit and supplemental facts must fail visibly, never overwrite the reviewed meaning. Omission means unknown and preserves the existing reading. A cost formulaWitness establishes only the source expense convention from its retained P&L labels and formulas, never the correctness of cached results. These source facts require no new DD screen, review workflow or generation gate; support for the optional fields alone does not prove automatic extraction supplies them.',
        'For a validated registered NRR conversion, retain the signed source value and unit separately from the DD target value and unit. Source ratio 1.18 displayed 118% maps to target 118 percent without rewriting source identity. A source multiple requires explicit NRR ratio meaning; an unrelated valuation multiple is not convertible. Existing answers and citations must use the target unit for presentation and the exact retained source lexeme for citation validation. Unknown retention horizon or cohort remains unknown after conversion.',
        'Compare only the same metric meaning, entity, measurement scope, period, interval, actual or forecast basis, role, unit and currency. A shared numeric unit or generic definition does not make Net New ARR and Ending ARR, FTE and total headcount, contract and blended ACV, or Gross Margin and retention comparable. Missing retention horizon, cohort, workforce basis, contract scope or cost convention needs evidence; do not infer it from a default or a signed number. Ratio, percent and multiple representations need an explicit metric-specific conversion contract; do not coerce unrelated multiples or negate expenses automatically.',
        'For automatic extraction in an existing DD analysis, consume only results bound to the current selected source, receipt, source units, engine and metric configuration. This private backend handoff is separate from analyst-approved mappings and adds no public MCP tool or DD review prerequisite. Preserve source raw and display readings, source-supported canonical meanings, exact clues, extraction method, uncertainty, physical and semantic coverage, and operation usage. A present formula cache may be an unverified source reading requiring review; an absent cache is unknown, never zero. Extraction confidence does not verify arithmetic or establish analyst approval.',
        'Fresh paid automatic extraction in the private DD handoff bills the authenticated API service principal authorized by the exact active product grant and signed Analyze request. Source tenant, actor and custody remain isolated from the payer. The existing document tariff and operation key apply once per document/model/prompt/media identity, not per page or batch; the immutable authorization and credit root bind that request, with unknown token and time budgets left unset. Settlement and refunds use the actual subscription that funded the operation. Cached attributed dispatch revalidates the active grant, principal and original payer without a second hold or provider call. Completed retained-ledger reads remain read-only and do not require a new billing hold. Failed authorization or insufficient credit must remain an explicit failure, never an empty successful extraction.',
        'Automatic model reads bind the actual provider endpoint to cache and operation identity. Gemini global routing uses aiplatform.googleapis.com; explicit regional routing keeps its regional endpoint. A corrected endpoint is a distinct provider request and must not overwrite a retained failed or unknown outcome. Preserve completed extraction ledgers and original source receipts. Provider failures retain only safe status or failure codes alongside their original operation; missing response, token or cost metadata stays unknown. Reading a failed cached outcome must not silently redispatch it or present extraction as successful. Structured source reads use supported model-specific thinking and output settings that allow a complete response. MAX_TOKENS or other incomplete output remains a retained failure, never salvaged into successful extraction. Spreadsheet label mapping returns exact configured matches only; unmatched original readings retain their source values and uncertainty in the ledger.',
        'Automatic spreadsheet readings retain source-supported comparison scope: explicit Entity, Company or Issuer labels can identify the subject; explicit total, subtotal, standalone or component wording can identify its semantic role. Contradictory or unmarked scope stays unknown and never implies analyst approval. Exact request-configured metric aliases carry their configured unit when the native reader has no competing unit. Calendar quarters retain their bounded calendar interval; fiscal quarters retain fiscal identity without inventing an interval from an unspecified fiscal calendar. Consumers must preserve scope differences and unknowns when comparing readings.',
        'Current automatic source extraction uses selected-source-automatic/2. Numeric values must not replace source row labels or period headers. Recognized whole financial year or quarter labels preserve printed A/ACT actual and E/EST/F/FCST/P/PLAN/BUDGET forecast qualifiers with their exact source clue. Bare years and suffixes in non-period labels do not establish basis; conflicting qualifiers remain unknown, and fiscal labels do not establish a calendar interval. Exact configured metric names are recognized without broadening them into component or derived measures; an explicitly empty alias list still disables deterministic name and alias matching. The engine revision participates in immutable extraction and model-cache identity, while existing native source receipts and representations are reused. A retained selected-source-automatic/1 result is readable only through an explicit automaticExtractionRead.manifestHash matching that immutable historical result; current reads and fresh execution never silently substitute it. Historical results retain their original engine, findings and uncertainty, without being relabelled as corrected output.',
        'Existing authenticated product context queries can include automaticExtractionContext with the exact declarative metrics, metricConfigHash and optional companyHint used by Analyze. The query signature binds that configuration. Current selected-source receipts select only the corresponding immutable retained extraction ledger; a context read never invokes a provider, reconstructs extraction or chooses an arbitrary latest configuration. The additive automaticSourceLedger returns full analyze envelopes with source, configuration, engine, manifest, readings, observations, coverage and original operation attribution. Missing exact ledgers produce source-specific unavailable gaps; omitted configuration is explicitly not_requested. Corrupted ledger or changed source custody fails visibly. Returned manifests and gaps bind the context query identity alongside existing source references and memory notes. Graph-operator refusal is independent of ledger availability: retained source readings may still be retrieved with their original uncertainty, never relabelled as resolved graph assertions.',
        'Comparison dimensions apply across configured metrics, including custom metrics. Preserve independently evidenced axis and member meanings for population, product, channel, geography, denominator, contract or other source dimensions, alongside entity, period, interval, basis, role, unit and currency. Keep the exact supporting caption or span separate from the qualifier value, so surrounding metric values do not become scope identity. Different axis order does not imply different scope; contradictory or unsupported dimensions remain uncertain. Special retention, workforce and ACV fields are compatibility facts, not a complete list of possible qualifiers. Do not treat arbitrary wording as an alias, discard dimensions or infer a company total from a scoped row.',
        'In a host product that offers contextual numeric review, a human reviewer may explicitly mark a selected year label, date label, ordered year-range label, identifier or rejected prose cell as source context after checking the original. Date and year-range labels must match the whole retained spreadsheet cell under its Date or Year context; a lexical fragment or inferred period is not enough. Spreadsheet prose must match the whole retained text cell at its exact sheet and address; PDF prose keeps its source span. Rejected prose may retain its original assumption-basis annotation as context only; it must have no metric, entity, unit, currency, scale, definition or semantic scope and cannot be a projected numeric assertion. A year, date or year-range label or identifier with any basis annotation remains ineligible. Signed source coverage must count contextual decisions separately from reviewed numeric assertions. This is a host decision in the dedicated DD workflow, not a public MCP tool or an approved Figure. Other unresolved values remain unresolved; unmarked source reads do not establish actual versus forecast meaning.',
        'A host may submit up to 100 selected numeric readings for one human batch decision. A spreadsheet candidate.raw can be printed display text, such as 30.2%, while sourceRawLexeme is the sealed stored cell value, such as 0.3015873015873016. The proposed expectedRawLexeme must use that stored value, never the rounded display; review the exact original cell and receipt before filing. Each reading still needs its exact original source unit (spreadsheet cell or native PDF span) and complete period, unit, basis and definition evidence; the batch publishes one selected review receipt only after every item passes. One rejected or stale item leaves the source selection unchanged. Unknown currency or meaning stays unresolved, and a reviewed reading does not by itself approve a report Figure. This host workflow is not a public MCP tool.',
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
