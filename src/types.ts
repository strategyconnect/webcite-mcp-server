/**
 * WebCite API types — request options and response shapes for the public v1 API.
 */

/* ------------------------------------------------------------------ verify */

export interface VerifyClaimOptions {
  claim: string;
  thread_id?: string;
  include_stance?: boolean;
  include_verdict?: boolean;
  decompose_claim?: boolean;
  use_claim_decomposition?: boolean;
}

export interface SearchSourcesOptions {
  query: string;
  limit?: number;
}

export interface ListCitationsOptions {
  page?: number;
  limit?: number;
  thread_id?: string;
}

export interface Citation {
  id: string;
  title: string;
  url: string;
  snippet: string;
  author?: string;
  status?: string;
  credibility_score?: number;
  rank?: number;
  stance?: 'supports' | 'contradicts' | 'partially_supports' | 'neutral' | 'irrelevant';
  stance_confidence?: number;
  stance_explanation?: string;
  ranking_factors?: {
    source_authority: number;
    content_relevance: number;
    recency: number;
  };
  source_metadata?: {
    domain: string;
    domain_category: string;
    is_primary_source: boolean;
    is_fact_check_site: boolean;
  };
  publication_year?: number;
}

export interface Verdict {
  claim: string;
  result: 'supported' | 'partially_supported' | 'contradicted' | 'mixed' | 'unverifiable';
  confidence: number;
  summary: string;
  stance_breakdown: {
    supports: number;
    partially_supports: number;
    contradicts: number;
    neutral: number;
  };
  key_findings?: Array<{
    finding: string;
    citation_ids: string[];
    confidence: number;
  }>;
  corrections?: Array<{
    claimed: string;
    actual: string;
    citation_ids: string[];
  }>;
  unverified_claims?: string[];
}

export interface ClaimGroup {
  claim_id: string;
  claim_index: number;
  claim: string;
  stance_summary: 'supported' | 'contradicted' | 'mixed' | 'unverifiable';
  citation_count: number;
  citations: Citation[];
  verdict?: Verdict;
}

export interface VerifyClaimResponse {
  claim_groups: ClaimGroup[];
  totalResults: number;
  thread_id: string;
  citations?: Citation[];
  verdict?: Verdict;
  generated_prompts?: string[];
  credit_usage?: {
    credits_used: number;
    credits_remaining: number;
  };
}

export interface CitationRecord {
  id: string;
  thread_id: string;
  prompt: string;
  citation?: string | Citation[];
  created_at?: string;
}

