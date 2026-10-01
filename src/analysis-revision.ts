import { createHash } from 'node:crypto';
import { ToolFailure } from './errors.js';

const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function validateAnalysisRevision(value: unknown, expectedHash?: string): Record<string, any> {
  if (!record(value) || value.origin !== 'policy_re_evaluation' || value.basis !== 'retained_snippets' ||
      typeof value.policy_version !== 'string' || !value.policy_version.trim() ||
      typeof value.original_result_hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.original_result_hash) ||
      (expectedHash !== undefined && value.original_result_hash !== expectedHash) ||
      value.id !== createHash('sha256').update(value.original_result_hash + ':' + value.policy_version).digest('hex') ||
      typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) ||
      !['complete', 'missing_scope_assessment'].includes(value.assessment_status) ||
      !Array.isArray(value.citations) || !record(value.claim_result) || !record(value.citation_counts) ||
      ['operation_id', 'credits_charged', 'creditUsage', 'credits_used', 'credits_remaining'].some((key) => value[key] !== undefined))
    throw new ToolFailure('invalid_api_output', 'Saved analysis revision has invalid provenance');
  const result = value.claim_result;
  if (!['verified', 'partially_verified', 'contradicted', 'unverified'].includes(result.verdict) ||
      (result.confidence !== null && (typeof result.confidence !== 'number' ||
        !Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 100)) ||
      typeof result.summary !== 'string' ||
      ['supporting_count', 'contradicting_count'].some((key) => !Number.isInteger(result[key]) || result[key] < 0) ||
      ['supports', 'contradicts', 'partially_supports', 'neutral'].some((key) =>
        !Number.isInteger(value.citation_counts[key]) || value.citation_counts[key] < 0) ||
      value.citations.some((citation: unknown) => !record(citation) || typeof citation.url !== 'string' ||
        typeof citation.snippet !== 'string'))
    throw new ToolFailure('invalid_api_output', 'Saved analysis revision has invalid results');
  if (result.supporting_count !== value.citation_counts.supports ||
      result.contradicting_count !== value.citation_counts.contradicts ||
      Object.values(value.citation_counts).reduce((sum: number, count: any) => sum + count, 0) !== value.citations.length)
    throw new ToolFailure('invalid_api_output', 'Saved analysis revision has inconsistent counts');
  const counts = { supports: 0, contradicts: 0, partially_supports: 0, neutral: 0 };
  for (const citation of value.citations) {
    const key = ['supports', 'contradicts', 'partially_supports'].includes(citation.stance)
      ? citation.stance as keyof typeof counts : 'neutral';
    counts[key]++;
  }
  if (Object.keys(counts).some((key) => counts[key as keyof typeof counts] !== value.citation_counts[key]) ||
      (!counts.supports && !counts.contradicts && !counts.partially_supports && result.verdict !== 'unverified'))
    throw new ToolFailure('invalid_api_output', 'Saved analysis revision contradicts retained citation stances');
  return value;
}

export function validateSavedRevision(claim: Record<string, unknown>): void {
  if (claim.analysis_revision === undefined && claim.analysis_revisions === undefined) return;
  if (claim.result_state !== 'settled' || typeof claim.original_result_hash !== 'string' ||
      !Array.isArray(claim.analysis_revisions) || !claim.analysis_revisions.length || !record(claim.original_analysis))
    throw new ToolFailure('invalid_api_output', 'Saved analysis revision omitted original history');
  const revisions = claim.analysis_revisions.map((revision) => validateAnalysisRevision(revision, claim.original_result_hash as string));
  const current = revisions[revisions.length - 1];
  if (JSON.stringify(current) !== JSON.stringify(claim.analysis_revision) ||
      claim.result !== current.claim_result.verdict || claim.confidence !== current.claim_result.confidence ||
      claim.summary !== current.claim_result.summary || JSON.stringify(claim.citations) !== JSON.stringify(current.citations))
    throw new ToolFailure('invalid_api_output', 'Saved analysis revision differs from current result');
  const original = claim.original_analysis.citations;
  if (!Array.isArray(original) || current.citations.length !== original.length ||
      current.citations.some((citation: any, index: number) => citation.url !== original[index]?.url ||
        citation.snippet !== original[index]?.snippet ||
        JSON.stringify(citation.evidence) !== JSON.stringify(original[index]?.evidence)))
    throw new ToolFailure('invalid_api_output', 'Saved analysis revision changed retained evidence');
}
