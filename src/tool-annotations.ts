/**
 * Display titles and MCP behaviour hints for every advertised tool.
 *
 * read: only reads data (GET routes and the local guide).
 * write: creates records or spends credits, never changes or removes existing data.
 * destructive: settles, releases, resolves or rewrites existing state.
 * web: reaches sources on the open web (openWorldHint).
 */

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
}

type Kind = 'read' | 'write' | 'destructive';

const T: Record<string, [title: string, kind: Kind, web?: 'web']> = {
  webcite_guide: ['Choose a Webcite workflow', 'read'],
  get_credit_balance: ['Get credit balance', 'read'],
  verify_claim: ['Verify a claim against sources', 'write', 'web'],
  verify_claim_stream: ['Verify a claim with streamed progress', 'write', 'web'],
  search_sources: ['Search for sources', 'write', 'web'],
  list_citations: ['List saved citations', 'read'],
  get_citation: ['Get a saved citation', 'read'],
  get_source_preview: ['Preview the source behind a citation', 'read', 'web'],
  upload_file: ['Upload a file', 'write'],
  upload_url: ['Upload a file from a URL', 'write', 'web'],
  verify_batch: ['Verify several claims', 'write', 'web'],
  verify_feedback: ['Send feedback on a verification', 'write'],
  analyze_conflicts: ['Check figures for conflicts', 'write'],
  analyze_document: ['Analyze figures in a document', 'write'],
  classify_document: ['Classify a document', 'write'],
  document_gaps: ['Find gaps in a document', 'write'],
  extract_document: ['Extract a document to Markdown', 'write'],
  extract_figures: ['Extract figures from a document', 'write'],
  accuracy_report: ['Get the numeric accuracy report', 'read'],
  get_document_review: ['Get a saved document review', 'read'],
  revise_document_claim_analysis: ['Revise a reviewed claim analysis', 'write'],
  get_review_source_span: ['Get an unchecked review source span', 'read'],
  record_review_nonclaim: ['Mark a review span as not a claim', 'write'],
  get_document_review_job: ['Get document review progress', 'read'],
  review_document: ['Fact-check a whole document', 'write', 'web'],
  register_source: ['Register a retained source', 'write'],
  read_source_unit: ['Read a source unit', 'read'],
  publish_text_representation: ['Publish a text representation', 'write'],
  get_latest_representation: ['Get the latest source representation', 'read'],
  ask_document: ['Ask a numeric question about a document', 'write'],
  get_ask_result: ['Get a document answer', 'read'],
  extract_pages: ['Extract selected pages', 'write'],
  prepare_ocr_rescue: ['Prepare an OCR rescue', 'write'],
  verify_numeric_claim: ['Check arithmetic in a claim', 'write'],
  repair_folder_generation: ['Repair a folder generation', 'destructive'],
  get_answer: ['Get an answer revision', 'read'],
  get_evidence_packet: ['Get an evidence packet', 'read'],
  query_context: ['Query retained context', 'write'],
  compare_assertions: ['Compare assertions', 'write'],
  resolve_fragment_uses: ['Resolve fragment uses', 'write'],
  get_change_impact: ['Get change impact', 'write'],
  create_evidence_packet: ['Create an evidence packet', 'write'],
  assess_support: ['Assess source support', 'write'],
  assess_meaning: ['Assess meaning', 'write'],
  number_inventory: ['Inventory numbers', 'write'],
  find_contradictions: ['Find contradictions', 'write'],
  formal_eligibility: ['Check formal eligibility', 'write'],
  formal_check: ['Run a formal check', 'write'],
  create_claim_relation: ['Create a claim relation', 'write'],
  list_claim_relations: ['List claim relations', 'read'],
  create_metric_definition: ['Create a metric definition', 'write'],
  list_metric_definitions: ['List metric definitions', 'read'],
  claim_structure_tier: ['Classify claim structure', 'write'],
  claim_structure_resolve_definition: ['Resolve a claim definition', 'write'],
  formalize_claim_relation: ['Formalize a claim relation', 'write'],
  create_research_run: ['Start a research run', 'write', 'web'],
  get_research_run: ['Get a research run', 'read'],
  list_research_runs: ['List research runs', 'read'],
  checkpoint_research_run: ['Checkpoint a research run', 'write'],
  resolve_seeds: ['Resolve research seeds', 'write', 'web'],
  expand_seeds: ['Expand research seeds', 'write', 'web'],
  learning_judge: ['Judge a learning candidate', 'write'],
  learning_apply: ['Apply a learning change', 'destructive'],
  learning_placeholder: ['Get the learning placeholder', 'read'],
  format_certify: ['Certify a format', 'write'],
  reserve_research_budget: ['Reserve research budget', 'write'],
  open_operation_root: ['Open an operation root', 'write'],
  reserve_operation: ['Reserve an operation', 'write'],
  get_operation: ['Get an operation', 'read'],
  get_operation_availability: ['Get operation availability', 'read'],
  settle_operation: ['Settle an operation', 'destructive'],
  release_operation: ['Release an operation', 'destructive'],
  record_operation_attempt: ['Record an operation attempt', 'write'],
  resolve_operation_attempt: ['Resolve an operation attempt', 'destructive'],
  link_operation_consumer: ['Link an operation consumer', 'write'],
  get_consumer_usage: ['Get consumer usage', 'read'],
  get_provider_cost: ['Get provider cost', 'read'],
  formal_resolution_state: ['Get formal resolution state', 'write'],
  formal_revenue_bridge: ['Build a formal revenue bridge', 'write'],
  eval_catalog: ['List evaluation catalog', 'read'],
  certify_private_upload: ['Check private upload certification', 'read'],
  certify_retrieve_flag: ['Check retrieve flag certification', 'read'],
  proofs_applies: ['Check whether proofs apply', 'read'],
  publish_context_workflow: ['Publish a context workflow', 'write'],
  get_context_workflow: ['Get a context workflow', 'read'],
  run_saved_workflow: ['Run a saved workflow', 'write'],
  get_workflow_run: ['Get a workflow run', 'read'],
  get_evaluation: ['Get an evaluation', 'read'],
  compare_evaluations: ['Compare evaluations', 'write'],
  get_evaluation_case: ['Get an evaluation case', 'read'],
};

export const ANNOTATED_TOOL_NAMES: readonly string[] = Object.keys(T);

export function toolAnnotations(name: string): ToolAnnotations {
  const entry = T[name];
  if (!entry) throw new Error(`Tool "${name}" has no title or behaviour hints in tool-annotations.ts`);
  const [title, kind, web] = entry;
  return {
    title,
    readOnlyHint: kind === 'read',
    destructiveHint: kind === 'destructive',
    openWorldHint: web === 'web',
  };
}

export function withAnnotations<D extends { name: string }>(
  tool: D,
): D & { title: string; annotations: ToolAnnotations } {
  const annotations = toolAnnotations(tool.name);
  return { ...tool, title: annotations.title, annotations };
}
