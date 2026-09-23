import { ToolFailure } from './errors.js';
import type { BatchResultItem, Citation, CitationRecord, VerifyClaimResponse } from './types.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new ToolFailure('invalid_api_output', message, {
    actionable: 'Inspect the stored response; do not rerun verification to replace missing evidence.',
  });
}

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return invalid('Stored verification contains invalid JSON'); }
}

function citations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return invalid('Verification citations must be an array');
  for (const source of value) {
    if (!object(source) || typeof source.url !== 'string' || !source.url.trim()) {
      invalid('Verification citation is missing its source URL');
    }
    for (const key of ['title', 'snippet', 'stance_explanation']) {
      if (source[key] != null && typeof source[key] !== 'string') invalid(`Invalid citation ${key}`);
    }
    for (const key of ['credibility_score', 'stance_confidence']) {
      if (source[key] != null && (typeof source[key] !== 'number' || !Number.isFinite(source[key]))) {
        invalid(`Invalid citation ${key}`);
      }
    }
    if (source.evidence != null && !object(source.evidence)) invalid('Invalid citation evidence receipt');
  }
  return value as Citation[];
}

function verdict(value: unknown): void {
  if (!object(value) || typeof value.result !== 'string' || typeof value.summary !== 'string'
    || !['supported', 'partially_supported', 'contradicted', 'mixed', 'unverifiable'].includes(value.result)) {
    invalid('Invalid verification verdict');
  }
  if (value.confidence != null && (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence))) {
    invalid('Invalid verdict confidence');
  }
  if (value.key_findings != null && (!Array.isArray(value.key_findings) || value.key_findings.some((v) => !object(v)))) {
    invalid('Invalid verdict findings');
  }
  if (value.corrections != null && (!Array.isArray(value.corrections) || value.corrections.some((v) => !object(v)))) {
    invalid('Invalid verdict corrections');
  }
  if (value.unverified_claims != null && (!Array.isArray(value.unverified_claims) || value.unverified_claims.some((v) => typeof v !== 'string'))) {
    invalid('Invalid unverified claims');
  }
}

/** Validate the envelope without projecting away additive backend evidence fields. */
export function validateVerification(value: unknown): VerifyClaimResponse {
  if (!object(value)) return invalid('Verification result must be an object');
  if (!Array.isArray(value.claim_groups) && !Array.isArray(value.citations)) {
    return invalid('Verification result is missing citations or claim groups');
  }
  if (value.citations !== undefined) citations(value.citations);
  if (value.claim_groups !== undefined) {
    if (!Array.isArray(value.claim_groups)) return invalid('Invalid verification claim groups');
    for (const group of value.claim_groups) {
      if (!object(group) || typeof group.claim !== 'string') invalid('Invalid verification claim group');
      citations(group.citations);
      if (group.verdict != null) verdict(group.verdict);
    }
  }
  if (value.verdict != null) verdict(value.verdict);
  return value as unknown as VerifyClaimResponse;
}

export function validateBatch(value: unknown): BatchResultItem[] {
  if (!Array.isArray(value)) return invalid('Batch verification result must be an array');
  for (const item of value) {
    if (!object(item) || typeof item.quote !== 'string') invalid('Invalid batch verification item');
    if (item.error) continue;
    if (!object(item.binding) || !object(item.verification)) invalid('Batch item is missing its evidence binding');
    if (typeof item.binding.grounded !== 'boolean' || typeof item.verification.grounded !== 'boolean') {
      invalid('Invalid batch grounding state');
    }
  }
  return value as BatchResultItem[];
}

export function storedVerification(record: CitationRecord): {
  citations: Citation[]; final_response?: VerifyClaimResponse;
} {
  const stored = parse(record.citation);
  const normalized = Array.isArray(stored) ? { citations: citations(stored) } : validateVerification(stored);
  const sources = normalized.citations ?? ('claim_groups' in normalized
    ? normalized.claim_groups.flatMap((group) => group.citations) : []);
  const metadata = record.metadata == null ? undefined : parse(record.metadata);
  if (metadata !== undefined && !object(metadata)) invalid('Invalid verification metadata');
  const final = object(metadata) && metadata.final_response != null
    ? validateVerification(metadata.final_response)
    : !Array.isArray(stored) && object(stored) && (stored.verdict != null ||
      (Array.isArray(stored.claim_groups) && stored.claim_groups.some((group) => object(group) && group.verdict != null)))
      ? validateVerification(stored) : undefined;
  return { citations: sources, ...(final ? { final_response: final } : {}) };
}
