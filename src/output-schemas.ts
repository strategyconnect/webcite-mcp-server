/**
 * MCP outputSchema for each default tool. Every schema is anyOf [result, error]: the result
 * branch requires and types only what the handler validates (or the backend always sets), so
 * clients that validate structuredContent never reject a real response; other documented
 * fields carry a description without a type claim. Error results (isError) carry the
 * ToolFailure payload, which the error branch describes. webcite_guide has no outputSchema:
 * it returns Markdown text only, with no structuredContent.
 */

type Schema = Record<string, unknown>;

const str = (description: string): Schema => ({ type: 'string', description });
const int = (description: string): Schema => ({ type: 'integer', description });
const intOrNull = (description: string): Schema => ({ type: ['integer', 'null'], description });
const arr = (description: string, items?: Schema): Schema => ({ type: 'array', description, ...(items ? { items } : {}) });
const obj = (description: string, properties: Record<string, Schema> = {}, required: string[] = []): Schema =>
  ({ type: 'object', description, properties, ...(required.length ? { required } : {}) });
const nullableArr = (description: string, items?: Schema): Schema => ({ ...arr(description, items), type: ['array', 'null'] });
/** Documented field whose type the server does not check. */
const doc = (description: string): Schema => ({ description });

const CREDIT_USAGE = obj('Credit receipt for this HTTP request only, when the API returned one; not accumulated review usage.', {
  credits_used: { type: ['number', 'null'], description: 'Credits charged by this request; null when unknown.' },
  credits_remaining: { type: ['number', 'null'], description: 'Account credits remaining after this request; null when unknown.' },
  monthly_allocation: { type: ['number', 'null'] },
  overage_enabled: { type: ['boolean', 'null'] },
  operation_id: { type: ['string', 'null'], description: 'Saved paid operation ID, when one exists.' },
}, ['credits_used', 'credits_remaining']);

export const TOOL_ERROR_OUTPUT: Schema = obj('Error result (isError true). Nothing in it is a success value.', {
  code: { type: 'string', enum: ['invalid_argument', 'invalid_api_output', 'api_error', 'not_found', 'integrity_error',
    'unauthorized', 'credit_exhausted', 'partial_result'],
  description: 'invalid_argument: the server refused the input before calling the API. not_found (HTTP 404): the ID does not exist for this API key or is not owned, or the IDs do not belong together (for example a source unit outside that representation). unauthorized (HTTP 401 or 403): missing or invalid key, or access to that source or asset denied. credit_exhausted: stop chargeable calls. partial_result: only some stream events completed. invalid_api_output or integrity_error: the API response failed a check; do not repeat a paid call. api_error: any other refusal, including HTTP 400, 409 and 413 (for example a span that is not a saved gap); message gives the reason.' },
  message: str('Human-readable reason.'),
  details: { type: 'object', description: 'Optional context such as request_id, HTTP status, partial events or the job ID.' },
  credit_usage: { type: 'object', description: 'Credit receipt, when the failed request was metered.' },
  actionable: str('What to do next.'),
}, ['code', 'message']);

const output = (result: Schema): Schema => ({ type: 'object', anyOf: [result, TOOL_ERROR_OUTPUT] });

const CITATION = obj('A web source.', {
  url: str('Complete source URL.'),
  title: { type: ['string', 'null'] },
  snippet: { type: ['string', 'null'], description: 'Retrieved passage.' },
  stance: doc('supports, contradicts, partially_supports, neutral, irrelevant or inconclusive, when stance was analysed.'),
  stance_explanation: { type: ['string', 'null'] },
  credibility_score: { type: ['number', 'null'] },
  stance_confidence: { type: ['number', 'null'] },
  evidence: { type: ['object', 'null'], description: 'Evidence receipt for the snippet.' },
}, ['url']);

const VERDICT = { type: ['object', 'null'], description: 'Overall verdict; null or absent when no verdict was produced.', properties: {
  result: { type: 'string', enum: ['supported', 'partially_supported', 'contradicted', 'mixed', 'unverifiable'] },
  summary: { type: 'string' },
  confidence: { type: ['number', 'null'], description: 'Heuristic confidence; null when unavailable.' },
  key_findings: { type: ['array', 'null'], items: { type: 'object' } },
  corrections: { type: ['array', 'null'], items: { type: 'object' } },
  unverified_claims: { type: ['array', 'null'], items: { type: 'string' } },
}, required: ['result', 'summary'] };