export interface ListCitationsResponse {
  data: CitationRecord[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SSEEvent {
  event: string;
  data: unknown;
}

export interface UploadResponse {
  success: boolean;
  file_id: string;
  filename: string;
  mime_type: string;
  size: number;
}

/* ---------------------------------------------------------- source preview */

export interface SourcePreviewOptions {
  /** Web source URL to preview (provide this OR asset_id). */
  url?: string;
  /** Uploaded asset ID to preview (provide this OR url). Also accepts "asset://<id>". */
  asset_id?: string;
  /** 1-based page (PDF) or sheet index (spreadsheet). */
  page?: number;
  /** The cited quote to bind back against the source and highlight. */
  quote?: string;
  title?: string;
  highlight_terms?: string[];
}

export interface SourcePreviewResponse {
  kind: 'web' | 'page' | 'grid';
  url?: string;
  asset_id?: string;
  page?: number;
  sheet?: string | null;
  text?: string;
  title?: string;
  quote?: string;
  highlight_terms?: string[];
  deep_link: string;
  binding: {
    grounded: boolean;
    method: 'exact' | 'normalized' | 'unbound';
    matched_quote?: string;
  };
}

/* ---------------------------------------------------------- batch verify */

export interface BatchItem {
  /** Caller id echoed back on the result. */
  id?: string;
  /** The claim or quote to check. */
  quote: string;
  /** Source text to check against — provide this, or url, or asset_id. */
  source_text?: string;
  url?: string;
  asset_id?: string;
  /** 1-based page for an asset source. */
  page?: number;
}

export interface BatchResultItem {
  id?: string;
  quote: string;
  binding: {
    grounded: boolean;
    method: string;
    score?: number;
    matched_text?: string;
  };
  verification: {
    layer: string;
    band: string;
    confidence: number;
    grounded: boolean;
    binding_method?: string;
    review_reason?: string;
  };
  /** Opaque token to accept/reject this result via verify_feedback. */
  feedback_token: string;
  error?: string;
}

export type FeedbackVerdict = 'correct' | 'incorrect' | 'unsure';

/* ------------------------------------------------------- numeric accuracy */

export type FigureUnit = 'percent' | 'multiple' | 'currency' | 'ratio' | 'count' | 'months';

export interface FigureProvenance {
  assetId: string;
  documentName: string;
  page?: number;
  sheet?: string;
  cell?: string;
  /** How the value was read: a deterministic rule, or a vision model. */
  method: 'rule' | 'model';
  /** The passage the model cited when it read the value (model reads only). */
  quote?: string;
}

export interface ExtractedFigure {
  metric: string;
  value: number;
  unit: FigureUnit;
  entity?: string;
  period?: string;
  provenance: FigureProvenance;
  /** Confidence band; a model read is capped at needs_review. */
  band?: string;
  /** The value was confirmed by re-reading the cited cell. */
  bound?: boolean;
  reviewReason?: string;
}

export interface Conflict {
  metric: string;
  values: Array<{
    value: number;
    unit: FigureUnit;
    entity?: string;
    provenance: FigureProvenance;
  }>;
  /** Max minus min, in the metric's canonical unit. */
  delta: number;
  reconciliationQuestion: string;
}

export interface Recomputation {
  metric: string;
  stated?: number;
  computed: number;
  unit: FigureUnit;
  withinTolerance: boolean;
  inputs: Array<{ key: string; value: number; provenance: FigureProvenance }>;
}

export interface ReviewResult {
  needs_review: boolean;
  reasons: string[];
}

export interface AnalyzeResult {
  conflicts: Conflict[];
  recomputations: Recomputation[];
  review: ReviewResult;
}

export interface DocumentAnalysisResponse extends AnalyzeResult {
  figures: ExtractedFigure[];
  category?: string;
  covers?: string[];
}

export interface AccuracyReport {
  totals: {
    deals: number;
    figures: number;
    conflicts: {
      expected: number;
      found: number;
      flagged: number;
      falsePositives: number;
      detectionRate: number;
      precision: number;
    };
    recompute: { checked: number; correct: number };
  };
  pass: boolean;
  deals?: unknown[];
}

/* ------------------------------------------------------ document intelligence */

export type Taxonomy = 'vc' | 'ma';

export interface AssetRefOptions {
  /** An uploaded asset id (from upload_file). One of asset_id / asset_url is required. */
  asset_id?: string;
  /** A direct URL to the file, e.g. your own signed storage URL. */
  asset_url?: string;
}

export interface ClassifyOptions extends AssetRefOptions {
  taxonomy?: Taxonomy;
}

export interface ClassifyResult {
  category: string;
  covers: string[];
}

export interface GapDoc {
  filename?: string;
  label?: string;
  category?: string;
  covers?: string[];
}

export interface GapsOptions {
  category: string;
  docs: GapDoc[];
  taxonomy?: Taxonomy;
  stage?: 'early' | 'growth';
}

export interface GapsResponse {
  items: Array<{ name: string; present: boolean }>;
}

export interface ExtractionUnit {
  kind: 'page' | 'sheet';
  /** 1-based page/sheet index. */
  index: number;
  text: string;
  provenance: { page?: number; sheet?: string };
}

export interface ExtractedDoc {
  format: string;
  markdown: string;
  units: ExtractionUnit[];
  sheets?: Array<{ name: string }>;
}

export interface FiguresResponse {
  figures: ExtractedFigure[];
}

/* ---------------------------------------------------------- context graph (v2) */

export interface ClaimScope {
  entityId?: string | null;
  metric?: string;
  period?: string | null;
  unit?: string | null;
  currency?: string | null;
  scale?: string | null;
  basis?: 'actual' | 'forecast' | 'assumption' | 'unknown';
  definition?: string | null;
}

export interface EvidenceRef {
  sourceVersionId: string;
  sourceUnitId: string;
  anchorId: string;
}

export interface NumberedRef {
  n: number;
  ref: EvidenceRef;
}

export interface QueryContextOptions {
  /**
   * Natural-language query. Blank/whitespace or surrounding-padded →
   * padded_select_text (backend #314); never trim-launder into certified
   * selectPassage topical seeds.
   */
  text: string;
  /**
   * Optional inline source texts. Blank/whitespace/surrounding-padded entries →
   * padded_source_text; never trim-launder into a certified materialization.
   */
  source_texts?: string[];
  /**
   * Optional persisted source version ids. Blank/whitespace/surrounding-padded →
   * incomplete_source_version_identity (#264/#279); never trim-launder into a pin.
   */
  source_version_ids?: string[];
  /**
   * ClaimScope filters. Blank/whitespace/surrounding-padded string values →
   * padded_lookup_filter (#307; never certify a lookup_number bind).
   * null / '' / 'unknown' are honest unknowns.
   */
  filters?: Partial<ClaimScope>;
  max_hops?: 0 | 1 | 2;
  limit?: number;
  /** Logical idempotency key forwarded to the API; never used as scope. */
  idempotency_key?: string;
}

export interface ContextQueryRef {
  sourceVersionId: string;
  kind: 'number' | 'passage';
  nodeId: string;
  snippet: string;
}

export interface ContextQueryResponse {
  operatorClass: string;
  status: 'ok' | 'refuse';
  refuseReason?: string;
  queryPlan: {
    operatorClass: string;
    seeds: string[];
    truncated: boolean;
    traversedRelationIds: string[];
  };
  refs: ContextQueryRef[];
  gaps: string[];
  engine: 'context_graph';
  presentation?: { numbered_refs: NumberedRef[] };
}

export interface CompareAssertionsOptions {
  /**
   * Claim scopes. Blank/whitespace/surrounding-padded string fields →
   * padded_compare_filter (#307/#311 honesty; never trim-launder into same/different).
   */
  left: Partial<ClaimScope>;
  right: Partial<ClaimScope>;
  idempotency_key?: string;
}

export type ScopeCompareResult = 'same' | 'different' | 'unknown';

export interface CompareAssertionsResponse {
  result: ScopeCompareResult;
  left: Partial<ClaimScope>;
  right: Partial<ClaimScope>;
}

export type FragmentUseMatchKind = 'exact' | 'contains' | 'contained' | 'overlap';

export interface FragmentUseMatch {
  matchKind: FragmentUseMatchKind;
  fragmentId: string;
  groupIds: string[];
  linkIds: string[];
  consumerIds: string[];
  useAge: 'current' | 'historical';
  /** Geometric discovery never implies semantic support. */
  semanticSupport: false;
}

export interface ResolveFragmentUsesOptions {
  /**
   * FragmentSelector; representationId must be non-blank unpadded
   * (blank/padded → incomplete_representation_identity; #264/#279).
   */
  selector: Record<string, unknown>;
  /** Non-blank unpadded sealed packet id; blank/padded → incomplete_packet_identity (#264/#279). */
  packet_id?: string;
  /** Non-blank unpadded sealed answer revision; blank/padded → incomplete_answer_revision_identity (#264/#279). */
  answer_revision_id?: string;
  fragments?: unknown[];
  groups?: unknown[];
  links?: unknown[];
  consumers?: unknown[];
  /**
   * Optional authorization allow-list; blank/padded entries →
   * incomplete_allowed_fragment_identity (expand_seeds #68; never trim-launder).
   */
  allowed_fragment_ids?: string[];
  cursor?: string | null;
  limit?: number;
  idempotency_key?: string;
}

export interface ResolveFragmentUsesResponse {
  status: 'ok' | 'refuse';
  reason?: string;
  matches: FragmentUseMatch[];
  nextCursor: string | null;
  engine?: string;
  packet_id?: string;
  answer_revision_id?: string;
}

export interface ChangeImpactOptions {
  /** Answer freshness path — mutually optional with changed_ids (at least one required). */
  answer_revision_id?: string;
  /** When set, sealed packet must resolve or HTTP fails closed as change_impact_incomplete. */
  packet_id?: string;
  /**
   * Packet dependency path — W3 incomplete sealed-packet / graph surfaces.
   * Blank/whitespace/padded entries → incomplete_changed_ids (never invent / never strip).
   */
  changed_ids?: string[];
  /**
   * Dependency edges. Blank/whitespace/padded source_id/consumer_id →
   * incomplete_dependency_graph (#285; never trim into certified match).
   * source_id === consumer_id → self_loop_dependency (#294; never empty no-downstream).
   */
  links?: Array<{ source_id: string; consumer_id: string }>;
  observed_at_ms?: number | null;
  window?: { start_ms: number; end_ms: number };
  idempotency_key?: string;
}

export interface FreshnessObservation {
  claimRevisionIds: string[];
  coverage: 'complete' | 'unknown';
  unresolvedSourceVersionIds: string[];
  reasons: string[];
  selectionState?: 'unknown';
  observation?: 'newer_known_version' | 'no_newer_known_version' | 'undetermined';
}

/** Packet-bound W3 impact (camelCase as returned by context-ops). */
export interface PacketImpactObservation {
  affectedConsumerIds: string[];
  inWindow: boolean | null;
  unresolved: string[];
  coverage: 'complete' | 'unknown';
}

export interface ChangeImpactResponse {
  answer_revision_id?: string;
  freshness?: FreshnessObservation;
  packet_id?: string;
  packet_impact?: PacketImpactObservation;
  engine: 'context_graph';
}

export interface CreateEvidencePacketOptions {
  /**
   * Non-blank unpadded claim text. Blank/whitespace/surrounding-padded →
   * padded_claim_text (#314 honesty; never trim-launder into a sealed assertion).
   */
  claim_text: string;
  /**
   * Optional operator class label. Blank/whitespace/surrounding-padded →
   * padded_operator_class (never trim-launder into a sealed class; same honesty
   * as claim_text #76 / binding snippet #81). Restores #85 after #86 squash.
   */
  operator_class?: string;
  /**
   * Binding ids must be non-blank unpadded; blank/padded → incomplete_binding_identity (#264/#279).
   * Optional snippet blank/padded → padded_binding_snippet; optional seed blank/padded →
   * incomplete_binding_seed_identity (never trim-launder into a sealed packet).
   */
  bindings: Array<{
    source_version_id: string;
    source_unit_id: string;
    representation_id: string;
    snippet?: string;
    seed?: string;
  }>;
  /**
   * Optional non-blank unpadded idempotency key. Blank/whitespace/surrounding-
   * padded → incomplete_operation_idempotency_identity (never trim-launder into
   * a sealed packet replay; same honesty as settle/link #92/#94).
   */
  idempotency_key?: string;
}

export interface CreateEvidencePacketResponse {
  packet_id: string;
  content_hash?: string;
  input_packet_id?: string;
  operation_id?: string;
  gaps?: string[];
  engine?: string;
  presentation?: { numbered_refs: NumberedRef[] };
  support?: {
    assessment_id?: string;
    judgment?: Record<string, unknown>;
    explanation?: string;
    tier?: number;
  };
}

export interface AssessSupportOptions {
  /** Non-blank unpadded; blank/padded → incomplete_claim_revision_identity. */
  claim_revision_id: string;
  /** Non-blank unpadded; blank/padded → incomplete_claim_hash_identity. */
  claim_hash: string;
  /** Non-blank unpadded; blank/padded → incomplete_evidence_group_identity. */
  evidence_group_revision_id: string;
  /** When set: non-blank unpadded; blank/padded → incomplete_alternative_fragment_identity. */
  alternative_fragment_id?: string | null;
  tier?: 1 | 2 | 3;
  proposed?: string;
  binding?: string;
  /**
   * Optional. When string: non-blank unpadded; blank/padded →
   * incomplete_operation_idempotency_identity (#92 honesty shared with settle).
   */
  idempotency_key?: string;
}

export interface AssessSupportResponse {
  assessmentId: string;
  target: Record<string, unknown>;
  evidenceGroupRevisionId: string;
  alternativeFragmentId?: string | null;
  judgment: Record<string, unknown>;
  bindings?: unknown[];
  explanation?: string;
  engine?: string;
}

export interface AssessMeaningOptions {
  assessment: Record<string, unknown>;
  known_false_claim?: boolean;
  idempotency_key?: string;
}

export interface AssessMeaningResponse {
  meaning: string;
  authority: string;
  falseClaimSupport: string;
  engine?: string;
}

/**
 * W3 contradiction scan. Blank/whitespace/surrounding-padded interval endpoints
 * or decimals fail closed as contradiction_scan_incomplete (#256/#289) — never
 * trim-launder pads into certified known bounds or magnitudes.
 */
export interface FindContradictionsOptions {
  claims: Array<{
    /** Blank/whitespace/surrounding-padded from/to → unknown_interval_bounds (#289). */
    interval: { from: string | null; to: string | null };
    /** Null/blank/surrounding-padded on conflicting/unknown pairs → missing_decimal_value (#289). */
    decimal_value: string | null;
  }>;
  idempotency_key?: string;
}

export interface FindContradictionsResponse {
  count: number;
  pairs: Array<{
    left: { interval: unknown; decimal_value: string | null };
    right: { interval: unknown; decimal_value: string | null };
  }>;
  /** complete = certified scan; unknown must not be accepted as all-clear. */
  coverage: 'complete' | 'unknown';
  unresolved: string[];
  engine?: string;
}

/** W2 A_WORKBENCH_COUNTS — occurrence inventory (fail-closed when incomplete). */
export type NumberRecognitionState = 'read' | 'uncertain' | 'unreadable';

/** Capture method — never invent `native` when the client omits method. */
export type NumberOccurrenceMethod =
  | 'native'
  | 'ocr'
  | 'asr'
  | 'human'
  | 'chart_estimate';

export type NumberOccurrenceInterpretation =
  | 'measure'
  | 'date'
  | 'identifier'
  | 'ordinal'
  | 'range'
  | 'formula'
  | 'unknown';

export const NUMBER_OCCURRENCE_METHODS: readonly NumberOccurrenceMethod[] = [
  'native',
  'ocr',
  'asr',
  'human',
  'chart_estimate',
] as const;

export const NUMBER_OCCURRENCE_INTERPRETATIONS: readonly NumberOccurrenceInterpretation[] = [
  'measure',
  'date',
  'identifier',
  'ordinal',
  'range',
  'formula',
  'unknown',
] as const;

export interface NumberInventoryOccurrenceInput {
  /** Blank/whitespace/padded → missing_occurrence_identity (never invent). */
  id?: string;
  /** Blank/whitespace or surrounding-padded → missing_occurrence_raw (#287); never trim-launder. */
  raw?: string;
  /** Blank/whitespace/padded → missing_occurrence_identity (never invent). */
  fragment_id?: string;
  fragmentId?: string;
  /** Non-null blank/whitespace or surrounding-padded → blank_normalized_decimal (#278/#282); null allowed. */
  normalized_decimal?: string | null;
  /** Alias of normalized_decimal; non-null blank/padded → blank_normalized_decimal. */
  normalizedDecimal?: string | null;
  /** Surrounding-padded → invalid_occurrence_interpretation (#300); never trim-launder. */
  interpretation?: NumberOccurrenceInterpretation | string;
  /** Required for complete coverage; omit/blank/invalid/padded → number_inventory_incomplete (never defaulted to native; #300 pad honesty). */
  method?: NumberOccurrenceMethod | string;
  /** Surrounding-padded → invalid_recognition_state (#300); never trim-launder. */
  recognition_state?: NumberRecognitionState;
  recognitionState?: NumberRecognitionState;
}

export interface NumberInventoryOptions {
  occurrences: NumberInventoryOccurrenceInput[];
  idempotency_key?: string;
}

export interface NumberInventoryOccurrence {
  id: string;
  raw: string;
  fragment_id: string;
  normalized_decimal: string | null;
  interpretation: NumberOccurrenceInterpretation;
  method: NumberOccurrenceMethod;
  recognition_state: NumberRecognitionState;
}

export interface NumberInventoryResponse {
  counts: { read: number; uncertain: number; unreadable: number };
  occurrences: NumberInventoryOccurrence[];
  coverage: 'complete' | 'unknown';
  unresolved: string[];
  engine?: string;
}

export interface FormalEligibilityOptions {
  decimal?: string | null;
  unit?: string | null;
  scale?: string | null;
  basis_reviewed: boolean;
  recognition: 'native' | 'reviewed' | 'uncertain';
  idempotency_key?: string;
}

export interface FormalEligibilityResponse {
  eligible: boolean;
  scaling_ok: boolean;
  scaling_error: string | null;
  engine?: string;
}

export interface FormalCheckOptions {
  source: string;
  toolchain_version?: string;
  checker_digest?: string;
  require_lean?: boolean;
  timeout_ms?: number;
  idempotency_key?: string;
}

export interface FormalCheckResponse {
  status: string;
  toolchainVersion: string;
  checkerDigest: string;
  checkerPolicyRevision: string;
  reason?: string;
  mode?: string;
  engine?: string;
}

export interface CreateClaimRelationOptions {
  /** Non-blank unpadded; blank/padded → incomplete_claim_predicate_identity. */
  predicate: string;
  /** Non-blank unpadded; blank/padded → incomplete_claim_argument_identity. */
  argument_ids: string[];
  arguments_resolved: boolean;
  /** Non-blank unpadded when set; blank/padded → incomplete_claim_revision_identity. */
  claim_revision_id?: string | null;
  idempotency_key?: string;
}

export interface CreateClaimRelationResponse {
  relation: {
    id: string;
    predicate: string;
    argumentIds: string[];
    argumentsResolved: boolean;
    claimRevisionId: string | null;
    contentHash: string;
  };
  engine?: string;
}

export interface ListClaimRelationsOptions {
  /** Non-blank unpadded when set; blank/padded → incomplete_claim_predicate_identity. */
  predicate?: string;
  /** Non-blank unpadded when set; blank/padded → incomplete_claim_revision_identity. */
  claim_revision_id?: string;
}

export interface ListClaimRelationsResponse {
  relations: CreateClaimRelationResponse['relation'][];
  recognised: string[];
  engine?: string;
}

export interface CreateMetricDefinitionOptions {
  definition: Record<string, unknown>;
  idempotency_key?: string;
}

export interface CreateMetricDefinitionResponse {
  revisionId: string;
  contentHash: string;
  engine?: string;
}

export interface ListMetricDefinitionsOptions {
  metric?: string;
}

export interface ListMetricDefinitionsResponse {
  definitions: Record<string, unknown>[];
  engine?: string;
}

export interface CreateResearchRunOptions {
  /** Non-blank unpadded; blank/padded → padded_research_objective. */
  objective: string;
  snapshot_id: string;
  workflow_version: string;
  deal_id?: string;
  session_id?: string;
  budget: {
    max_credits: number;
    max_tokens: number;
    deadline_ms: number;
  };
  root_operation_id?: string | null;
  root_idempotency_key?: string;
  /** Non-blank/unpadded; blank/pad → incomplete_loop_requirement_identity (#304). */
  open_requirement_ids?: string[];
  max_steps?: number;
  /** When set: non-blank unpadded; blank/padded → incomplete_operation_idempotency_identity (#92/#95). */
  idempotency_key?: string;
}

export interface ResearchWaitCondition {
  kind: 'source_ready' | 'review_recorded' | string;
  /** Non-blank/unpadded; whitespace/pad → incomplete_wake_subject_identity (backend #268/#281). */
  subjectId: string;
  /** Non-blank/unpadded; whitespace/pad → incomplete_wake_subject_identity (backend #268/#281). */
  subjectRevisionId: string;
  expiresAtMs: number;
}

export interface ResearchRunScope {
  /** Non-blank/unpadded when wait is set; whitespace/pad → incomplete_wake_tenant_identity (#277/#281). */
  tenantId: string;
  /** When notes are present: non-blank/unpadded → incomplete_eligible_note_identity (#297). */
  userId?: string;
  /** When notes are present: non-blank/unpadded → incomplete_eligible_note_identity (#297). */
  dealId?: string;
  /** When notes are present: non-blank/unpadded → incomplete_eligible_note_identity (#297). */
  sessionId?: string;
  [key: string]: unknown;
}

/** Memory note surfaced on a research run; padded id/scope never certify eligibility (#297). */
export interface ResearchMemoryNote {
  /** Non-blank/unpadded; whitespace/pad → incomplete_eligible_note_identity (#297). */
  id: string;
  scope: ResearchRunScope;
  [key: string]: unknown;
}

export interface ResearchRunLoopProgress {
  steps?: number;
  maxSteps?: number;
  consecutiveNoProgress?: number;
  /** Non-blank/unpadded; blank/pad → incomplete_loop_requirement_identity (#304). */
  openRequirementIds?: string[];
  /** Non-blank/unpadded; blank/pad → incomplete_loop_requirement_identity (#304). */
  failedRequirementIds?: string[];
  [key: string]: unknown;
}

export interface ResearchRunPayload {
  id: string;
  checkpointRevision: number;
  objective: string;
  phase: string;
  /** When set, subjectId + subjectRevisionId must be non-blank/unpadded; scope.tenantId likewise. */
  wait?: ResearchWaitCondition | null;
  /** Required non-blank/unpadded tenantId when wait is set (backend #277/#281). Full ResearchScope required when notes are present (#297). */
  scope?: ResearchRunScope;
  /** When present, each note id + ResearchScope must be non-blank/unpadded (#297). */
  notes?: ResearchMemoryNote[];
  /** When present, open/failed requirement ids must be non-blank/unpadded (#304). */
  progress?: ResearchRunLoopProgress;
  [key: string]: unknown;
}

export interface CreateResearchRunResponse {
  run: ResearchRunPayload;
  opened_root?: boolean;
  engine?: string;
}

export interface GetResearchRunOptions {
  run_id: string;
}

export interface GetResearchRunResponse {
  run: ResearchRunPayload;
  engine?: string;
}

/**
 * Tenant-scoped list; scope comes from the API key (no client tenant override).
 * Backend #288: blank/surrounding-padded tenant ids never certify a list match.
 */
export interface ListResearchRunsOptions {}

export interface ListResearchRunsResponse {
  /** Each run's scope.tenantId must be non-blank/unpadded (#288). */
  runs: ResearchRunPayload[];
  engine?: string;
}

export interface CheckpointResearchRunOptions {
  run_id: string;
  expected_revision: number;
  run: ResearchRunPayload;
  /** When set: non-blank unpadded; blank/padded → incomplete_operation_idempotency_identity (#92/#95). */
  idempotency_key?: string;
}

export interface CheckpointResearchRunResponse {
  run: ResearchRunPayload;
  engine?: string;
}

export interface ResolveSeedsOptions {
  /**
   * Natural-language resolve text. Blank/whitespace or surrounding-padded →
   * padded_resolve_text (#311/#314); never trim-launder into certified seeds.
   */
  text: string;
  /**
   * Optional ClaimScope filters. Blank/whitespace or surrounding-padded values →
   * padded_resolve_filter (backend #311); never trim-launder into a certified pin.
   */
  filters?: Record<string, string | null | undefined>;
  /** Inline vocabulary. Omit to load from the SQL metric-definition catalog. */
  index?: Array<{
    id: string;
    scope: Record<string, string | null | undefined>;
    terms: string[];
  }>;
  idempotency_key?: string;
}

export interface ResolveSeedsResponse {
  candidates: Array<{
    id: string;
    resolver: string;
    pinnedFields: string[];
    scopeStatus: string;
  }>;
  leading_resolver: string | null;
  index_source?: 'request' | 'catalog' | string;
  index_size?: number;
  engine?: string;
}

export interface ExpandSeedsOptions {
  /** Seed node ids. Blank/whitespace/surrounding-padded → incomplete_expand_seed_identity. */
  seeds: string[];
  /** Authorized edges. Padded from/to → incomplete_expand_seed_identity. */
  edges: Array<{ from: string; to: string }>;
  /** Allowed node ids. Blank/whitespace/surrounding-padded → incomplete_expand_seed_identity. */
  allowed: string[];
  hops?: number;
  idempotency_key?: string;
}

export interface ExpandSeedsResponse {
  seeds: string[];
  hops: number;
  engine?: string;
}

export interface LearningJudgeOptions {
  hard_failures?: string[];
  verdict: 'pass' | 'fail' | 'uncertain' | 'error';
  attempts: number;
  idempotency_key?: string;
}

export interface LearningJudgeResponse {
  action: 'accept' | 'reject' | 'more_evidence' | 'escalate';
  engine?: string;
}

export interface LearningApplyOptions {
  proposal: Record<string, unknown>;
  gate: { gateId: string; allowed: boolean; reason: string } | null;
  idempotency_key?: string;
}

export interface LearningApplyResponse {
  status: 'applied' | 'refused';
  proposalId?: string;
  gateId?: string;
  reason?: string;
  engine?: string;
}

export interface LearningPlaceholderOptions {
  criterion?: string;
}

export interface LearningPlaceholderResponse {
  checkpoint: Record<string, unknown>;
  authoritative: boolean;
  engine?: string;
}

export interface FormatCertifyOptions {
  kind: 'spreadsheet' | 'office' | 'text' | 'image' | 'container' | 'media';
  expected: unknown[];
  found: unknown[];
  decode_finished?: boolean;
  alignments?: unknown[];
  require_precise_timing?: boolean;
  idempotency_key?: string;
}

export interface FormatCertifyResponse {
  ok: boolean;
  kind: string;
  reason?: string;
  missingCount?: number;
  engine?: string;
}

export interface ReserveResearchBudgetOptions {
  /** Non-blank unpadded research run id; blank/padded → incomplete_research_run_identity. */
  run_id: string;
  /** Non-blank unpadded replay key; blank/padded → incomplete_operation_idempotency_identity (#83 honesty). */
  idempotency_key: string;
  /** Non-blank unpadded kind; blank/padded → incomplete_operation_kind_identity (#83 honesty). */
  kind: string;
  credits: number;
  tokens?: number;
}

export interface ReserveResearchBudgetResponse {
  operationId: string;
  replay: boolean;
  engine?: string;
}

/** Open root EvidenceOperation; idempotency_key/kind must be non-blank unpadded. */
export interface OpenOperationRootOptions {
  /** Non-blank unpadded; blank/padded → incomplete_operation_idempotency_identity. */
  idempotency_key: string;
  /** Non-blank unpadded; blank/padded → incomplete_operation_kind_identity. */
  kind: string;
  max_credits: number;
  max_tokens: number;
  deadline_ms: number;
}

export interface OpenOperationRootResponse {
  operation: Record<string, unknown>;
  engine?: string;
}

/** Reserve EvidenceOperation; idempotency_key/kind must be non-blank unpadded. */
export interface ReserveOperationOptions {
  /** Non-blank unpadded; blank/padded → incomplete_operation_idempotency_identity. */
  idempotency_key: string;
  /** Non-blank unpadded; blank/padded → incomplete_operation_kind_identity. */
  kind: string;
  credits: number;
  tokens?: number;
  /** When string: non-blank unpadded; blank/padded → incomplete_operation_identity (#264/#279). */
  root_operation_id?: string | null;
}

export interface ReserveOperationResponse {
  operation: { id: string };
  replay: boolean;
  engine?: string;
}

export interface GetOperationOptions {
  /** Non-blank unpadded; blank/padded → incomplete_operation_identity (#264/#279). */
  operation_id: string;
}

export interface GetOperationResponse {
  operation: Record<string, unknown>;
  engine?: string;
}

export interface GetOperationAvailabilityOptions {
  /** Non-blank unpadded; blank/padded → incomplete_operation_identity (#264/#279). */
  operation_id: string;
}

export interface GetOperationAvailabilityResponse {
  availability: {
    maxCredits: number;
    maxTokens: number;
    settledCredits: number;
    outstandingCredits: number;
    outstandingTokens: number;
  };
  engine?: string;
}

export interface SettleOperationOptions {
  /** Non-blank unpadded; blank/padded → incomplete_operation_identity (#264/#279). */
  operation_id: string;
  settled_credits: number | null;
  /** When set: non-blank unpadded; blank/padded → incomplete_operation_idempotency_identity (#83/#88). */
  idempotency_key?: string;
}

export interface SettleOperationResponse {
  operation: Record<string, unknown>;
  engine?: string;
}

export interface ReleaseOperationOptions {
  /** Non-blank unpadded; blank/padded → incomplete_operation_identity (#264/#279). */
  operation_id: string;
}

export interface ReleaseOperationResponse {
  operation: Record<string, unknown>;
  engine?: string;
}

export interface RecordOperationAttemptOptions {
  /** Non-blank unpadded; blank/padded → incomplete_operation_identity (#264/#279). */
  operation_id: string;
  /**
   * Non-blank unpadded provider. Blank/whitespace/surrounding-padded →
   * incomplete_attempt_provider_identity (never trim-launder attribution).
   */
  provider: string;
  /**
   * Optional. When string: non-blank unpadded; blank/padded →
   * incomplete_attempt_model_identity. null allowed.
   */
  model?: string | null;
  /**
   * Optional. When string: non-blank unpadded; blank/padded →
   * incomplete_attempt_provider_idempotency_identity. null allowed.
   */
  provider_idempotency_key?: string | null;
  /**
   * Optional. When string: non-blank unpadded; blank/padded →
   * incomplete_operation_idempotency_identity (#92/#94 honesty shared with settle/link).
   */
  idempotency_key?: string;
}

export interface RecordOperationAttemptResponse {
  attempt: Record<string, unknown>;
  engine?: string;
}

export interface ResolveOperationAttemptOptions {
  /** Non-blank unpadded; blank/padded → incomplete_attempt_identity (#264/#279). */
  attempt_id: string;
  state: 'succeeded' | 'failed' | 'outcome_unknown';
  /**
   * Optional. When string: non-blank unpadded; blank/padded →
   * incomplete_attempt_failure_class_identity. null allowed.
   */
  failure_class?: string | null;
  measurements?: Record<string, unknown>;
  /**
   * Optional. When object: amount/currency/priceRevision must be non-blank
   * unpadded (blank/padded → incomplete_attempt_price_identity). null omits
   * price (unknown cost; never invent zero).
   */
  price?: {
    amount: string;
    currency: string;
    priceRevision: string;
  } | null;
  /**
   * Optional. When string: non-blank unpadded; blank/padded →
   * incomplete_operation_idempotency_identity (#92/#94 honesty shared with settle/link).
   */
  idempotency_key?: string;
}

export interface ResolveOperationAttemptResponse {
  attempt: Record<string, unknown>;
  engine?: string;
}

export interface LinkOperationConsumerOptions {
  /** Non-blank unpadded; blank/padded → incomplete_operation_identity (#264/#279). */
  operation_id: string;
  /** Non-blank unpadded; blank/padded → incomplete_consumer_identity (#264/#279). */
  consumer_kind: string;
  /** Non-blank unpadded; blank/padded → incomplete_consumer_identity (#264/#279). */
  consumer_id: string;
  /** When set: non-blank unpadded; blank/padded → incomplete_operation_idempotency_identity (#92). */
  idempotency_key?: string;
}

export interface LinkOperationConsumerResponse {
  consumer: Record<string, unknown>;
  engine?: string;
}

export interface GetConsumerUsageOptions {
  /** Non-blank unpadded; blank/padded → incomplete_consumer_identity (#264/#279). */
  consumer_kind: string;
  /** Non-blank unpadded; blank/padded → incomplete_consumer_identity (#264/#279). */
  consumer_id: string;
}

export interface GetConsumerUsageResponse {
  usage: {
    operationIds: string[];
    knownCredits: number | null;
    completeness: string;
  };
  engine?: string;
}

export interface GetProviderCostOptions {
  /** Non-blank unpadded entries; blank/padded → incomplete_operation_identity (#264/#279). */
  operation_ids: string[];
  /**
   * Optional. When string: non-blank unpadded; blank/padded →
   * incomplete_operation_idempotency_identity (#92 honesty shared with settle).
   */
  idempotency_key?: string;
}

export interface GetProviderCostResponse {
  cost: {
    attemptIds: string[];
    knownCost: string | null;
    currency: string | null;
    completeness: string;
    unknownAttemptIds: string[];
  };
  engine?: string;
}

export interface ProofsAppliesOptions {
  status: string;
  binding_hash: string;
  toolchain_version: string;
  current_binding_hash: string;
  approved_toolchains?: string[];
  checker_digest?: string;
}

export interface ProofsAppliesResponse {
  applies: boolean;
  engine?: string;
}

export interface FormalResolutionStateOptions {
  missing_operands?: boolean;
  undefined_definition?: boolean;
  proof_search_failed?: boolean;
  proof_timed_out?: boolean;
  counterexample_found?: boolean;
  checked_negation?: boolean;
  idempotency_key?: string;
}

export interface FormalResolutionStateResponse {
  state: string;
  engine?: string;
}

export interface FormalRevenueBridgeOptions {
  totalPoints: string;
  currency: string;
  period: string;
  entityId: string;
  scale: string;
  components: Array<{
    points: string;
    currency: string;
    period: string;
    entityId: string;
    scale: string;
    definitionRevisionId: string | null;
  }>;
  idempotency_key?: string;
}

export interface FormalRevenueBridgeResponse {
  status: 'discharged' | 'refused';
  sum?: string;
  reason?: string;
  engine?: string;
}

export interface ClaimStructureTierOptions {
  assertion: Record<string, unknown>;
  definition?: Record<string, unknown> | null;
  ambiguity?: Record<string, unknown> | null;
  idempotency_key?: string;
}

export interface ClaimStructureTierResponse {
  tier: 1 | 2 | 3;
  engine?: string;
}

export interface ClaimStructureResolveDefinitionOptions {
  metric: string;
  knowledge_as_of: string;
  effective_at: string;
  catalog: Record<string, unknown>[];
  decision?: Record<string, unknown> | null;
  idempotency_key?: string;
}

export interface ClaimStructureResolveDefinitionResponse {
  kind: 'definition' | 'ambiguity';
  result: unknown;
  engine?: string;
}

export interface FormalizeClaimRelationOptions {
  /** Non-blank unpadded; blank/padded → incomplete_claim_predicate_identity. */
  predicate: string;
  /** Non-blank unpadded; blank/padded → incomplete_claim_argument_identity. */
  argument_ids: string[];
  arguments_resolved: boolean;
  idempotency_key?: string;
}

export interface FormalizeClaimRelationResponse {
  relation: {
    predicate: string;
    argumentIds: string[];
    argumentsResolved: boolean;
  } | null;
  formalized: boolean;
  recognised: string[];
  engine?: string;
}

export interface AnswerArtifactSummary {
  id: string;
  revisionId: string;
  contentHash: string;
  text: string;
  textHash?: string;
  inputPacketId: string;
  inputPacketContentHash: string;
  outputPacketId: string;
  schemaVersion?: number;
  justifications?: unknown[];
  spans?: unknown[];
}

export interface EvidencePacketSummary {
  id: string;
  contentHash: string;
  operationId?: string;
  engineVersion?: string;
  refs?: EvidenceRef[];
  gaps?: string[];
  assertions?: Array<{ revisionId?: string; text?: string; scope?: Partial<ClaimScope> }>;
  queryPlan?: { seeds?: string[]; truncated?: boolean };
  usage?: { knownCredits?: number; completeness?: string; operationIds?: string[] };
  stopReason?: string;
}

export interface ResolvedAnswerResponse {
  answer: AnswerArtifactSummary;
  evidence: {
    packet: EvidencePacketSummary;
    fragments?: unknown[];
    inferences?: unknown[];
    [key: string]: unknown;
  };
  publication?: unknown;
  freshness?: FreshnessObservation;
  presentation?: { numbered_refs: NumberedRef[] };
}

export interface ResolvedPacketResponse {
  packet: EvidencePacketSummary;
  fragments?: unknown[];
  presentation?: { numbered_refs: NumberedRef[] };
  [key: string]: unknown;
}

export interface EvalCatalogResponse {
  suites: Array<{
    id: string;
    caseCount: number;
    surfaceIds: string[];
  }>;
  private_gold_denied: boolean;
}

export interface CertifyPrivateUploadResponse {
  ok: boolean;
  mode?: 'local_root' | 'cloud_bucket' | string;
  reason?: string;
  engine?: string;
}

export interface CertifyRetrieveFlagResponse {
  ok: boolean;
  enabled: boolean;
  default_off: boolean;
  engine?: string;
}

export interface SavedWorkflowPayload {
  id: string;
  revision: string;
  kind: 'source_impact' | 'evidence_satisfied' | string;
  inputSchemaHash: string;
  outputSchemaHash: string;
  workflowVersion: string;
  trigger: 'manual' | 'source_revision' | 'enters_satisfied' | string;
  budgetPolicy: {
    maxCredits: number;
    maxTokens: number;
    maxDurationMs: number;
  };
  reviewDestination: { system: 'webcite' | 'dd'; bindingId: string };
  [key: string]: unknown;
}

export interface WorkflowExecutionResponse {
  runId: string;
  workflowRevision: string;
  mode: 'preview' | 'propose';
  packetId: string;
  proposalId: string | null;
  traceArtifactId: string;
  reviewItem: { system: 'webcite' | 'dd'; id: string; revision: string } | null;
  [key: string]: unknown;
}

/** Evaluation run describe; path run_id must be non-blank unpadded (incomplete_evaluation_run_identity). */
export interface EvaluationDescribeResponse {
  run_id: string;
  private_gold_denied: boolean;
  [key: string]: unknown;
}

/**
 * Evaluation compare; baseline/candidate run ids must be non-blank unpadded
 * (incomplete_evaluation_run_identity). Optional idempotency_key when set must
 * be non-blank unpadded (incomplete_operation_idempotency_identity; #92/#95 honesty).
 */
export interface EvaluationCompareResponse {
  baseline_run_id: string;
  candidate_run_id: string;
  private_gold_denied: boolean;
  comparison?: unknown;
  [key: string]: unknown;
}

/** Evaluation case; run_id/case_id must be non-blank unpadded (incomplete_evaluation_run/case_identity). */
export interface EvaluationCaseResponse {
  run_id: string;
  case_id: string;
  private_gold_denied: boolean;
  [key: string]: unknown;
}

/** Typed tool/business failure surfaced as isError:true (not a protocol error). */
export type ToolFailureCode =
  | 'invalid_argument'
  | 'invalid_api_output'
  | 'api_error'
  | 'not_found'
  | 'integrity_error'
  | 'unauthorized'
  | 'partial_result';

export interface ToolFailurePayload {
  code: ToolFailureCode;
  message: string;
  details?: Record<string, unknown>;
  actionable?: string;
}
