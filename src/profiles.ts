/**
 * MCP tool profiles. Local default is `core`; hosted default is `public`.
 * Set WEBCITE_MCP_PROFILE=public|full|docs|research to widen.
 */

export type McpProfile = 'core' | 'docs' | 'research' | 'public' | 'full';

/** Ordered core tools (guide first). Keep ≤12. */
export const CORE_TOOL_ORDER = [
  'webcite_guide',
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
      : (process.env.WEBCITE_MCP_PROFILE ?? 'core');
  const v = String(source).trim().toLowerCase();
  if (v === 'full' || v === 'public' || v === 'docs' || v === 'research' || v === 'core') {
    return v;
  }
  return 'core';
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

export const SERVER_INSTRUCTIONS = `Webcite verifies claims and binds quotes to sources. Free plan: 100 credits/month.

START: call webcite_guide with workflow=quick_verify (or document_quote / numeric).

Workflows:
1) Plain fact → verify_claim({ claim })
2) Quote in a document → upload_file → extract_document → get_source_preview → verify_batch
3) Figures / conflicts → extract_figures → analyze_conflicts

Do not call context workflow/eval tools unless WEBCITE_MCP_PROFILE=full and the user asks.
Never invent citation URLs. Prefer get_source_preview to show evidence.
Hosted profile is public. Local default is core; use WEBCITE_MCP_PROFILE=public|docs|research|full to widen.`;