const VERIFICATION_PROPERTIES: Record<string, Schema> = {
  claim_groups: arr('One group per checked (sub)claim, each with its citations and optional verdict.', obj('Claim group.', {
    claim: str('The (sub)claim text.'), citations: arr('Sources for this claim.', CITATION), verdict: VERDICT,
  }, ['claim', 'citations'])),
  citations: arr('Sources across the whole claim.', CITATION),
  verdict: VERDICT,
  thread_id: doc('Thread the verification was saved under; pass to list_citations to filter.'),
  citation_id: doc('Saved verification ID; get_citation reads it later at its stated cost.'),
  credit_usage: CREDIT_USAGE,
};
const VERIFICATION = { type: 'object', properties: VERIFICATION_PROPERTIES,
  anyOf: [{ required: ['claim_groups'], properties: { claim_groups: { type: 'array' } } },
    { required: ['citations'], properties: { citations: { type: 'array' } } }] };

const REVIEW_JOB = obj('Durable document review job.', {
  job_id: { type: 'string', pattern: '^(?:[a-f0-9]{64}|[a-f0-9-]{36})$', description: 'Job ID for get_document_review_job.' },
  status: { type: 'string', enum: ['queued', 'running', 'waiting_review', 'waiting_parse', 'complete', 'partial_coverage', 'credits_exhausted', 'failed', 'interrupted'],
    description: 'queued, running, waiting_review and waiting_parse are nonterminal; the rest are terminal. failed, interrupted and credits_exhausted are returned with isError true.' },
  review_id: str('Saved review ID for get_document_review; always present once complete or partial_coverage.'),
  poll_after_ms: { type: 'integer', minimum: 0, maximum: 30000, description: 'Wait before the next status check: 1,000 to 30,000 while nonterminal, 0 when terminal.' },
  progress: obj('Progress counts; a null or missing count is unknown, not zero.', {
    completed_claims: intOrNull('Physical rows finished.'), total_claims: intOrNull('All physical rows.'),
    material_claims: intOrNull('Physical rows excluding duplicates.'), duplicate_claims: intOrNull('Duplicate display aliases.'),
    pending_claims: intOrNull('Unfinished rows, including failed.'), failed_claims: intOrNull('Failed rows; a subset of pending.'),
    rejected_claim_count: intOrNull('Rejected claim candidates.'), uncovered_source_span_count: intOrNull('Source passages no claim covers.'),
    extraction_complete: { type: ['boolean', 'null'] }, source_read_complete: { type: ['boolean', 'null'] },
    coverage_complete: { type: ['boolean', 'null'], description: 'true only when every source passage is covered.' },
  }),
  max_account_credits: { type: 'integer', minimum: 1, maximum: 2147483647, description: 'Account-credit cap confirmed for this execution.' },
  retry_idempotency_key: str('Key for review_document with retry_failed true, on failed, interrupted or credits_exhausted jobs.'),
  error: doc('Failure reason, when the job failed.'),
  credit_usage: CREDIT_USAGE,
}, ['job_id', 'status', 'poll_after_ms']);

const FIGURES = arr('Extracted figures: metric, value, unit, optional entity and period, and provenance (asset, page or sheet and cell, read method).');
const ANALYSIS = {
  conflicts: arr('Figures that disagree across sources, with each value and a reconciliation question.'),
  recomputations: arr('Recomputed metrics with stated and computed values and state.'),
  review: obj('Whether a person should review the result, and why.', {
    needs_review: { type: 'boolean' }, reasons: arr('Review reasons.'),
  }, ['needs_review', 'reasons']),
};

const SPAN = {
  asset_id: str('Asset ID of the reviewed source.'),
  start: { type: 'integer', minimum: 0, description: 'Start character offset (0-based) into the source text the review stored.' },
  end: { type: 'integer', minimum: 1, description: 'End character offset, exclusive.' },
  source_quote: { type: 'string', maxLength: 16000, description: 'Exact source text from start to end; its length equals end minus start.' },
};

