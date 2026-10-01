/**
 * MCP tool profiles. Local and hosted default to `public`.
 * Set WEBCITE_MCP_PROFILE=core|docs|research|full to change discovery.
 */

export type McpProfile = 'core' | 'docs' | 'research' | 'public' | 'full';

/** Ordered core tools (guide first). Keep ≤12. */
export const CORE_TOOL_ORDER = [
  'webcite_guide',
  'get_credit_balance',
  'verify_claim',
  'search_sources',
  'get_source_preview',
  'verify_batch',
  'upload_file',
  'extract_document',
  'extract_figures',
  'list_citations',
  'get_citation',
  'analyze_conflicts',
] as const;

const DOCS_EXTRA = [
  'analyze_document',
  'classify_document',
  'document_gaps',
  'accuracy_report',
  'verify_feedback',
] as const;

const RESEARCH_EXTRA = [
  'get_answer',
  'query_context',
  'get_evidence_packet',
  'compare_assertions',
  'get_change_impact',
  'verify_claim_stream',
] as const;

/** Public API tools only; advanced context and evaluation controls stay opt-in. */
const PUBLIC_TOOLS = [
  ...CORE_TOOL_ORDER,
  'get_document_review',
  'revise_document_claim_analysis',
  'get_review_source_span',
  'record_review_nonclaim',
  'get_document_review_job',
  'review_document',
  'verify_claim_stream', 'verify_feedback', 'analyze_document',
  'classify_document', 'document_gaps', 'accuracy_report',
  'ask_document', 'get_ask_result', 'extract_pages',
  'prepare_ocr_rescue', 'verify_numeric_claim',
  'publish_text_representation', 'get_latest_representation',
  'register_source', 'read_source_unit',
] as const;

export function resolveProfile(raw?: string): McpProfile {
  const source =
    raw !== undefined && raw !== null
      ? raw
      : (process.env.WEBCITE_MCP_PROFILE ?? 'public');
  const v = String(source).trim().toLowerCase();
  if (v === 'full' || v === 'public' || v === 'docs' || v === 'research' || v === 'core') {
    return v;
  }
  return 'public';
}

export function allowedToolNames(profile: McpProfile): Set<string> | null {
  if (profile === 'full') return null;
  if (profile === 'public') return new Set<string>(PUBLIC_TOOLS);
  const names = new Set<string>(CORE_TOOL_ORDER);
  if (profile === 'docs' || profile === 'research') {
    for (const n of DOCS_EXTRA) names.add(n);
  }
  if (profile === 'research') {
    for (const n of RESEARCH_EXTRA) names.add(n);
  }
  return names;
}

export function filterToolsByProfile<T extends { name: string }>(
  tools: T[],
  profile: McpProfile = resolveProfile(),
): T[] {
  const allow = allowedToolNames(profile);
  const selected = allow ? tools.filter((t) => allow.has(t.name)) : [...tools];

  const rank = new Map<string, number>();
  CORE_TOOL_ORDER.forEach((n, i) => rank.set(n, i));
  DOCS_EXTRA.forEach((n, i) => rank.set(n, 100 + i));
  RESEARCH_EXTRA.forEach((n, i) => rank.set(n, 200 + i));

  selected.sort((a, b) => {
    const ra = rank.has(a.name) ? rank.get(a.name)! : 1000;
    const rb = rank.has(b.name) ? rank.get(b.name)! : 1000;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
  return selected;
}

export function profileExclusionMessage(
  name: string,
  profile: McpProfile,
): string {
  return (
    `Tool "${name}" is not available in WEBCITE_MCP_PROFILE=${profile}. ` +
    `Set WEBCITE_MCP_PROFILE=public|docs|research|full as appropriate, ` +
    `or call webcite_guide for the recommended workflow.`
  );
}

export const SERVER_INSTRUCTIONS = `Compact fields omitted are unknown, not absent. Report known material_claims (distinct assertions), total_claims (physical rows) and duplicate_claims separately. A duplicate display alias can have a different id; original_claim_id is its stored original identity and duplicate_of_id identifies the canonical assertion. Display aliases do not change stored IDs, citations or paid operations. Report pending, failed, rejected and uncovered counts separately. Null or missing counts are unknown, never zero. Do not group unknown rejected or uncovered counts with known zero pending or failed counts. A completed job means processing finished; it does not prove complete source coverage. For a queued or running review, obey poll_after_ms with waits of at most 30 seconds. Never multiply remaining claims by per-claim latency into a long blind sleep. Stop polling immediately on a terminal status and report failed or interrupted work. Do not infer source weighting, prioritization or analysis absence from omissions. Fetch verbose evidence details only when that specific audit requires them, not routinely.
Webcite verifies claims and binds quotes to sources. Free plan: 100 credits/month.

When a user asks to audit an entire uploaded document or every figure on a slide, use review_document directly with its existing asset_id, then poll get_document_review_job. Do not substitute a few verify_claim calls for full coverage. Only claim full coverage when the saved review reports coverage_complete=true and no pending claims.
Keep returned extraction structuredContent and reuse it in the conversation; repeated extract calls incur the stated per-call credits.

START: call webcite_guide with workflow=choose, then follow the workflow matching the user's request.

Workflows:
1) Plain fact → verify_claim({ claim })
2) Quote in a document → upload_file → extract_document → get_source_preview → verify_batch
3) Figures / conflicts → extract_document first; analyze_document accepts PDF, spreadsheet and JPEG/PNG/WebP images. Image figures are OCR/model reads and need source review. extract_figures finds recognized metrics only; zero metrics is not a full numeric audit.
4) Full document fact-check → webcite_guide({ workflow: 'document_review' }); upload original bytes only if needed, then review_document with stable thread_id (no mandatory balance or extraction preflight), get_document_review_job until terminal, then get_document_review for saved results and coverage. No fixed claim count. Preserve completed results and unchecked source spans on errors or credit exhaustion. extract_figures only recognizes known metrics.
5) Find the original source behind an image or slide → webcite_guide({ workflow: 'source_trace' }); extract_document, search_sources using exact table values and units, then get_source_preview on candidate URLs. Use verify_claim with confirmed source_urls for claim truth. ask_document is numerical Q&A over supplied text, not an external-source finder.

Do not call context workflow/eval tools unless WEBCITE_MCP_PROFILE=full and the user asks.
Never invent citation URLs. Prefer get_source_preview to show evidence.
Local and hosted profiles default to public. Use WEBCITE_MCP_PROFILE=core|docs|research|full to change local discovery.`;
