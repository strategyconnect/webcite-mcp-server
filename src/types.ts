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
  text: string;
  source_texts?: string[];
  source_version_ids?: string[];
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

export interface ChangeImpactOptions {
  answer_revision_id: string;
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

export interface ChangeImpactResponse {
  answer_revision_id: string;
  freshness: FreshnessObservation;
  engine: 'context_graph';
}

export interface CreateEvidencePacketOptions {
  claim_text: string;
  operator_class?: string;
  bindings: Array<{
    source_version_id: string;
    source_unit_id: string;
    representation_id: string;
    snippet?: string;
    seed?: string;
  }>;
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
  claim_revision_id: string;
  claim_hash: string;
  evidence_group_revision_id: string;
  alternative_fragment_id?: string | null;
  tier?: 1 | 2 | 3;
  proposed?: string;
  binding?: string;
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

export interface FindContradictionsOptions {
  claims: Array<{
    interval: { from: string | null; to: string | null };
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
  predicate: string;
  argument_ids: string[];
  arguments_resolved: boolean;
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
  predicate?: string;
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
  open_requirement_ids?: string[];
  max_steps?: number;
  idempotency_key?: string;
}

export interface ResearchRunPayload {
  id: string;
  checkpointRevision: number;
  objective: string;
  phase: string;
  [key: string]: unknown;
}

export interface CreateResearchRunResponse {
  run: ResearchRunPayload;
  engine?: string;
}

export interface GetResearchRunOptions {
  run_id: string;
}

export interface GetResearchRunResponse {
  run: ResearchRunPayload;
  engine?: string;
}

export interface CheckpointResearchRunOptions {
  run_id: string;
  expected_revision: number;
  run: ResearchRunPayload;
  idempotency_key?: string;
}

export interface CheckpointResearchRunResponse {
  run: ResearchRunPayload;
  engine?: string;
}

export interface ResolveSeedsOptions {
  text: string;
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
  kind: 'spreadsheet' | 'office' | 'text';
  expected: unknown[];
  found: unknown[];
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
  run_id: string;
  idempotency_key: string;
  kind: string;
  credits: number;
  tokens?: number;
}

export interface ReserveResearchBudgetResponse {
  operationId: string;
  replay: boolean;
  engine?: string;
}

export interface GetOperationOptions {
  operation_id: string;
}

export interface GetOperationResponse {
  operation: Record<string, unknown>;
  engine?: string;
}

export interface GetOperationAvailabilityOptions {
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
  predicate: string;
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

export interface EvaluationDescribeResponse {
  run_id: string;
  private_gold_denied: boolean;
  [key: string]: unknown;
}

export interface EvaluationCompareResponse {
  baseline_run_id: string;
  candidate_run_id: string;
  private_gold_denied: boolean;
  comparison?: unknown;
  [key: string]: unknown;
}

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