const UNIT_REF = obj('Source unit reference; read its text with read_source_unit.', {
  sourceUnitId: str('Source unit ID.'),
  locator: { type: 'object', description: 'Where the unit sits, by kind: page (1-based page), slide, sheet (sheet, range), text (blockId, start, end), media, message or record.' },
  state: str('complete, partial, unreadable, unsupported, encrypted, corrupt or error.'),
}, ['sourceUnitId', 'locator', 'state']);
const REPRESENTATION = obj('One representation of a retained source version.', {
  sourceVersionId: str('Source version ID (the parent of the representation).'),
  representationId: str('Representation ID; pass with a sourceUnitId to read_source_unit or verify_numeric_claim.'),
  parserVersion: str('Reader that produced it, for example native-text/1.'),
  units: arr('Units sorted by unit key as text (page:10 sorts before page:2), without content; at most 2,000.', UNIT_REF),
}, ['sourceVersionId', 'representationId', 'parserVersion', 'units']);

const RESULTS: Record<string, Schema> = {
  get_credit_balance: obj('Account credit balance.', {
    credits: obj('Credit totals for the current billing period.', {
      remaining: { type: 'number' }, used: { type: 'number' }, total: { type: 'number' },
    }, ['remaining', 'used', 'total']),
    usage_breakdown: { type: 'object', description: 'Credits used per feature, when available.' },
    allow_overage: { type: 'boolean', description: 'Whether overage billing is enabled; absent when unknown.' },
    billing_period_end: str('End of the billing period (ISO 8601).'),
  }, ['credits']),

  verify_claim: VERIFICATION,
  verify_claim_stream: { ...VERIFICATION, properties: { ...VERIFICATION_PROPERTIES,
    stream_events: arr('Every stream event received, in order, each { event, data }.', { type: 'object' }),
    stream_usage: { type: 'object', description: 'Final usage event, when the stream sent one.' },
  } },

  search_sources: { type: 'object', properties: {
    citations: doc('Sources found (title, url, snippet). Search adds no stance or verdict.'),
    claim_groups: doc('Sources grouped by query interpretation, each with citations.'),
    metadata: doc('Retrieval scope, including any filters applied.'),
    credit_usage: CREDIT_USAGE,
  }, anyOf: [{ required: ['citations'], properties: { citations: { type: 'array' } } },
    { required: ['claim_groups'], properties: { claim_groups: { type: 'array' } } }] },

  list_citations: obj('One page of saved verifications, newest first as the API orders them.', {
    data: arr('Saved verification records, each with id, thread_id, prompt and created_at.'),
    pagination: obj('Page position.', {
      page: int('1-based page number.'), totalPages: int('Number of pages.'), total: int('Number of records.'),
      limit: doc('Records per page.'),
    }, ['page', 'totalPages', 'total']),
  }, ['data', 'pagination']),

  get_citation: obj('One saved verification.', {
    data: obj('The stored record: id, thread_id, prompt, created_at and the raw stored citation and metadata.'),
    citations: arr('Sources normalized from the stored record.', CITATION),
    final_response: { ...VERIFICATION, description: 'The stored verification with its verdict; absent for legacy records that saved sources only.' },
  }, ['data', 'citations']),

  upload_file: obj('Stored upload.', {
    asset_id: str('Asset ID for extract_document, review_document, get_source_preview and the other asset tools.'),
    source_version_id: str('Retained source version ID for get_latest_representation and read_source_unit, when the upload was retained as a source.'),
    asset_url: str('Storage reference for the asset.'),
    filename: str('Stored file name.'),
    size: { type: 'integer', minimum: 0, description: 'Size in bytes.' },
    credit_usage: CREDIT_USAGE,
  }, ['asset_id', 'filename', 'size']),

  upload_url: obj('Stored upload fetched from the URL.', {
    asset_id: str('Asset ID for extract_document, review_document and the other asset tools.'),
    source_version_id: str('Retained source version ID for get_latest_representation and read_source_unit.'),
    asset_url: str('Storage reference for the asset.'),
    filename: str('Stored file name.'),
    size: { type: 'integer', minimum: 1, maximum: 104857600, description: 'Size in bytes, at most 100 MB.' },
    credit_usage: CREDIT_USAGE,
  }, ['asset_id', 'source_version_id', 'asset_url', 'filename', 'size']),

  get_source_preview: obj('Source preview with the quote bound back to the source.', {
    deep_link: str('Link that opens the source at the passage (URL text fragment or page anchor).'),
    binding: obj('Whether the quote was found in the source.', {
      grounded: { type: 'boolean', description: 'true when the quote was found.' },
      method: { type: 'string', description: 'exact, normalized or unbound.' },
      matched_quote: doc('Source text that matched.'),
    }, ['grounded', 'method']),
    kind: doc('web, page or grid.'), url: doc('Web source URL.'), asset_id: doc('Uploaded asset ID.'),
    page: doc('1-based page or sheet index.'), text: doc('Full preview text.'), quote: doc('Quote that was bound.'),
  }, ['deep_link', 'binding']),

  verify_batch: obj('One result per item, in input order.', {
    results: arr('Batch results.', obj('Result for one item.', {
      id: doc('Caller id echoed back.'), quote: str('The checked quote.'),
      binding: doc('Where the quote matched: grounded, method, score, matched_text.'),
      verification: doc('Grounding layer, band, confidence and review reason.'),
      feedback_token: doc('Token for verify_feedback.'),
      error: doc('Per-item failure; binding and verification are then absent.'),
    }, ['quote'])),
    credit_usage: CREDIT_USAGE,
  }, ['results']),

  verify_feedback: obj('Feedback receipt.', {
    recorded: { type: 'boolean', enum: [true] },
    verdict: { type: 'string', enum: ['correct', 'incorrect', 'unsure'] },
  }, ['recorded', 'verdict']),

  analyze_conflicts: obj('Numeric analysis of the supplied figures.', ANALYSIS, ['conflicts', 'recomputations', 'review']),
  analyze_document: obj('Numeric analysis of the uploaded document.', {
    figures: FIGURES, ...ANALYSIS,
    unavailableValues: doc('Cells whose values could not be read exactly, with sheet, cell, reason and raw lexeme.'),
    category: doc('Document category, when classified.'), covers: doc('Document types the file holds.'),
  }, ['figures', 'conflicts', 'recomputations', 'review']),

  classify_document: obj('Document classification.', {
    category: str('Coarse category.'), covers: arr('Fine document types the file holds.'),
    confidence: doc('Confidence; 0 or null when unavailable.'), basis: doc('How the category was assigned.'),
    sufficiency: doc('Whether the classification is usable, with status and reason.'),
  }, ['category', 'covers']),

  document_gaps: obj('Checklist for the category.', {
    items: arr('Checklist items, each { name, present }.'),
  }, ['items']),

  extract_document: obj('Extracted document. state error or unsupported is returned with isError true.', {
    format: str('Detected format, or image for a visual rendition.'),
    markdown: str('Whole-document Markdown (the text display may be truncated; this field is not).'),
    units: doc('Array of units, per page or sheet: kind, 1-based index, text and provenance (not part of a visual rendition).'),
    state: doc('complete, partial, error or unsupported.'), complete: doc('true when every unit was read.'),
    reason: doc('Why the read is partial or failed.'), lost: doc('Pages or sheets that could not be read.'),
    source_version_id: doc('Visual rendition only: source version the rendition belongs to.'),
    representation_id: doc('Visual rendition only: representation ID for read_source_unit.'),
    source_units: doc('Visual rendition only: unit IDs with page locators for read_source_unit.'),
    credit_usage: CREDIT_USAGE,
  }, ['format', 'markdown']),

  extract_figures: obj('Recognized financial figures.', {
    figures: FIGURES,
    state: doc('complete, partial or error.'), coverage: doc('Present when only part of the document was read.'),
    credit_usage: CREDIT_USAGE,
  }, ['figures']),

  accuracy_report: obj('Gold-set accuracy of the numeric engine.', {
    pass: { type: 'boolean', description: 'Whether the corpus meets its thresholds.' },
    totals: doc('Deals, figures, conflict detection rate and precision, and recompute correctness.'),
    deals: doc('Per-case results.'),
  }, ['pass', 'totals']),

  get_document_review_job: REVIEW_JOB,
  review_document: REVIEW_JOB,

  get_document_review: obj('One page of a saved review. Claims, uncovered passages, rejected candidates and nonclaim dispositions page independently. When the page exceeds the response limit, a compact page is returned (claims trimmed, evidence_details_omitted true); when even one row per list is too large, isError is true with code response_limit_exceeded.', {
    review_id: str('Saved review ID.'),
    status: str('Review status, for example running, complete, credits_exhausted, failed or interrupted.'),
    total_claims: int('All physical rows.'), completed_claims: int('Rows finished.'),
    pending_claims: int('Unfinished rows, including failed.'),
    material_claims: intOrNull('Physical rows excluding duplicates; null when unknown.'),
    duplicate_claims: intOrNull('Duplicate display aliases; null when unknown.'),
    non_factual_claims: intOrNull('Rows classified non-factual.'),
    claims: arr('Claims on this page.', obj('Saved claim: verdict (result), result_state, summary, citations, page_number, original_result_hash and duplicate links.', {
      id: str('Saved claim ID for revise_document_claim_analysis.'), claim: str('Claim text.'),
    }, ['id', 'claim'])),
    uncovered_source_spans: nullableArr('Source passages no claim covers; read one with get_review_source_span.', obj('Uncovered passage.', {
      asset_id: str('Asset ID.'), start: int('Start character offset.'), end: int('End character offset, exclusive.'),
      preview: str('Passage preview.'),
    }, ['asset_id', 'start', 'end', 'preview'])),
    rejected_claims: nullableArr('Rejected claim candidates.', obj('Rejected candidate.', { claim: str('Candidate text.'), reason: str('Why it was rejected.') }, ['claim', 'reason'])),
    nonclaim_dispositions: nullableArr('Recorded nonclaim dispositions.', { type: 'object' }),
    next_offset: intOrNull('Claim offset for the next page; absent or null when no further claims.'),
    next_gap_offset: intOrNull('Next uncovered-passage offset.'), next_rejected_offset: intOrNull('Next rejected-candidate offset.'),
    next_disposition_offset: intOrNull('Next disposition offset.'),
    next_page_input: { type: ['object', 'null'], description: 'Exact get_document_review arguments for the next page; null when no stream has a cursor.' },
    resume_input: { type: 'object', description: 'Saved review_document input to resume this review.' },
    coverage_complete: doc('true only when every source passage is covered.'),
    code: doc('response_limit_exceeded when even one row is too large for the response (isError true).'),
    credit_usage: CREDIT_USAGE,
  }, ['review_id', 'status', 'total_claims', 'completed_claims', 'pending_claims']),

  get_review_source_span: obj('Exact text of one saved uncovered passage.', {
    ...SPAN,
    role: { type: 'string', enum: ['heading', 'table_title', 'navigation', 'unknown'], description: 'Structural role; unknown proves nothing.' },
    block_id: doc('Source block holding the passage; a string unless role is unknown.'),
    role_basis: doc('Markup or layout basis for the role; a string unless role is unknown.'),
  }, ['asset_id', 'start', 'end', 'role', 'source_quote']),

  record_review_nonclaim: obj('Recorded nonclaim disposition.', {
    ...SPAN, rationale: str('Recorded rationale.'),
    reviewer_id: str('Authenticated reviewer identity.'), reviewed_at: str('When it was recorded (ISO 8601).'),
    visual_evidence: doc('Echo of the visual reference with origin model_generated_layout, when one was supplied.'),
  }, ['asset_id', 'start', 'end', 'source_quote', 'rationale', 'reviewer_id', 'reviewed_at']),

  get_latest_representation: REPRESENTATION,
  publish_text_representation: REPRESENTATION,

  read_source_unit: obj('One immutable source unit.', {
    sourceVersionId: str('Source version ID.'), representationId: str('Representation ID.'), sourceUnitId: str('Source unit ID.'),
    assetId: str('Asset the source version belongs to.'), unitKey: str('Stable unit key, for example page:3.'),
    locator: { type: 'object', description: 'Where the unit sits in the source (see get_latest_representation).' },
    content: str('Full unit text. verify_numeric_claim figure_index counts numbers in its first 20,000 characters.'),
    state: str('complete, partial, unreadable, unsupported, encrypted, corrupt or error.'),
    contentHash: str('Hash of content.'), identityHash: doc('Hash of the unit identity.'),
    tokenMap: doc('Code-point token spans for text locators; null otherwise.'), native: doc('Reader-specific data, for example the OCR visual page.'),
  }, ['sourceVersionId', 'representationId', 'sourceUnitId', 'unitKey', 'locator', 'content', 'state', 'contentHash']),

  register_source: obj('Retained source version for the uploaded bytes.', {
    sourceVersionId: str('New or existing retained source version ID; it becomes the asset\'s selected version unless identical bytes were registered before.'),
    assetId: str('The asset ID you passed.'),
    bytesHash: doc('Hash of the bytes.'), byteLength: doc('Size in bytes.'), mediaType: doc('Detected media type.'),
    fileName: doc('Stored file name.'), state: doc('available.'), createdAt: doc('ISO 8601 time.'),
  }, ['sourceVersionId', 'assetId']),

  prepare_ocr_rescue: { type: 'object', description: 'Either an unavailable state (attempted false, with code disabled or not_ocr and a reason) or a preparation receipt (prepared, calibrationKey, candidateCount, decidedAt).', properties: {
    attempted: { type: 'boolean', description: 'false when nothing was prepared.' },
    code: doc('disabled (feature off) or not_ocr (no OCR pages).'), reason: doc('Why nothing was prepared.'),
    prepared: { type: 'boolean', description: 'Whether judged OCR candidates were prepared.' },
    calibrationKey: doc('Calibration used.'), candidateCount: doc('Number of OCR candidates judged.'), decidedAt: doc('ISO 8601 time.'),
  }, anyOf: [{ required: ['attempted'], properties: { attempted: { type: 'boolean' } } }, { required: ['prepared'], properties: { prepared: { type: 'boolean' } } }] },

  verify_numeric_claim: obj('Arithmetic assessment of the claim against the retained figures.', {
    outcome: str('supported, contradicted, escalate (needs a person or semantic check) or not_applicable.'),
    reason: str('Why.'), scope: str('arithmetic_only: this is not semantic verification.'),
    limitation: doc('What the assessment does not cover.'),
    arithmetic: doc('verdict holds, fails or not_computable, computed value, tolerance and reason; null when not computed.'),
    comparability: doc('Whether unit, scale, measure, entity, period and basis are comparable; null when not assessed.'),
    claimKey: doc('Measure, entity, period, basis, currency and role parsed from the claim.'),
    operands: doc('Each figure read (raw text, value, unit, scale) with its source IDs and facet outcomes.'),
    certificate: doc('Hashes and check result that make the assessment reproducible.'),
  }, ['outcome', 'reason', 'scope']),

  ask_document: obj('Accepted ask job.', {
    id: str('Job ID for get_ask_result.'), operation_id: doc('Paid operation ID, or null.'),
    billing_status: doc('pending until the job settles.'), usage: doc('Credits are null until settled.'), credit_usage: CREDIT_USAGE,
  }, ['id']),

  get_ask_result: obj('Ask job status and result.', {
    id: str('Job ID.'),
    status: str('queued, running, done or failed.'),
    result: doc('When done: answer (string, number or null; null when no number verified), checks (field, drafted, verdict verified, nulled or unverifiable), evidence (field, page, section, excerpt) and warnings.'),
    error: doc('When failed: code (bad_input, needs_ocr, retrieval_empty, unverified, draft_failed or internal) and message.'),
    billing: doc('state pending, settled, no_charge or unknown, credits and operation_id.'),
    credit_usage: CREDIT_USAGE,
  }, ['id', 'status']),

  extract_pages: obj('Citation-ready chunks. state error or unsupported is returned with isError true.', {
    state: str('complete, partial, unsupported or error.'),
    chunks: doc('Array of chunks: ordinal (from 0, contiguous), text, page, sheet or section anchor, extraction_method and token_estimate.'),
    reason: doc('Why the read is partial or failed, or null.'), code: doc('Failure code, or null.'), mode: doc('lite on a lite read.'),
    operation_id: doc('Paid operation ID, or null.'), usage: doc('Credits and pages charged.'), credit_usage: CREDIT_USAGE,
  }, ['state']),

  revise_document_claim_analysis: obj('Saved policy revision of one claim.', {
    review_id: str('Review ID.'), claim_id: str('Claim ID.'),
    analysis_revision: { type: 'object', description: 'Revision: id, policy_version, origin policy_re_evaluation, basis retained_snippets, assessment_status, claim_result (verdict, confidence, summary), citation_counts and citations.' },
    analysis_revision_summary: { type: 'object', description: 'Revision without citations, when the full revision exceeds the response limit.' },
    retained_citation_count: { type: 'integer', minimum: 0 },
    citations_omitted: { type: 'boolean' },
  }, ['review_id', 'claim_id']),
};

export const OUTPUT_SCHEMAS: Record<string, Schema> = Object.fromEntries(
  Object.entries(RESULTS).map(([name, result]) => [name, output(result)]),
);
