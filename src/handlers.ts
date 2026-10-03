import { creditUsage, creditUsageText, reviewUsageText } from './credit-usage.js';
import { storedVerification, validateBatch, validateVerification } from './verification-response.js';
import { validateAnalysisRevision, validateSavedRevision } from './analysis-revision.js';
/**
 * Tool handlers — one per entry in ALL_TOOLS.
 * Context tools validate API responses before structuredContent and render text
 * from that same validated object (never regenerate evidence via a model).
 */

import { ApiClientError, ToolFailure, type WebCiteApiClient } from './api-client.js';
import { createHash } from 'node:crypto';
import {
  formatAccuracyReport,
  formatRetrievalScope,
  formatAnalyzeResult,
  formatBatchResults,
  formatChangeImpact,
  formatCitation,
  formatClassify,
  formatCompareAssertions,
  formatResolveFragmentUses,
  formatContextQuery,
  formatCreatePacket,
  formatAssessSupport,
  formatAssessMeaning,
  formatNumberInventory,
  formatFindContradictions,
  formatFormalEligibility,
  formatFormalCheck,
  formatCreateClaimRelation,
  formatListClaimRelations,
  formatCreateMetricDefinition,
  formatListMetricDefinitions,
  formatCreateResearchRun,
  formatGetResearchRun,
  formatListResearchRuns,
  formatCheckpointResearchRun,
  formatResolveSeeds,
  formatExpandSeeds,
  formatLearningJudge,
  formatLearningApply,
  formatLearningPlaceholder,
  formatFormatCertify,
  formatReserveResearchBudget,
  formatOpenOperationRoot,
  formatReserveOperation,
  formatGetOperation,
  formatGetOperationAvailability,
  formatSettleOperation,
  formatReleaseOperation,
  formatRecordOperationAttempt,
  formatResolveOperationAttempt,
  formatLinkOperationConsumer,
  formatGetConsumerUsage,
  formatGetProviderCost,
  formatProofsApplies,
  formatFormalResolutionState,
  formatFormalRevenueBridge,
  formatClaimStructureTier,
  formatClaimStructureResolveDefinition,
  formatFormalizeClaimRelation,
  formatDocumentAnalysis,
  formatEvalCatalog,
  formatCertifyPrivateUpload,
  formatCertifyRetrieveFlag,
  formatExtractedDoc,
  formatFigures,
  formatGaps,
  formatResolvedAnswer,
  formatResolvedPacket,
  formatSourcePreview,
  formatVerifyResult,
} from './formatters.js';
import { collectStreamEvents } from './stream.js';
import { renderWebciteGuide } from './guide.js';
import type {
  FindContradictionsOptions,
  NumberInventoryOptions,
  ResolveSeedsOptions,
  ResearchRunPayload,
  FormalRevenueBridgeOptions,
  AssetRefOptions,
  BatchItem,
  Citation,
  ClaimScope,
  ExtractedFigure,
  FeedbackVerdict,
  GapDoc,
  Taxonomy,
  VerifyClaimOptions,
  SourceFilters,
  SSEEvent,
  ReviewDocumentOptions,
} from './types.js';
import {
  validateChangeImpact,
  validateCompareAssertions,
  validateResolveFragmentUses,
  validateContextQuery,
  validateCreatePacket,
  validateAssessSupport,
  validateAssessMeaning,
  validateNumberInventory,
  validateFindContradictions,
  validateFormalEligibility,
  validateFormalCheck,
  validateCreateClaimRelation,
  validateListClaimRelations,
  validateCreateMetricDefinition,
  validateListMetricDefinitions,
  validateCreateResearchRun,
  validateGetResearchRun,
  validateListResearchRuns,
  validateCheckpointResearchRun,
  validateResolveSeeds,
  validateExpandSeeds,
  validateLearningJudge,
  validateLearningApply,
  validateLearningPlaceholder,
  validateFormatCertify,
  validateReserveResearchBudget,
  validateOpenOperationRoot,
  validateReserveOperation,
  validateGetOperation,
  validateGetOperationAvailability,
  validateSettleOperation,
  validateReleaseOperation,
  validateRecordOperationAttempt,
  validateResolveOperationAttempt,
  validateLinkOperationConsumer,
  validateGetConsumerUsage,
  validateGetProviderCost,
  validateProofsApplies,
  validateFormalResolutionState,
  validateFormalRevenueBridge,
  validateClaimStructureTier,
  validateClaimStructureResolveDefinition,
  validateFormalizeClaimRelation,
  validateEvalCatalog,
  validateCertifyPrivateUpload,
  validateCertifyRetrieveFlag,
  validateResolvedAnswer,
  validateResolvedPacket,
} from './validate.js';

type Args = Record<string, unknown> | undefined;

const REVIEW_RESPONSE_MAX_BYTES = 20_000;

export type ToolSuccess = {
  text: string;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type ToolHandler = (args: Args, client: WebCiteApiClient, signal?: AbortSignal) => Promise<ToolSuccess>;

function ok(text: string, structuredContent?: Record<string, unknown>): ToolSuccess {
  return structuredContent ? { text: text + creditUsageText(structuredContent) + reviewUsageText(structuredContent), structuredContent } : { text };
}

function extractionResult(text: string, result: Record<string, unknown>): ToolSuccess {
  return { ...ok(text, result), isError: result.state === 'error' || result.state === 'unsupported' };
}

function validReviewDisposition(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.asset_id !== 'string' || !item.asset_id.trim() ||
      !Number.isInteger(item.start) || (item.start as number) < 0 ||
      !Number.isInteger(item.end) || (item.end as number) <= (item.start as number) ||
      typeof item.source_quote !== 'string' ||
      item.source_quote.length !== (item.end as number) - (item.start as number)) return false;
  if (item.reason === 'structure' || item.structure_kind !== undefined || item.grounded_claim_ids !== undefined) {
    const ids = item.grounded_claim_ids;
    const marker = item.structure_kind === 'list_marker';
    return item.reason === 'structure' && item.origin === 'automatic_classification' &&
      item.reviewer_id === undefined && item.reviewed_at === undefined && item.rationale === undefined &&
      (marker || item.structure_kind === 'coordination') &&
      (marker ? /^\s*\d+[.)]\s*$/.test(item.source_quote) : /^[\s,;:]*(?:and|or)[\s,;:]*$/i.test(item.source_quote)) &&
      Array.isArray(ids) && ids.length >= (marker ? 1 : 2) &&
      ids.every((id) => typeof id === 'string' && Boolean(id.trim())) && new Set(ids).size === ids.length;
  }
  if (item.origin === 'model_extraction' || item.origin === 'automatic_classification') {
    return ['heading', 'navigation', 'opinion'].includes(item.reason as string) &&
      item.reviewer_id === undefined && item.reviewed_at === undefined && item.rationale === undefined;
  }
  return (item.origin === undefined || item.origin === 'analyst_review') &&
    typeof item.rationale === 'string' && Boolean(item.rationale.trim()) &&
    typeof item.reviewer_id === 'string' && Boolean(item.reviewer_id.trim()) &&
    (item.reviewed_at === undefined || typeof item.reviewed_at === 'string');
}

function validateReviewPageBoundary(
  result: Record<string, unknown>, offsetKey: string, start: number,
  rows: number, totalKey: string, cursorKey: string,
): void {
  const echoed = result[offsetKey], total = result[totalKey], cursor = result[cursorKey];
  const known = total !== undefined && total !== null;
  const end = start + rows;
  if (!Number.isSafeInteger(end) || (echoed !== undefined && echoed !== null && echoed !== start) ||
      (known && (!Number.isSafeInteger(total) || (total as number) < 0 ||
        rows > Math.max(0, (total as number) - start))) ||
      (cursor !== undefined && cursor !== null &&
        (!Number.isSafeInteger(cursor) || rows === 0 || cursor !== end ||
          (known && (cursor as number) >= (total as number)))) ||
      (known && end < (total as number) && (cursor === undefined || cursor === null))) {
    throw new ToolFailure('invalid_api_output', `Stored review has an invalid ${cursorKey} page boundary`, {
      ...(creditUsage(result) ? { details: { credit_usage: creditUsage(result) } } : {}),
      actionable: 'Inspect the saved page and API response. Do not invent a continuation or repeat a chargeable review.',
    });
  }
}

function requireApiShape(valid: boolean, tool: string): void {
  if (!valid) throw new ToolFailure('invalid_api_output', `${tool} response is incomplete`, {
    actionable: 'Do not infer missing data from this response or repeat a chargeable call. Inspect the saved result and API response.',
  });
}

function requireString(args: Args, key: string): string {
  const value = args?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolFailure('invalid_argument', `${key} is required`, {
      details: { field: key },
      actionable: `Provide a non-empty string for ${key}.`,
    });
  }
  return value;
}

function savedClaimLabel(claim: Record<string, unknown>): string {
  return claim.result_state === 'duplicate' ? `duplicate of claim ${claim.duplicate_of_id} (not separately checked)`
        : claim.result_state === 'non_factual' ? 'non-factual (automatic classification)'
        : claim.result_state === 'result_saved'
        ? `saved, settlement pending${typeof claim.result === 'string' ? `: ${claim.result}` : ''}`
        : claim.result_state === 'failed' ? `failed, retryable${typeof claim.error_code === 'string' ? `: ${claim.error_code}` : ''}`
        : typeof claim.result === 'string' ? claim.result : 'unchecked';
}

function documentReviewJobOutput(result: Record<string, unknown>): ToolSuccess {
  const cap = result.max_account_credits;
  const statuses = ['queued', 'running', 'waiting_review', 'waiting_parse', 'complete', 'partial_coverage', 'credits_exhausted', 'failed', 'interrupted'];
  if (typeof result.job_id !== 'string' || !/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/.test(result.job_id) ||
      typeof result.status !== 'string' || !statuses.includes(result.status) ||
      (result.review_id !== undefined && typeof result.review_id !== 'string') ||
      (result.progress !== undefined && (!result.progress || typeof result.progress !== 'object' || Array.isArray(result.progress))))
    throw new ToolFailure('invalid_api_output', 'Document review job response is incomplete');
  if (cap !== undefined && (!Number.isSafeInteger(cap) || (cap as number) < 1 || (cap as number) > 2147483647))
    throw new ToolFailure('invalid_api_output', 'Document review job has an invalid max_account_credits. Enforcement is unknown; do not resubmit.', {
      details: { job_id: result.job_id, status: result.status,
        ...(result.credit_usage ? { credit_usage: result.credit_usage } : {}) },
      actionable: 'Inspect the existing job before further paid work.',
    });
  const progress = result.progress as Record<string, unknown> | undefined;
  for (const field of ['completed_claims', 'total_claims', 'material_claims', 'duplicate_claims',
    'pending_claims', 'failed_claims', 'rejected_claim_count', 'uncovered_source_span_count']) {
    if (progress?.[field] !== undefined && progress[field] !== null &&
        (!Number.isInteger(progress[field]) || (progress[field] as number) < 0))
      throw new ToolFailure('invalid_api_output', `Document review job has an invalid ${field} count`);
  }
  if (['complete', 'partial_coverage'].includes(result.status) &&
      (typeof result.review_id !== 'string' || !progress || progress.extraction_complete !== true ||
        progress.pending_claims !== 0 || progress.coverage_complete !== (result.status === 'complete')))
    throw new ToolFailure('invalid_api_output', 'Completed review job has inconsistent coverage or pending claims');
  const counts = progress ? ` Completed: ${progress.completed_claims ?? 'unknown'}/${progress.total_claims ?? 'unknown'} physical rows; material: ${progress.material_claims ?? 'unknown'}; duplicates: ${progress.duplicate_claims ?? 'unknown'}; pending (includes failed): ${progress.pending_claims ?? 'unknown'}; failed: ${progress.failed_claims ?? 'unknown'}; rejected: ${progress.rejected_claim_count ?? 'unknown'}; uncovered: ${progress.uncovered_source_span_count ?? 'unknown'}.` : '';
  for (const field of ['extraction_complete', 'source_read_complete', 'coverage_complete'])
    if (progress?.[field] !== undefined && progress[field] !== null && typeof progress[field] !== 'boolean')
      throw new ToolFailure('invalid_api_output', `Document review job has an invalid ${field} flag`);
  const gaps = progress ? ` Extraction complete: ${progress.extraction_complete ?? 'unknown'}; source read complete: ${progress.source_read_complete ?? 'unknown'}; source coverage complete: ${progress.coverage_complete ?? 'unknown'}.` : '';
  const next = result.review_id && !['queued', 'running', 'waiting_review', 'waiting_parse'].includes(result.status)
    ? `Call get_document_review with review_id ${result.review_id} for saved claim results.` : '';
  const active = ['queued', 'running', 'waiting_review', 'waiting_parse'].includes(result.status);
  const pollAfter = active ? Math.max(1000, Math.min(30000,
    typeof result.poll_after_ms === 'number' && Number.isFinite(result.poll_after_ms) && result.poll_after_ms > 0
      ? Math.ceil(result.poll_after_ms) : 30000)) : 0;
  const wait = active
    ? `Call get_document_review_job with job_id ${result.job_id} to check progress. Wait ${pollAfter} milliseconds before the next check, never more than 30 seconds. Do not estimate one long sleep from the remaining claim count. Stop polling on a terminal status. Do not repeatedly fetch unfinished result pages unless the user requests interim results.` : '';
  const error = typeof result.error === 'string' ? ` Error: ${result.error}` : '';
  if (result.retry_idempotency_key !== undefined && (typeof result.retry_idempotency_key !== 'string' ||
      result.retry_idempotency_key !== `review-retry:${result.job_id}` ||
      !['failed', 'interrupted', 'credits_exhausted'].includes(result.status)))
    throw new ToolFailure('invalid_api_output', 'Document review retry key is invalid');
  const retry = typeof result.retry_idempotency_key === 'string'
    ? `After resolving the failure, call review_document with the same inputs, retry_failed: true, and idempotency_key: ${result.retry_idempotency_key}.` : '';
  const output = { ...result, poll_after_ms: pollAfter };
  return { ...ok(`Document review job ${result.job_id}: ${result.status}.${cap !== undefined ? ` Account-credit cap for this execution: ${cap}.` : ''}${counts}${gaps}${error} ${next} ${wait} ${retry}`.trim(), output),
    isError: ['failed', 'interrupted', 'credits_exhausted'].includes(result.status), structuredContent: output };
}

function base64File(args: Args) {
  const encoded = requireString(args, 'file_base64');
  const filename = requireString(args, 'filename');
  if (encoded.length > 26_666_668 || encoded.length % 4 !== 0 ||
      encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0) > 20_000_000 ||
      /[^A-Za-z0-9+/=]/.test(encoded))
    throw new ToolFailure('invalid_argument', 'file_base64 must be valid base64 and at most 20 MB');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > 20_000_000 || bytes.toString('base64') !== encoded || filename.length > 255)
    throw new ToolFailure('invalid_argument', 'Upload must have a filename and 1 to 20 MB of content');
  const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const signatureOk = extension === 'pdf' ? bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))
    : ['docx', 'pptx', 'xlsx'].includes(extension ?? '') ? bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    : extension === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : ['jpg', 'jpeg'].includes(extension ?? '') ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    : extension === 'webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    : true;
  if (!signatureOk)
    throw new ToolFailure('invalid_argument', `Bytes do not match ${extension} file signature; supply original file bytes, not extracted text`);
  return { bytes, filename };
}

/**
 * Backend #268/#281: non-blank, non-padded wake identity.
 * Surrounding-whitespace ids (id !== trim) never wake — same honesty as W2 #276 / W3 #279.
 */
function wakeIdentityComplete(id: string): boolean {
  return typeof id === 'string' && id.trim().length > 0 && id === id.trim();
}

function reviewSpanInput(args: Args) {
  const reviewId = requireString(args, 'review_id');
  const assetId = requireString(args, 'asset_id');
  const start = args?.start;
  const end = args?.end;
  if (!wakeIdentityComplete(reviewId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId) ||
      !Number.isInteger(start) || !Number.isInteger(end) ||
      (start as number) < 0 || (end as number) <= (start as number))
    throw new ToolFailure('invalid_argument', 'Provide an exact review ID, asset UUID and increasing source offsets');
  return { reviewId, assetId, start: start as number, end: end as number };
}

/**
 * Backend #311: non-blank, non-padded ClaimScope filter text required to certify a
 * known scope pin. Surrounding whitespace (value !== trim) must not count as known —
 * equal pads must not look like a certified metric/period/entity match (same honesty
 * as W2 lookupNumber filter pads after #307).
 */
function seedFilterComplete(value: string): boolean {
  return value.trim().length > 0 && value === value.trim();
}

/**
 * Backend #314: non-blank, non-padded query text required to certify a lexical
 * selectPassage. Surrounding whitespace (value !== trim) must not count as known —
 * equal pads must not look like a certified topical hit (tokens() would otherwise
 * silently strip them). Same honesty as W2 resolveSeeds filter pads after #311.
 */
function selectTextComplete(value: string): boolean {
  return value.trim().length > 0 && value === value.trim();
}

/**
 * Backend #314: blank/whitespace or surrounding-padded query_context text never
 * certifies selectPassage seeds — refuse before HTTP so equal pads cannot
 * trim-launder into the same lexical hit as a clean query.
 */
function assertSelectTextComplete(text: unknown): asserts text is string {
  if (typeof text !== 'string' || !selectTextComplete(text)) {
    throw new ToolFailure(
      'invalid_argument',
      'text is incomplete (blank/whitespace/padded)',
      {
        details: { reason: 'padded_select_text', field: 'text' },
        actionable:
          'Blank/whitespace/padded query text never certifies a passage select; do not invent or trim-launder topical seeds.',
      },
    );
  }
}

/**
 * Backend #311/#314 surface: blank/whitespace or surrounding-padded
 * resolve_seeds text never certifies a seed hit — refuse before HTTP so equal
 * pads cannot trim-launder into the same candidate as a clean query (same
 * honesty as query_context selectPassage text).
 */
function assertResolveSeedsTextComplete(text: unknown): asserts text is string {
  if (typeof text !== 'string' || !selectTextComplete(text)) {
    throw new ToolFailure(
      'invalid_argument',
      'text is incomplete (blank/whitespace/padded)',
      {
        details: { reason: 'padded_resolve_text', field: 'text' },
        actionable:
          'Blank/whitespace/padded resolve text never certifies seeds; do not invent or trim-launder topical seeds.',
      },
    );
  }
}

/**
 * W3 create_evidence_packet: blank/whitespace or surrounding-padded claim_text
 * never seals into a certified packet assertion — refuse before HTTP so equal
 * pads cannot trim-launder into the same sealed claim as clean claim text
 * (same honesty as selectPassage #314 / resolve_seeds text #69).
 */
function assertClaimTextComplete(text: unknown): asserts text is string {
  if (typeof text !== 'string' || !selectTextComplete(text)) {
    throw new ToolFailure(
      'invalid_argument',
      'claim_text is incomplete (blank/whitespace/padded)',
      {
        details: { reason: 'padded_claim_text', field: 'claim_text' },
        actionable:
          'Blank/whitespace/padded claim_text never seals an evidence packet; do not invent or trim-launder a claim assertion.',
      },
    );
  }
}

/**
 * W3 create_evidence_packet: optional operator_class, when present as string,
 * blank/whitespace or surrounding-padded never seals into a certified operator
 * class — refuse before HTTP so equal pads cannot trim-launder into the same
 * sealed class as clean text (same honesty as claim_text #76 / binding snippet #81).
 * Restores #85 after #86 squash clobber.
 */
function assertOptionalOperatorClassComplete(operatorClass: unknown): void {
  // Optional: omit when not a string (same gate shape as binding snippet #81).
  if (typeof operatorClass !== 'string') return;
  if (!selectTextComplete(operatorClass)) {
    throw new ToolFailure(
      'invalid_argument',
      'operator_class is incomplete (blank/whitespace/padded)',
      {
        details: { reason: 'padded_operator_class', field: 'operator_class' },
        actionable:
          'Blank/whitespace/padded operator_class never seals an evidence packet; omit operator_class or pass non-blank unpadded text.',
      },
    );
  }
}

/**
 * C3 create_research_run: blank/whitespace or surrounding-padded objective
 * never certifies a research run purpose — refuse before HTTP so equal pads
 * cannot trim-launder into the same durable objective as clean text (same
 * honesty as claim_text #76 / selectPassage #314).
 */
function assertResearchObjectiveComplete(text: unknown): asserts text is string {
  if (typeof text !== 'string' || !selectTextComplete(text)) {
    throw new ToolFailure(
      'invalid_argument',
      'objective is incomplete (blank/whitespace/padded)',
      {
        details: { reason: 'padded_research_objective', field: 'objective' },
        actionable:
          'Blank/whitespace/padded objective never certifies a research run; do not invent or trim-launder a run purpose.',
      },
    );
  }
}

/**
 * Backend #311: blank/whitespace or surrounding-padded resolve_seeds filters are
 * dishonest constraints — never ignore them into a bare_term seed, and never
 * equal-pad-pin against a padded index scope. Refuse before HTTP.
 */
function assertResolveSeedsFiltersComplete(
  filters: Record<string, unknown> | undefined,
): void {
  if (!filters) return;
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === '' || value === 'unknown') continue;
    if (typeof value !== 'string' || !seedFilterComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `filters.${key} is incomplete (blank/whitespace/padded)`,
        {
          details: { reason: 'padded_resolve_filter', field: key },
          actionable:
            'Blank/whitespace/padded ClaimScope filters never pin seeds; do not invent or trim-launder a scope_tuple.',
        },
      );
    }
  }
}

/**
 * Backend #307: blank/whitespace or surrounding-padded query_context / lookupNumber
 * filters are dishonest constraints — never ignore them into a bind on remaining
 * fields, and never equal-pad-bind against a padded node scope. Refuse before HTTP.
 */
function assertLookupFiltersComplete(
  filters: Record<string, unknown> | undefined,
): void {
  if (!filters) return;
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === '' || value === 'unknown') continue;
    if (typeof value !== 'string' || !seedFilterComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `filters.${key} is incomplete (blank/whitespace/padded)`,
        {
          details: { reason: 'padded_lookup_filter', field: key },
          actionable:
            'Blank/whitespace/padded ClaimScope filters never bind a lookup_number; do not invent or trim-launder a certified match.',
        },
      );
    }
  }
}

/**
 * W2 query_context optional sources: blank/whitespace or surrounding-padded
 * source_texts / source_version_ids never materialize or pin a source scope —
 * equal pads must not trim-launder into the same certified hit as clean
 * aligned sources (same honesty as selectPassage text #314 / binding ids #264/#279).
 */
function assertQuerySourcesComplete(args: {
  source_texts?: unknown;
  source_version_ids?: unknown;
}): void {
  if (Array.isArray(args.source_texts)) {
    for (const [i, value] of args.source_texts.entries()) {
      if (typeof value !== 'string' || !selectTextComplete(value)) {
        throw new ToolFailure(
          'invalid_argument',
          `source_texts[${i}] is incomplete (blank/whitespace/padded)`,
          {
            details: { reason: 'padded_source_text', field: 'source_texts', index: i },
            actionable:
              'Blank/whitespace/padded source_texts never materialize a query source; do not invent or trim-launder topical text.',
          },
        );
      }
    }
  }
  if (Array.isArray(args.source_version_ids)) {
    for (const [i, value] of args.source_version_ids.entries()) {
      if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
        throw new ToolFailure(
          'invalid_argument',
          `source_version_ids[${i}] is incomplete (blank/whitespace/padded)`,
          {
            details: {
              reason: 'incomplete_source_version_identity',
              field: 'source_version_ids',
              index: i,
            },
            actionable:
              'Blank/whitespace/padded source_version_ids never pin a query source; do not invent or trim-launder a source hit.',
          },
        );
      }
    }
  }
}

/**
 * W2 A_SCOPE: blank/whitespace or surrounding-padded compare_assertions ClaimScope
 * fields never certify same/different — equal pads must not look like a certified
 * scope match (backend compareAssertions uses raw ===; never trim-launder).
 * Same honesty as resolve_seeds / query_context ClaimScope filter pads (#307/#311).
 */
function assertCompareScopeComplete(
  scope: Partial<ClaimScope>,
  side: 'left' | 'right',
): void {
  for (const [key, value] of Object.entries(scope)) {
    if (value == null || value === '' || value === 'unknown') continue;
    if (typeof value !== 'string' || !seedFilterComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `${side}.${key} is incomplete (blank/whitespace/padded)`,
        {
          details: { reason: 'padded_compare_filter', field: `${side}.${key}` },
          actionable:
            'Blank/whitespace/padded ClaimScope fields never certify a scope compare; do not invent or trim-launder a same/different hit.',
        },
      );
    }
  }
}

/**
 * Backend #268/#281: wait subjectId / subjectRevisionId must be non-blank/unpadded.
 * Equal blanks/pads must never look like a certified wake subject match.
 * null/undefined wait is fine (not waiting).
 */
function assertWakeSubjectComplete(wait: unknown, label: string): void {
  if (wait === null || wait === undefined) return;
  if (typeof wait !== 'object' || Array.isArray(wait)) {
    throw new ToolFailure('invalid_argument', `${label} must be an object or null`, {
      details: { reason: 'incomplete_wake_subject_identity' },
      actionable:
        'Pass wait:null or a WaitCondition with non-blank unpadded subjectId and subjectRevisionId.',
    });
  }
  const w = wait as Record<string, unknown>;
  for (const key of ['subjectId', 'subjectRevisionId'] as const) {
    const value = w[key];
    if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `${label}.${key} is incomplete (blank/whitespace/padded)`,
        {
          details: { reason: 'incomplete_wake_subject_identity', field: key },
          actionable:
            'Blank/whitespace/padded wake subject identity never matches; do not invent subject ids.',
        },
      );
    }
  }
}

/**
 * Backend #277/#281: when wait is set, scope.tenantId must be non-blank/unpadded.
 * Equal blank/padded tenants must never look like a certified wake tenant match.
 */
function assertWakeTenantComplete(run: ResearchRunPayload, label: string): void {
  if (run.wait === null || run.wait === undefined) return;
  const scope = run.scope;
  const tenantId =
    scope && typeof scope === 'object' && !Array.isArray(scope)
      ? (scope as Record<string, unknown>).tenantId
      : undefined;
  if (typeof tenantId !== 'string' || !wakeIdentityComplete(tenantId)) {
    throw new ToolFailure(
      'invalid_argument',
      `${label}.scope.tenantId is incomplete (blank/whitespace/padded)`,
      {
        details: { reason: 'incomplete_wake_tenant_identity', field: 'tenantId' },
        actionable:
          'Blank/whitespace/padded wake tenant identity never matches; do not invent tenant ids.',
      },
    );
  }
}

/**
 * Backend #288: list_research_runs is key-scoped only (no tenant arg). If a
 * client still passes tenant/tenant_id/tenantId, blank or surrounding-padded
 * values must not trim-launder into a certified list — refuse fail-closed.
 */
function assertListTenantArgHonesty(args: Args | undefined): void {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return;
  for (const key of ['tenantId', 'tenant_id', 'tenant'] as const) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) continue;
    const value = (args as Record<string, unknown>)[key];
    if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `list_research_runs.${key} is incomplete (blank/whitespace/padded)`,
        {
          details: { reason: 'incomplete_list_tenant_identity', field: key },
          actionable:
            'Tenant comes from the API key only; blank/padded tenant overrides never certify a list. Omit tenant args.',
        },
      );
    }
  }
}

const RESEARCH_SCOPE_KEYS = ['tenantId', 'userId', 'dealId', 'sessionId'] as const;

/**
 * Backend #297: ResearchScope ids must be non-blank/unpadded to certify
 * eligibleNote matches — equal pads must not look like a scoped memory hit.
 */
function assertResearchScopeComplete(
  scope: unknown,
  label: string,
): void {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new ToolFailure('invalid_argument', `${label} is incomplete (missing ResearchScope)`, {
      details: { reason: 'incomplete_eligible_note_identity' },
      actionable:
        'Pass a ResearchScope with non-blank unpadded tenantId, userId, dealId, and sessionId.',
    });
  }
  const s = scope as Record<string, unknown>;
  for (const key of RESEARCH_SCOPE_KEYS) {
    const value = s[key];
    if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `${label}.${key} is incomplete (blank/whitespace/padded)`,
        {
          details: { reason: 'incomplete_eligible_note_identity', field: key },
          actionable:
            'Blank/whitespace/padded note/scope identity never certifies eligible memory; do not invent or trim-launder.',
        },
      );
    }
  }
}

/**
 * Backend #297: blank/whitespace/padded MemoryNote id or ResearchScope fields
 * never certify eligibility — refuse before HTTP so equal pads cannot look
 * like a scoped memory match (same honesty as wake id-pad #281).
 */
function assertEligibleNotesComplete(run: ResearchRunPayload, label: string): void {
  const notes = (run as Record<string, unknown>).notes;
  if (notes === undefined || notes === null) return;
  if (!Array.isArray(notes)) {
    throw new ToolFailure('invalid_argument', `${label}.notes must be an array`, {
      details: { reason: 'incomplete_eligible_note_identity' },
      actionable: 'Pass notes as MemoryNote[] or omit; do not invent eligible memory.',
    });
  }
  if (notes.length === 0) return;
  assertResearchScopeComplete(run.scope, `${label}.scope`);
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    const nLabel = `${label}.notes[${i}]`;
    if (!note || typeof note !== 'object' || Array.isArray(note)) {
      throw new ToolFailure('invalid_argument', `${nLabel} must be an object`, {
        details: { reason: 'incomplete_eligible_note_identity', index: i },
        actionable: 'Pass complete MemoryNote rows; do not invent eligible memory.',
      });
    }
    const n = note as Record<string, unknown>;
    if (typeof n.id !== 'string' || !wakeIdentityComplete(n.id)) {
      throw new ToolFailure(
        'invalid_argument',
        `${nLabel}.id is incomplete (blank/whitespace/padded)`,
        {
          details: { reason: 'incomplete_eligible_note_identity', field: 'id', index: i },
          actionable:
            'Blank/whitespace/padded note id never certifies eligible memory; do not invent or trim-launder.',
        },
      );
    }
    assertResearchScopeComplete(n.scope, `${nLabel}.scope`);
  }
}

/**
 * Backend #304: blank/whitespace/padded loopStop requirement ids must not
 * certify insufficient_evidence / no_progress / max_steps / complete.
 */
function assertRequirementIdListComplete(
  ids: unknown,
  label: string,
  field: string,
): void {
  if (ids === undefined || ids === null) return;
  if (!Array.isArray(ids)) {
    throw new ToolFailure('invalid_argument', `${label} must be an array`, {
      details: { reason: 'incomplete_loop_requirement_identity', field },
      actionable:
        'Pass non-blank unpadded requirement ids; blank/padded ids never certify a loop stop.',
    });
  }
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id !== 'string' || !wakeIdentityComplete(id)) {
      throw new ToolFailure(
        'invalid_argument',
        `${label}[${i}] is incomplete (blank/whitespace/padded)`,
        {
          details: {
            reason: 'incomplete_loop_requirement_identity',
            field,
            index: i,
          },
          actionable:
            'Blank/whitespace/padded requirement ids never certify a loop stop; do not invent or trim-launder.',
        },
      );
    }
  }
}

/**
 * Backend #304: when progress is present, open/failed requirement ids must be
 * non-blank/unpadded — equal pads must not look like a certified loop stop.
 */
function assertLoopProgressComplete(run: ResearchRunPayload, label: string): void {
  const progress = (run as Record<string, unknown>).progress;
  if (progress === undefined || progress === null) return;
  if (typeof progress !== 'object' || Array.isArray(progress)) {
    throw new ToolFailure('invalid_argument', `${label}.progress must be an object`, {
      details: { reason: 'incomplete_loop_requirement_identity' },
      actionable:
        'Pass LoopProgress with non-blank unpadded openRequirementIds/failedRequirementIds.',
    });
  }
  const p = progress as Record<string, unknown>;
  assertRequirementIdListComplete(
    p.openRequirementIds,
    `${label}.progress.openRequirementIds`,
    'openRequirementIds',
  );
  assertRequirementIdListComplete(
    p.failedRequirementIds,
    `${label}.progress.failedRequirementIds`,
    'failedRequirementIds',
  );
}


/**
 * C3 research-run path ids: blank/whitespace/surrounding-padded run_id must
 * never trim-launder into a certified get/checkpoint/reserve hit (same
 * identityComplete rule as create identities #281 / sealed W3 ids #264/#279).
 */
function assertResearchRunIdComplete(runId: unknown): asserts runId is string {
  if (typeof runId !== 'string' || !wakeIdentityComplete(runId)) {
    throw new ToolFailure(
      'invalid_argument',
      'run_id is incomplete (blank/whitespace/padded)',
      {
        details: { reason: 'incomplete_research_run_identity', field: 'run_id' },
        actionable:
          'Blank/whitespace/padded run_id never certifies a research-run hit; do not invent or trim-launder a run lookup.',
      },
    );
  }
}

/**
 * W3 workflow path ids: blank/whitespace/surrounding-padded revision_id /
 * run_id / event_id must never trim-launder into a certified workflow hit
 * (same identityComplete rule as sealed W3 ids #264/#279 / research run_id).
 */
function assertWorkflowPathIdComplete(
  value: unknown,
  field: 'revision_id' | 'run_id' | 'event_id',
  reason:
    | 'incomplete_workflow_revision_identity'
    | 'incomplete_workflow_run_identity'
    | 'incomplete_workflow_event_identity',
): asserts value is string {
  if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
    throw new ToolFailure(
      'invalid_argument',
      `${field} is incomplete (blank/whitespace/padded)`,
      {
        details: { reason, field },
        actionable:
          `Blank/whitespace/padded ${field} never certifies a workflow hit; do not invent or trim-launder a path lookup.`,
      },
    );
  }
}

/**
 * W3 evaluation path ids: blank/whitespace/surrounding-padded run_id /
 * baseline_run_id / candidate_run_id / case_id must never trim-launder into a
 * certified evaluation hit (same identityComplete rule as workflow path ids
 * #74 / sealed W3 ids #264/#279).
 */
function assertEvalPathIdComplete(
  value: unknown,
  field: 'run_id' | 'baseline_run_id' | 'candidate_run_id' | 'case_id',
  reason: 'incomplete_evaluation_run_identity' | 'incomplete_evaluation_case_identity',
): asserts value is string {
  if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
    throw new ToolFailure(
      'invalid_argument',
      `${field} is incomplete (blank/whitespace/padded)`,
      {
        details: { reason, field },
        actionable:
          `Blank/whitespace/padded ${field} never certifies an evaluation hit; do not invent or trim-launder a path lookup.`,
      },
    );
  }
}

/**
 * C3/I4 EvidenceOperation path ids: blank/whitespace/surrounding-padded
 * operation_id must never trim-launder into a certified get/settle/release/
 * attempt hit (same identityComplete rule as research run_id #264/#279).
 */
function assertEvidenceOperationIdComplete(operationId: unknown): asserts operationId is string {
  if (typeof operationId !== 'string' || !wakeIdentityComplete(operationId)) {
    throw new ToolFailure(
      'invalid_argument',
      'operation_id is incomplete (blank/whitespace/padded)',
      {
        details: { reason: 'incomplete_operation_identity', field: 'operation_id' },
        actionable:
          'Blank/whitespace/padded operation_id never certifies an evidence-operation hit; do not invent or trim-launder an operation lookup.',
      },
    );
  }
}

/**
 * C3/I4: blank/whitespace/surrounding-padded idempotency_key / kind must never
 * trim-launder into a certified operation open/reserve/replay (same
 * identityComplete rule as root_idempotency_key on create_research_run /
 * operation_id #264/#279). Shared by open_operation_root (#83),
 * reserve_research_budget (#87), and reserve_operation.
 */
function assertOperationIdempotencyKindComplete(
  args: Args | undefined,
  missingRequiredMessage: string,
  actionableCertify: string,
): void {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolFailure('invalid_argument', missingRequiredMessage);
  }
  for (const key of ['idempotency_key', 'kind'] as const) {
    const value = (args as Record<string, unknown>)[key];
    const reason =
      key === 'idempotency_key'
        ? 'incomplete_operation_idempotency_identity'
        : 'incomplete_operation_kind_identity';
    if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `${key} is incomplete (blank/whitespace/padded)`,
        {
          details: { reason, field: key },
          actionable: `Blank/whitespace/padded ${key} never certifies ${actionableCertify}; do not invent or trim-launder a ${key} identity.`,
        },
      );
    }
  }
}

function assertOpenOperationRootIdentityComplete(args: Args | undefined): void {
  assertOperationIdempotencyKindComplete(
    args,
    'idempotency_key, kind, max_credits, max_tokens, and deadline_ms are required',
    'an operation root open/replay',
  );
}

/**
 * C3/I4 + W2/W3 optional idempotency_key: when present as string,
 * blank/whitespace/surrounding-padded never certifies a settle/link/attempt/
 * workflow publish-or-run / provider-cost / research create-or-checkpoint /
 * evaluation-compare / assess_support / compare_assertions /
 * find_contradictions / assess_meaning / formal_eligibility / query_context /
 * change-impact / formal_check / formal_resolution_state / resolve_fragment_uses /
 * number_inventory / resolve_seeds / create_claim_relation / expand_seeds /
 * create_metric_definition / claim_structure_tier /
 * claim_structure_resolve_definition replay pin — refuse before
 * HTTP (same identityComplete honesty as required open_operation_root /
 * reserve_operation idempotency_key after #83/#88). Shared by settle_operation
 * (#92), link_operation_consumer (#94), record/resolve_operation_attempt (#95),
 * publish_context_workflow / run_saved_workflow (#97), create_evidence_packet
 * (#98), get_provider_cost (#99), create/checkpoint_research_run (#100),
 * compare_evaluations (#101), assess_support (#102), find_contradictions (#104),
 * compare_assertions (#105), assess_meaning (#103), get_change_impact (#106),
 * formal_eligibility (#107), query_context (#108), formal_check (#110),
 * resolve_fragment_uses (#111), number_inventory (#112), formal_resolution_state
 * (#113), resolve_seeds (#114), create_claim_relation (#115), expand_seeds
 * (#116), create_metric_definition (#117), claim_structure_tier (#118), and
 * claim_structure_resolve_definition (C1/W3). Omit when not a string. Does not
 * trim or rewrite formal_check Lean source trailing newlines.
 */
function assertOptionalOperationIdempotencyKeyComplete(idempotencyKey: unknown): void {
  if (typeof idempotencyKey !== 'string') return;
  if (!wakeIdentityComplete(idempotencyKey)) {
    throw new ToolFailure(
      'invalid_argument',
      'idempotency_key is incomplete (blank/whitespace/padded)',
      {
        details: {
          reason: 'incomplete_operation_idempotency_identity',
          field: 'idempotency_key',
        },
        actionable:
          'Blank/whitespace/padded idempotency_key never certifies a settle/link/attempt/workflow/provider-cost/research/compare/assess_support/compare_assertions/find_contradictions/assess_meaning/formal_eligibility/query_context/change-impact/formal_check/formal_resolution_state/resolve_fragment_uses/number_inventory/resolve_seeds/create_claim_relation/expand_seeds/create_metric_definition/claim_structure_tier/claim_structure_resolve_definition replay pin; omit idempotency_key or pass a non-blank unpadded key.',
      },
    );
  }
}


/**
 * C3/I4 EvidenceAttempt path ids: blank/whitespace/surrounding-padded
 * attempt_id must never trim-launder into a certified resolve hit.
 */
function assertEvidenceAttemptIdComplete(attemptId: unknown): asserts attemptId is string {
  if (typeof attemptId !== 'string' || !wakeIdentityComplete(attemptId)) {
    throw new ToolFailure(
      'invalid_argument',
      'attempt_id is incomplete (blank/whitespace/padded)',
      {
        details: { reason: 'incomplete_attempt_identity', field: 'attempt_id' },
        actionable:
          'Blank/whitespace/padded attempt_id never certifies an evidence-attempt hit; do not invent or trim-launder an attempt lookup.',
      },
    );
  }
}

/**
 * C3/I4 record_operation_attempt: blank/whitespace/surrounding-padded provider
 * (required) and optional string model / provider_idempotency_key must never
 * trim-launder into a certified attempt attribution or provider replay pin
 * (same identityComplete honesty as consumer_kind #264/#279 / operation kind #83).
 * null model / provider_idempotency_key remain allowed.
 */
function assertRecordOperationAttemptProviderComplete(args: Args | undefined): void {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new ToolFailure('invalid_argument', 'operation_id and provider are required');
  }
  const provider = (args as Record<string, unknown>).provider;
  if (typeof provider !== 'string' || !wakeIdentityComplete(provider)) {
    throw new ToolFailure(
      'invalid_argument',
      'provider is incomplete (blank/whitespace/padded)',
      {
        details: { reason: 'incomplete_attempt_provider_identity', field: 'provider' },
        actionable:
          'Blank/whitespace/padded provider never certifies an evidence attempt; do not invent or trim-launder provider attribution.',
      },
    );
  }
  const model = (args as Record<string, unknown>).model;
  if (typeof model === 'string' && !wakeIdentityComplete(model)) {
    throw new ToolFailure(
      'invalid_argument',
      'model is incomplete (blank/whitespace/padded)',
      {
        details: { reason: 'incomplete_attempt_model_identity', field: 'model' },
        actionable:
          'Blank/whitespace/padded model never certifies an evidence attempt; omit model, pass null, or pass non-blank unpadded text.',
      },
    );
  }
  const providerIdempotencyKey = (args as Record<string, unknown>).provider_idempotency_key;
  if (
    typeof providerIdempotencyKey === 'string' &&
    !wakeIdentityComplete(providerIdempotencyKey)
  ) {
    throw new ToolFailure(
      'invalid_argument',
      'provider_idempotency_key is incomplete (blank/whitespace/padded)',
      {
        details: {
          reason: 'incomplete_attempt_provider_idempotency_identity',
          field: 'provider_idempotency_key',
        },
        actionable:
          'Blank/whitespace/padded provider_idempotency_key never certifies a provider replay pin; omit it, pass null, or pass non-blank unpadded text.',
      },
    );
  }
}

/**
 * C3/I4 resolve_operation_attempt: blank/whitespace/surrounding-padded
 * optional string failure_class and price.amount / currency / priceRevision
 * must never trim-launder into a certified attempt outcome class or priced
 * settlement pin (same identityComplete honesty as provider/model #89).
 * null failure_class / null price remain allowed; omit price to leave cost
 * unknown (never invent zero).
 */
function assertResolveOperationAttemptOutcomeComplete(args: Args | undefined): void {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return;
  }
  const failureClass = (args as Record<string, unknown>).failure_class;
  if (typeof failureClass === 'string' && !wakeIdentityComplete(failureClass)) {
    throw new ToolFailure(
      'invalid_argument',
      'failure_class is incomplete (blank/whitespace/padded)',
      {
        details: {
          reason: 'incomplete_attempt_failure_class_identity',
          field: 'failure_class',
        },
        actionable:
          'Blank/whitespace/padded failure_class never certifies an attempt outcome class; omit it, pass null, or pass non-blank unpadded text.',
      },
    );
  }
  const price = (args as Record<string, unknown>).price;
  if (price === null || price === undefined) {
    return;
  }
  if (typeof price !== 'object' || Array.isArray(price)) {
    return;
  }
  const priceObj = price as Record<string, unknown>;
  for (const key of ['amount', 'currency', 'priceRevision'] as const) {
    const value = priceObj[key];
    if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `price.${key} is incomplete (blank/whitespace/padded)`,
        {
          details: {
            reason: 'incomplete_attempt_price_identity',
            field: `price.${key}`,
          },
          actionable:
            'Blank/whitespace/padded price fields never certify an attempt settlement pin; omit price, pass null, or pass non-blank unpadded amount/currency/priceRevision.',
        },
      );
    }
  }
}

/**
 * C3/I4 consumer link/usage ids: blank/whitespace/surrounding-padded
 * consumer_kind / consumer_id must never trim-launder into a certified
 * consumer link or usage aggregate (same identityComplete rule as
 * operation_id #264/#279).
 */
function assertEvidenceConsumerIdentityComplete(args: {
  consumer_kind?: unknown;
  consumer_id?: unknown;
}): void {
  for (const key of ['consumer_kind', 'consumer_id'] as const) {
    const value = args[key];
    if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `${key} is incomplete (blank/whitespace/padded)`,
        {
          details: { reason: 'incomplete_consumer_identity', field: key },
          actionable:
            'Blank/whitespace/padded consumer identity never certifies a consumer link or usage hit; do not invent or trim-launder.',
        },
      );
    }
  }
}


/**
 * W3 resolve_fragment_uses: blank/whitespace/surrounding-padded
 * selector.representationId must never trim-launder into a certified fragment
 * match (backend evidenceId / FragmentSelector — same honesty as sealed
 * packet_id / answer_revision_id pads and binding representation_id #264/#279).
 */
function assertFragmentSelectorRepresentationComplete(selector: unknown): void {
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    return;
  }
  const representationId = (selector as Record<string, unknown>).representationId;
  if (typeof representationId !== 'string' || !wakeIdentityComplete(representationId)) {
    throw new ToolFailure(
      'invalid_argument',
      'selector.representationId is incomplete (blank/whitespace/padded)',
      {
        details: {
          reason: 'incomplete_representation_identity',
          field: 'representationId',
        },
        actionable:
          'Blank/whitespace/padded representationId never certifies a fragment use; do not invent or trim-launder a representation hit.',
      },
    );
  }
}

/**
 * C2 expand_seeds: blank/whitespace/surrounding-padded seed / edge / allowed
 * graph ids must never trim-launder into a certified authorized expansion
 * (same identityComplete honesty as resolve_seeds #311 / W3 #264/#279).
 */
function assertExpandSeedGraphComplete(args: {
  seeds: unknown;
  edges: unknown;
  allowed: unknown;
}): void {
  const reason = 'incomplete_expand_seed_identity';
  const actionable =
    'Blank/whitespace/padded expand graph ids never certify an authorized expansion; do not invent or trim-launder seed/edge/allowed ids.';

  const seeds = args.seeds;
  if (!Array.isArray(seeds)) {
    throw new ToolFailure('invalid_argument', 'seeds must be an array', {
      details: { reason, field: 'seeds' },
      actionable,
    });
  }
  for (let i = 0; i < seeds.length; i++) {
    const id = seeds[i];
    if (typeof id !== 'string' || !wakeIdentityComplete(id)) {
      throw new ToolFailure(
        'invalid_argument',
        `seeds[${i}] is incomplete (blank/whitespace/padded)`,
        {
          details: { reason, field: 'seeds', index: i },
          actionable,
        },
      );
    }
  }

  const allowed = args.allowed;
  if (!Array.isArray(allowed)) {
    throw new ToolFailure('invalid_argument', 'allowed must be an array', {
      details: { reason, field: 'allowed' },
      actionable,
    });
  }
  for (let i = 0; i < allowed.length; i++) {
    const id = allowed[i];
    if (typeof id !== 'string' || !wakeIdentityComplete(id)) {
      throw new ToolFailure(
        'invalid_argument',
        `allowed[${i}] is incomplete (blank/whitespace/padded)`,
        {
          details: { reason, field: 'allowed', index: i },
          actionable,
        },
      );
    }
  }

  const edges = args.edges;
  if (!Array.isArray(edges)) {
    throw new ToolFailure('invalid_argument', 'edges must be an array', {
      details: { reason, field: 'edges' },
      actionable,
    });
  }
  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      throw new ToolFailure(
        'invalid_argument',
        `edges[${i}] must be an object with from/to`,
        {
          details: { reason, field: 'edges', index: i },
          actionable,
        },
      );
    }
    const row = edge as Record<string, unknown>;
    for (const key of ['from', 'to'] as const) {
      const id = row[key];
      if (typeof id !== 'string' || !wakeIdentityComplete(id)) {
        throw new ToolFailure(
          'invalid_argument',
          `edges[${i}].${key} is incomplete (blank/whitespace/padded)`,
          {
            details: { reason, field: `edges.${key}`, index: i },
            actionable,
          },
        );
      }
    }
  }
}

/**
 * W3 resolve_fragment_uses allow-list: blank/whitespace/surrounding-padded
 * allowed_fragment_ids must never trim-launder into a certified authorization
 * pin (same identityComplete honesty as expand_seeds allowed #68).
 */
function assertAllowedFragmentIdsComplete(ids: unknown): asserts ids is string[] {
  const reason = 'incomplete_allowed_fragment_identity';
  const actionable =
    'Blank/whitespace/padded allowed_fragment_ids never certify an authorized fragment use; do not invent or trim-launder allow-list hits.';
  if (!Array.isArray(ids)) {
    throw new ToolFailure('invalid_argument', 'allowed_fragment_ids must be an array', {
      details: { reason, field: 'allowed_fragment_ids' },
      actionable,
    });
  }
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (typeof id !== 'string' || !wakeIdentityComplete(id)) {
      throw new ToolFailure(
        'invalid_argument',
        `allowed_fragment_ids[${i}] is incomplete (blank/whitespace/padded)`,
        {
          details: { reason, field: 'allowed_fragment_ids', index: i },
          actionable,
        },
      );
    }
  }
}

/**
 * C1 claim-relation predicate: blank/whitespace/surrounding-padded predicate
 * must never trim-launder into a certified catalog create/list/formalize
 * (same identityComplete honesty as argument_ids / claim_revision_id #75 and
 * operation kind #83/#88). Equal pads must not look like a recognised predicate.
 */
function assertClaimRelationPredicateComplete(
  predicate: unknown,
): asserts predicate is string {
  if (typeof predicate !== 'string' || !wakeIdentityComplete(predicate)) {
    throw new ToolFailure(
      'invalid_argument',
      'predicate is incomplete (blank/whitespace/padded)',
      {
        details: {
          reason: 'incomplete_claim_predicate_identity',
          field: 'predicate',
        },
        actionable:
          'Blank/whitespace/padded predicate never certifies a claim-relation; do not invent or trim-launder a predicate identity.',
      },
    );
  }
}

/**
 * C1 list_claim_relations: optional predicate, when present as string,
 * blank/whitespace/surrounding-padded never trim-launders into a certified
 * catalog filter (same honesty as optional claim_revision_id #75).
 */
function assertOptionalClaimRelationPredicateComplete(
  predicate: unknown,
): string | undefined {
  if (typeof predicate !== 'string') {
    return undefined;
  }
  assertClaimRelationPredicateComplete(predicate);
  return predicate;
}

/**
 * C1 claim-relation argument / claim_revision ids: blank/whitespace/surrounding-
 * padded argument_ids or claim_revision_id must never trim-launder into a
 * certified catalog create/list/formalize (same identityComplete honesty as
 * expand_seeds #68 / assess_support claim ids / W3 #264/#279).
 */
function assertClaimRelationArgumentIdsComplete(argumentIds: unknown): asserts argumentIds is string[] {
  const reason = 'incomplete_claim_argument_identity';
  const actionable =
    'Blank/whitespace/padded claim-relation argument_ids never certify a relation; do not invent or trim-launder argument hits.';
  if (!Array.isArray(argumentIds) || argumentIds.length === 0) {
    throw new ToolFailure('invalid_argument', 'argument_ids must be a non-empty array', {
      details: { reason, field: 'argument_ids' },
      actionable,
    });
  }
  for (let i = 0; i < argumentIds.length; i++) {
    const id = argumentIds[i];
    if (typeof id !== 'string' || !wakeIdentityComplete(id)) {
      throw new ToolFailure(
        'invalid_argument',
        `argument_ids[${i}] is incomplete (blank/whitespace/padded)`,
        {
          details: { reason, field: 'argument_ids', index: i },
          actionable,
        },
      );
    }
  }
}

function assertOptionalClaimRevisionIdComplete(
  value: unknown,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
    throw new ToolFailure(
      'invalid_argument',
      'claim_revision_id is incomplete (blank/whitespace/padded)',
      {
        details: {
          reason: 'incomplete_claim_revision_identity',
          field: 'claim_revision_id',
        },
        actionable:
          'Blank/whitespace/padded claim_revision_id never certifies a claim-relation hit; do not invent or trim-launder a revision hit.',
      },
    );
  }
  return value;
}

/**
 * Backend createRunSchema / researchScopeSchema use evidenceId: blank or
 * surrounding-padded snapshot/workflow/deal/session/root identities never
 * certify a research run (same id-pad honesty as wake #281 / eligibleNote #297 /
 * loopStop #304). Equal pads must not trim-launder into a sealed create.
 */
function assertCreateResearchIdentityComplete(args: Args | undefined): void {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return;
  const required = ['snapshot_id', 'workflow_version'] as const;
  for (const key of required) {
    const value = (args as Record<string, unknown>)[key];
    if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `create_research_run.${key} is incomplete (blank/whitespace/padded)`,
        {
          details: { reason: 'incomplete_create_research_identity', field: key },
          actionable:
            'Pass non-blank unpadded snapshot_id and workflow_version; blank/padded ids never certify a research create.',
        },
      );
    }
  }
  for (const key of ['deal_id', 'session_id', 'root_idempotency_key'] as const) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) continue;
    const value = (args as Record<string, unknown>)[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        `create_research_run.${key} is incomplete (blank/whitespace/padded)`,
        {
          details: { reason: 'incomplete_create_research_identity', field: key },
          actionable:
            'Omit or pass non-blank unpadded deal/session/root identities; blank/padded ids never certify a research scope.',
        },
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(args, 'root_operation_id')) {
    const value = (args as Record<string, unknown>).root_operation_id;
    if (value === undefined || value === null) {
      // null means auto-open root — allowed
    } else if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
      throw new ToolFailure(
        'invalid_argument',
        'create_research_run.root_operation_id is incomplete (blank/whitespace/padded)',
        {
          details: {
            reason: 'incomplete_create_research_identity',
            field: 'root_operation_id',
          },
          actionable:
            'Pass null to auto-open, or a non-blank unpadded root_operation_id; pads never certify a shared root.',
        },
      );
    }
  }
}

function assetRef(args: Args): AssetRefOptions {
  const assetId = args?.asset_id;
  const assetUrl = args?.asset_url;
  if ((assetId !== undefined && (typeof assetId !== 'string' || !assetId.trim())) ||
      (assetUrl !== undefined && (typeof assetUrl !== 'string' || !assetUrl.trim())) ||
      (!assetId && !assetUrl)) {
    throw new ToolFailure(
      'invalid_argument',
      'provide either asset_id (uploaded file) or asset_url (direct file URL)',
      { actionable: 'Pass asset_id from upload_file, or a direct asset_url.' },
    );
  }
  return { asset_id: assetId as string | undefined, asset_url: assetUrl as string | undefined };
}

function verifyOptions(args: Args): VerifyClaimOptions {
  const sourceUrls = args?.source_urls;
  if (sourceUrls !== undefined &&
      (!Array.isArray(sourceUrls) || sourceUrls.length > 5 ||
       sourceUrls.some((url) => typeof url !== 'string' || !url.startsWith('https://'))))
    throw new ToolFailure('invalid_argument', 'source_urls must contain at most five public HTTPS URLs');
  return {
    claim: requireString(args, 'claim'),
    source_urls: sourceUrls as string[] | undefined,
    filters: args?.filters as SourceFilters | undefined,
    thread_id: args?.thread_id as string | undefined,
    include_stance: args?.include_stance !== false,
    include_verdict: args?.include_verdict !== false,
    use_claim_decomposition: args?.decompose_claim === true,
  };
}

// Matches the pre-1.3.0 behaviour: 0, NaN and a non-number all fall back to the default.
function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) && value !== 0 ? value : fallback;
  return Math.min(Math.max(n, min), max);
}

function asScope(value: unknown, field: string): Partial<ClaimScope> {
  if (value === undefined || value === null) {
    throw new ToolFailure('invalid_argument', `${field} is required`, {
      details: { field },
      actionable: `Provide a claim-scope object for ${field}.`,
    });
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolFailure('invalid_argument', `${field} must be an object`, {
      details: { field },
      actionable: `Pass a claim-scope object for ${field}.`,
    });
  }
  return value as Partial<ClaimScope>;
}

function wrapApi<T>(promise: Promise<T>): Promise<T> {
  return promise.catch((error: unknown) => {
    if (error instanceof ApiClientError) throw error.toToolFailure();
    throw error;
  });
}

export const handlers: Record<string, ToolHandler> = {
  webcite_guide: async (args, _client) => {
    return ok(
      renderWebciteGuide({
        workflow: args?.workflow,
        question: args?.question,
      }),
    );
  },

  get_credit_balance: async (_args, client) => {
    const result = await wrapApi(client.getCreditBalance());
    const credits = result.credits as Record<string, unknown> | undefined;
    if (!credits || typeof credits.remaining !== 'number' || typeof credits.used !== 'number' || typeof credits.total !== 'number') {
      throw new ToolFailure('invalid_api_output', 'Credit balance response is incomplete');
    }
    const balance = {
      credits,
      ...(result.usage_breakdown && typeof result.usage_breakdown === 'object' ? { usage_breakdown: result.usage_breakdown } : {}),
      ...(typeof result.allow_overage === 'boolean' ? { allow_overage: result.allow_overage } : {}),
      ...(typeof result.billing_period_end === 'string' ? { billing_period_end: result.billing_period_end } : {}),
    };
    return ok(`Credits remaining: ${credits.remaining} of ${credits.total} (used: ${credits.used}).${result.allow_overage === true ? ' Overage is enabled.' : ' Overage is off or unavailable.'}`, balance);
  },

  get_review_source_span: async (args, client) => {
    const { reviewId, assetId, start, end } = reviewSpanInput(args);
    const result = await wrapApi(client.getDocumentReviewSourceSpan(reviewId, assetId, start, end));
    if (result.asset_id !== assetId || result.start !== start || result.end !== end ||
        !['heading', 'table_title', 'navigation'].includes(String(result.role)) || typeof result.block_id !== 'string' ||
        typeof result.role_basis !== 'string' || typeof result.source_quote !== 'string' ||
        result.source_quote.length !== end - start || result.source_quote.length > 16_000)
      throw new ToolFailure('invalid_api_output', 'Saved source span lacks exact structural proof');
    return ok(`Exact source passage for review ${reviewId}, asset ${assetId}, offsets ${start}-${end}, role ${result.role}:\n${result.source_quote}\nInspect the entire passage. Structural role does not prove this is nonclaim.`, result);
  },

  record_review_nonclaim: async (args, client) => {
    const { reviewId, assetId, start, end } = reviewSpanInput(args);
    const sourceQuote = requireString(args, 'source_quote');
    const rationale = requireString(args, 'rationale');
    if (sourceQuote.length !== end - start || sourceQuote.length > 16_000 ||
        rationale.trim().length < 10 || rationale.length > 1_000)
      throw new ToolFailure('invalid_argument', 'Provide the exact source quote and a 10 to 1000 character rationale');
    const result = await wrapApi(client.recordDocumentReviewNonclaim(reviewId, {
      asset_id: assetId, start, end, source_quote: sourceQuote, rationale,
    }));
    if (result.asset_id !== assetId || result.start !== start || result.end !== end ||
        result.source_quote !== sourceQuote || result.rationale !== rationale ||
        typeof result.reviewer_id !== 'string' || typeof result.reviewed_at !== 'string')
      throw new ToolFailure('invalid_api_output', 'Nonclaim disposition response is incomplete');
    return ok(`Recorded explicit nonclaim disposition for review ${reviewId}, asset ${assetId}, offsets ${start}-${end}. Re-read get_document_review for updated coverage.`, result);
  },

  revise_document_claim_analysis: async (args, client) => {
    const reviewId = requireString(args, 'review_id');
    const claimId = requireString(args, 'claim_id');
    const hash = requireString(args, 'original_result_hash');
    if (!wakeIdentityComplete(reviewId) || !wakeIdentityComplete(claimId) || !/^[a-f0-9]{64}$/.test(hash))
      throw new ToolFailure('invalid_argument', 'Use exact saved review/claim IDs and original_result_hash');
    const result = await wrapApi(client.reviseDocumentClaimAnalysis(reviewId, claimId, hash));
    if (result.review_id !== reviewId || result.claim_id !== claimId)
      throw new ToolFailure('invalid_api_output', 'Saved analysis revision identity differs');
    const revision = validateAnalysisRevision(result.analysis_revision, hash);
    const text = `Saved analysis revision ${revision.id}: ${revision.claim_result.verdict}. ${revision.claim_result.summary}\nBasis: retained snippets, policy ${revision.policy_version}, assessment ${revision.assessment_status}. Original result and credit receipt preserved; no new research, model calls or credits.`;
    const output = ok(text, result);
    if (Buffer.byteLength(JSON.stringify(output)) <= REVIEW_RESPONSE_MAX_BYTES) return output;
    const { citations, ...summary } = revision;
    return ok(text + '\nRetained citations exceed the tool response limit; full evidence remains saved in Webcite.', {
      review_id: reviewId, claim_id: claimId, analysis_revision_summary: summary,
      retained_citation_count: citations.length, citations_omitted: true,
    });
  },

  get_document_review: async (args, client, signal) => {
    const reviewId = requireString(args, 'review_id');
    if (!wakeIdentityComplete(reviewId)) throw new ToolFailure('invalid_argument', 'review_id cannot have surrounding whitespace');
    const offset = args?.offset ?? 0;
    const limit = args?.limit ?? 50;
    const gapOffset = args?.gap_offset ?? 0;
    const gapLimit = args?.gap_limit ?? 20;
    const rejectedOffset = args?.rejected_offset ?? 0;
    const rejectedLimit = args?.rejected_limit ?? 20;
    const dispositionOffset = args?.disposition_offset ?? 0;
    const dispositionLimit = args?.disposition_limit ?? 20;
    if (!Number.isSafeInteger(offset) || (offset as number) < 0 || !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 100) {
      throw new ToolFailure('invalid_argument', 'offset must be >= 0 and page limit must be 1 to 100');
    }
    if (!Number.isSafeInteger(gapOffset) || (gapOffset as number) < 0 ||
        !Number.isInteger(gapLimit) || (gapLimit as number) < 1 || (gapLimit as number) > 100)
      throw new ToolFailure('invalid_argument', 'gap_offset must be >= 0 and gap_limit must be 1 to 100');
    if (!Number.isSafeInteger(rejectedOffset) || (rejectedOffset as number) < 0 ||
        !Number.isInteger(rejectedLimit) || (rejectedLimit as number) < 1 || (rejectedLimit as number) > 100)
      throw new ToolFailure('invalid_argument', 'rejected_offset must be >= 0 and rejected_limit must be 1 to 100');
    if (!Number.isSafeInteger(dispositionOffset) || (dispositionOffset as number) < 0 ||
        !Number.isInteger(dispositionLimit) || (dispositionLimit as number) < 1 || (dispositionLimit as number) > 100)
      throw new ToolFailure('invalid_argument', 'disposition_offset must be >= 0 and disposition_limit must be 1 to 100');
    const result = await wrapApi(client.getDocumentReview(reviewId, offset as number, limit as number,
      gapOffset as number, gapLimit as number, rejectedOffset as number, rejectedLimit as number,
      dispositionOffset as number, dispositionLimit as number, signal));
    if (result.review_id !== reviewId || !Array.isArray(result.claims) ||
        !Number.isInteger(result.total_claims) || !Number.isInteger(result.completed_claims) ||
        !Number.isInteger(result.pending_claims) || typeof result.status !== 'string' ||
        typeof result.prompt !== 'string' || typeof result.thread_id !== 'string' ||
        !Array.isArray(result.asset_ids)) {
      throw new ToolFailure('invalid_api_output', 'Stored document review is incomplete');
    }
    const resumeInput: ReviewDocumentOptions = {
      prompt: result.prompt, asset_ids: result.asset_ids as string[], thread_id: result.thread_id,
      ...(result.review_scope === 'full' || result.review_scope === 'focused'
        ? { review_scope: result.review_scope } : {}),
      ...(Array.isArray(result.source_urls) ? { source_urls: result.source_urls as string[] } : {}),
      ...(result.source_filters && typeof result.source_filters === 'object' && !Array.isArray(result.source_filters)
        ? { filters: result.source_filters as SourceFilters } : {}),
      ...(typeof result.use_stance_analysis === 'boolean' ? { include_stance: result.use_stance_analysis } : {}),
      ...(typeof result.use_verdict === 'boolean' ? { include_verdict: result.use_verdict } : {}),
    };
    const claims = result.claims as Array<Record<string, unknown>>;
    if (Number.isInteger(result.uncovered_source_span_count) && (result.uncovered_source_span_count as number) > 0 &&
        !Array.isArray(result.uncovered_source_spans))
      throw new ToolFailure('invalid_api_output', 'Stored review omitted uncovered source spans');
    const gaps = Array.isArray(result.uncovered_source_spans)
      ? result.uncovered_source_spans as Array<Record<string, unknown>> : [];
    if (gaps.some((gap) => typeof gap.asset_id !== 'string' || !Number.isInteger(gap.start) ||
        !Number.isInteger(gap.end) || typeof gap.preview !== 'string'))
      throw new ToolFailure('invalid_api_output', 'Stored review has an invalid uncovered source span');
    const gapRows = gaps.map((gap, index) =>
      `- Uncovered passage ${(gapOffset as number) + index + 1}: asset ${gap.asset_id}, offsets ${gap.start}-${gap.end}${typeof gap.role === 'string' ? `, role ${gap.role}` : ''}: ${gap.preview}`);
    const nextGap = Number.isInteger(result.next_gap_offset)
      ? `\nNext gap offset: ${result.next_gap_offset} (use gap_offset and gap_limit)` : '';
    if (Number.isInteger(result.rejected_claim_count) && (result.rejected_claim_count as number) > 0 &&
        !Array.isArray(result.rejected_claims))
      throw new ToolFailure('invalid_api_output', 'Stored review omitted rejected claim candidates');
    const rejected = Array.isArray(result.rejected_claims)
      ? result.rejected_claims as Array<Record<string, unknown>> : [];
    if (rejected.some((item) => typeof item.claim !== 'string' || typeof item.reason !== 'string'))
      throw new ToolFailure('invalid_api_output', 'Stored review has an invalid rejected claim candidate');
    if (Number.isInteger(result.rejected_claim_count) &&
        (result.rejected_claim_count as number) > (rejectedOffset as number) + rejected.length &&
        !Number.isInteger(result.next_rejected_offset))
      throw new ToolFailure('invalid_api_output', 'Stored review omitted rejected candidate cursor');
    const rejectedCount = Number.isInteger(result.rejected_claim_count)
      ? `\nRejected claim candidates: ${result.rejected_claim_count}.` : '';
    const rejectedRows = rejected.map((item, index) =>
      `- Rejected candidate ${(rejectedOffset as number) + index + 1}: ${item.claim} (reason: ${item.reason})`);
    const nextRejected = Number.isInteger(result.next_rejected_offset)
      ? `\nNext rejected offset: ${result.next_rejected_offset} (use rejected_offset and rejected_limit)` : '';
    if (Number.isInteger(result.nonclaim_disposition_count) && (result.nonclaim_disposition_count as number) > 0 &&
        !Array.isArray(result.nonclaim_dispositions))
      throw new ToolFailure('invalid_api_output', 'Stored review omitted nonclaim dispositions');
    const dispositions = Array.isArray(result.nonclaim_dispositions)
      ? result.nonclaim_dispositions as Array<Record<string, unknown>> : [];
    validateReviewPageBoundary(result, 'offset', offset as number, claims.length, 'total_claims', 'next_offset');
    validateReviewPageBoundary(result, 'gap_offset', gapOffset as number, gaps.length, 'uncovered_source_span_count', 'next_gap_offset');
    validateReviewPageBoundary(result, 'rejected_offset', rejectedOffset as number, rejected.length, 'rejected_claim_count', 'next_rejected_offset');
    validateReviewPageBoundary(result, 'disposition_offset', dispositionOffset as number, dispositions.length, 'nonclaim_disposition_count', 'next_disposition_offset');
    if (dispositions.some((item) => !validReviewDisposition(item)))
      throw new ToolFailure('invalid_api_output', 'Stored review has an invalid nonclaim disposition');
    if (Number.isInteger(result.nonclaim_disposition_count) &&
        (result.nonclaim_disposition_count as number) > (dispositionOffset as number) + dispositions.length &&
        !Number.isInteger(result.next_disposition_offset))
      throw new ToolFailure('invalid_api_output', 'Stored review omitted nonclaim disposition cursor');
    const dispositionRows = dispositions.map((item, index) =>
      `- Nonclaim disposition ${(dispositionOffset as number) + index + 1}: asset ${item.asset_id}, offsets ${item.start}-${item.end}, ${item.origin === 'model_extraction' || item.origin === 'automatic_classification'
        ? `${item.origin === 'model_extraction' ? 'model extraction' : 'automatic classification'} (${item.reason}${item.reason === 'structure' ? `/${item.structure_kind}` : ''}): ${JSON.stringify(item.source_quote)}${item.reason === 'structure' ? `; grounded claims: ${(item.grounded_claim_ids as string[]).join(', ')}` : ''}`
        : `reviewer ${item.reviewer_id}: ${item.rationale}`}`);
    const nextDisposition = Number.isInteger(result.next_disposition_offset)
      ? `\nNext disposition offset: ${result.next_disposition_offset} (use disposition_offset and disposition_limit)` : '';
    const rows = claims.map((claim, index) => {
      validateSavedRevision(claim);
      if (typeof claim.id !== 'string' || typeof claim.claim !== 'string') {
        throw new ToolFailure('invalid_api_output', 'Stored document review has an invalid claim');
      }
      if (claim.result_state === 'non_factual' &&
          (claim.classification_origin !== 'automatic_classification' ||
           !['heading', 'navigation', 'opinion'].includes(claim.classification_reason as string) ||
           ['result', 'verdict', 'confidence', 'citation_id', 'credits_used', 'credits_charged'].some((key) =>
             claim[key] !== undefined && claim[key] !== null)))
        throw new ToolFailure('invalid_api_output', 'Stored non-factual claim has invalid classification provenance');
      const canonical = claims[(claim.duplicate_of_index as number) - (offset as number)];
      if (claim.result_state === 'duplicate' &&
          (!Number.isInteger(claim.duplicate_of_index) || (claim.duplicate_of_index as number) < 0 ||
           (claim.duplicate_of_index as number) >= (offset as number) + index ||
           typeof claim.duplicate_of_id !== 'string' || !claim.duplicate_of_id.trim() || claim.duplicate_of_id === claim.id ||
           (claim.original_claim_id !== undefined && claim.original_claim_id !== null &&
             claim.original_claim_id !== claim.duplicate_of_id) ||
           claim.duplicate_reason !== 'same_source_assertion' ||
           (canonical && (canonical.id !== claim.duplicate_of_id || canonical.result_state === 'duplicate')) ||
           ['result', 'verdict', 'confidence', 'citation_id', 'credits_used', 'credits_charged', 'operation_id'].some((key) =>
             claim[key] !== undefined && claim[key] !== null) ||
           ['citations', 'top_citations'].some((key) => claim[key] !== undefined && claim[key] !== null &&
             (!Array.isArray(claim[key]) || (claim[key] as unknown[]).length > 0))))
        throw new ToolFailure('invalid_api_output', 'Stored duplicate claim has invalid canonical reference or verification fields');
      const recovery = claim.source_recovery as Record<string, unknown> | undefined;
      if (recovery !== undefined && (!recovery || recovery.method !== 'literal_temporal_scope' ||
          typeof recovery.original_claim !== 'string' || typeof recovery.original_source_quote !== 'string' ||
          !Array.isArray(recovery.original_source_fragments) ||
          recovery.original_source_fragments.some((part) => typeof part !== 'string' || !part.trim())))
        throw new ToolFailure('invalid_api_output', 'Stored claim has invalid source recovery metadata');
      const verdict = savedClaimLabel(claim);
      const page = Number.isInteger(claim.page_number) ? `, page ${claim.page_number}` : '';
      const citations = Array.isArray(claim.citations) ? claim.citations : claim.top_citations;
      const urls = Array.isArray(citations) ? citations
        .map((source) => source && typeof source === 'object' ? (source as Record<string, unknown>).url : undefined)
        .filter((url): url is string => typeof url === 'string') : [];
      const printedLinks = claim.cited_source_urls;
      if (printedLinks !== undefined && (!Array.isArray(printedLinks) ||
          printedLinks.some((url) => typeof url !== 'string' || !url.trim()))) {
        throw new ToolFailure('invalid_api_output', 'Stored document review has invalid printed links');
      }
      return `${(offset as number) + index + 1}. [${verdict}] ${claim.claim}${page}${claim.analysis_revision ? '\n   Policy revision using retained snippets; original paid result preserved.' : ''}${typeof claim.error === 'string' ? `\n   ${claim.error}` : ''}${typeof claim.summary === 'string' ? `\n   ${claim.summary}` : ''}${urls.length ? `\n   Found citations: ${urls.join(', ')}` : ''}${Array.isArray(printedLinks) && printedLinks.length ? `\n   Links printed in document: ${printedLinks.join(', ')}` : ''}`;
    });
    const next = Number.isInteger(result.next_offset) ? `\nNext offset: ${result.next_offset}` : '';
    const credits = typeof result.credits_remaining === 'number' ? `\nCredits remaining: ${result.credits_remaining}` : '';
    const needed = typeof result.credits_required_next === 'number' ? `\nCredits needed for next step: ${result.credits_required_next}` : '';
    const focusedScope = result.review_scope === 'focused';
    const creditAction = result.status === 'credits_exhausted'
      ? focusedScope ? '\nAdd credits or enable overage if available before resuming.'
        : '\nAdd credits or enable overage if available, then resume with the exact input below.' : '';
    const extraction = Number.isInteger(result.extraction_cursor) && Number.isInteger(result.chunk_count)
      ? `\nExtraction chunks: ${result.extraction_cursor}/${result.chunk_count}` : '';
    const coverage = result.coverage_complete === true ? '\nSource coverage: complete.'
      : result.coverage_complete === false && result.extraction_complete === true
        ? `\nSource coverage: incomplete; ${result.uncovered_source_span_count ?? 'unknown'} uncovered spans, ${result.ungrounded_claims ?? 'unknown'} ungrounded claims. Checked claim results do not cover these passages.`
        : '\nSource coverage: not established for this saved review.';
    if (result.non_factual_claims !== undefined &&
        (!Number.isInteger(result.non_factual_claims) || (result.non_factual_claims as number) < 0 ||
         (result.non_factual_claims as number) > (result.total_claims as number)))
      throw new ToolFailure('invalid_api_output', 'Stored review has an invalid non-factual count');
    const nonFactualCount = Number.isInteger(result.non_factual_claims) ? `; non-factual: ${result.non_factual_claims}` : '';
    if (result.duplicate_claims !== undefined && result.duplicate_claims !== null &&
        (!Number.isInteger(result.duplicate_claims) || (result.duplicate_claims as number) < 0 ||
         (result.duplicate_claims as number) > (result.total_claims as number)))
      throw new ToolFailure('invalid_api_output', 'Stored review has an invalid duplicate count');
    if (result.material_claims !== undefined && result.material_claims !== null &&
        (!Number.isInteger(result.material_claims) || (result.material_claims as number) < 0 ||
         (result.material_claims as number) > (result.total_claims as number)))
      throw new ToolFailure('invalid_api_output', 'Stored review has an invalid material count');
    const materialCount = `; material: ${result.material_claims ?? 'unknown'}`;
    const duplicateCount = `; duplicates: ${result.duplicate_claims ?? 'unknown'}`;
    const failedCount = Number.isInteger(result.failed_claims) ? `; failed: ${result.failed_claims}` : '';
    const focusGuidance = focusedScope
      ? '\nThis saved review is focused. MCP review_document accepts only full scope. Resume this focused review through the API with the saved input below; to start a full MCP review, use a new thread_id.' : '';
    const nextPageInput = (counts: number[], cursors: unknown[]) => {
      if (!cursors.some(Number.isInteger)) return null;
      const starts = [offset, gapOffset, rejectedOffset, dispositionOffset] as number[];
      const ends = cursors.map((cursor, i) => Number.isInteger(cursor) ? cursor as number : starts[i] + counts[i]);
      return { review_id: reviewId, offset: ends[0], limit,
        gap_offset: ends[1], gap_limit: gapLimit, rejected_offset: ends[2], rejected_limit: rejectedLimit,
        disposition_offset: ends[3], disposition_limit: dispositionLimit };
    };
    const knownPageTotals = ['total_claims', 'uncovered_source_span_count', 'rejected_claim_count', 'nonclaim_disposition_count']
      .every(key => Number.isSafeInteger(result[key]));
    const terminalReview = ['complete', 'failed', 'credits_exhausted', 'interrupted'].includes(result.status as string);
    const continuationText = (input: ReturnType<typeof nextPageInput>) => input
      ? `\nNext page input (copy exactly, including exhausted streams): ${JSON.stringify(input)}`
      : knownPageTotals && terminalReview ? '\nAll four result streams are exhausted.'
        : '\nNo further page cursor was returned. Pending or unknown stream totals do not establish exhaustion or complete coverage.';
    const fullContinuation = nextPageInput([claims.length, gaps.length, rejected.length, dispositions.length],
      [result.next_offset, result.next_gap_offset, result.next_rejected_offset, result.next_disposition_offset]);
    const resumeLabel = focusedScope ? 'API resume input' : 'Resume input';
    const linkGuidance = '\nFor citation links in the final report, use source titles as labels and complete returned URLs as link targets. Never shorten URL paths or replace them with ellipses.';
    const output = ok(`# Saved document review ${reviewId}\nStatus: ${result.status}\nCompleted: ${result.completed_claims}/${result.total_claims} physical rows; pending (includes failed): ${result.pending_claims}${failedCount}${nonFactualCount}${materialCount}${duplicateCount}${credits}${needed}${extraction}${coverage}${creditAction}${rejectedCount}\n${gapRows.join('\n')}${nextGap}\n${rejectedRows.join('\n')}${nextRejected}\n${dispositionRows.join('\n')}${nextDisposition}\n${rows.join('\n')}${next}${focusGuidance}${continuationText(fullContinuation)}${linkGuidance}\n${resumeLabel}: ${JSON.stringify(resumeInput)}`, { ...result, resume_input: resumeInput, next_page_input: fullContinuation });
    if (Buffer.byteLength(JSON.stringify(output)) <= REVIEW_RESPONSE_MAX_BYTES) return output;
    const compactClaims = claims.map((claim) => ({
      id: claim.id, claim: String(claim.claim).slice(0, 500),
      ...(String(claim.claim).length > 500 ? { claim_truncated: true } : {}),
      result: claim.result, result_state: claim.result_state, citation_id: claim.citation_id,
      summary: typeof claim.summary === 'string' ? claim.summary.slice(0, 1000) : null,
      ...(typeof claim.summary === 'string' && claim.summary.length > 1000 ? { summary_truncated: true } : {}),
      classification_origin: claim.classification_origin, classification_reason: claim.classification_reason,
      original_claim_id: claim.original_claim_id,
      duplicate_of_index: claim.duplicate_of_index, duplicate_of_id: claim.duplicate_of_id,
      duplicate_reason: claim.duplicate_reason,
      source_recovery: claim.source_recovery,
      page_number: claim.page_number, error_code: claim.error_code,
      original_result_hash: claim.original_result_hash,
      ...(claim.analysis_revision ? { analysis_revision_summary: {
        id: (claim.analysis_revision as Record<string, unknown>).id,
        policy_version: (claim.analysis_revision as Record<string, unknown>).policy_version,
        origin: 'policy_re_evaluation', basis: 'retained_snippets',
        assessment_status: (claim.analysis_revision as Record<string, unknown>).assessment_status,
      } } : {}),
      error: typeof claim.error === 'string' ? claim.error.slice(0, 500) : undefined,
      cited_source_urls: claim.cited_source_urls,
      citation_urls: (Array.isArray(claim.citations) ? claim.citations : Array.isArray(claim.top_citations) ? claim.top_citations : [])
        .map((source: unknown) => source && typeof source === 'object' ? (source as Record<string, unknown>).url : undefined)
        .filter((url: unknown): url is string => typeof url === 'string'),
    }));
    const buildCompactPage = (shown: typeof compactClaims, sideLimit: number) => {
      const nextPage = (offset as number) + shown.length;
      const shownGaps = gaps.slice(0, sideLimit);
      const compactNextGap = shownGaps.length < gaps.length
        ? (gapOffset as number) + shownGaps.length : result.next_gap_offset;
      const compactGapHint = Number.isInteger(compactNextGap)
        ? `\nNext gap offset: ${compactNextGap} (use gap_offset and gap_limit)` : '';
      const shownRejected = rejected.slice(0, sideLimit);
      const compactNextRejected = shownRejected.length < rejected.length
        ? (rejectedOffset as number) + shownRejected.length : result.next_rejected_offset;
      const compactRejectedHint = Number.isInteger(compactNextRejected)
        ? `\nNext rejected offset: ${compactNextRejected} (use rejected_offset and rejected_limit)` : '';
      const compactRejectedRows = rejectedRows.slice(0, sideLimit);
      const shownDispositions = dispositions.slice(0, sideLimit);
      const compactNextDisposition = shownDispositions.length < dispositions.length
        ? (dispositionOffset as number) + shownDispositions.length : result.next_disposition_offset;
      const compactDispositionHint = Number.isInteger(compactNextDisposition)
        ? `\nNext disposition offset: ${compactNextDisposition} (use disposition_offset and disposition_limit)` : '';
      const compactNextClaim = nextPage < (offset as number) + claims.length ? nextPage : result.next_offset;
      const compactContinuation = nextPageInput([shown.length, shownGaps.length, shownRejected.length, shownDispositions.length],
        [compactNextClaim, compactNextGap, compactNextRejected, compactNextDisposition]);
      const compact = ok(`# Saved document review ${reviewId}\nStatus: ${result.status}\nCompleted: ${result.completed_claims}/${result.total_claims} physical rows; pending (includes failed): ${result.pending_claims}${failedCount}${nonFactualCount}${materialCount}${duplicateCount}${credits}${needed}${extraction}${coverage}${creditAction}${rejectedCount}\nThis page exceeds the tool response limit. Showing ${shown.length} of ${claims.length} requested claims with source URLs and citation IDs. Saved verdict summaries are included where available. Detailed evidence is omitted from this compact view, not necessarily absent from storage. A null summary means unavailable on this saved row, not absent evidence. Full saved evidence remains in Webcite.\n${gapRows.slice(0, sideLimit).join('\n')}${compactGapHint}\n${compactRejectedRows.join('\n')}${compactRejectedHint}\n${dispositionRows.slice(0, sideLimit).join('\n')}${compactDispositionHint}\n${shown.map((claim, index) => `${(offset as number) + index + 1}. [${savedClaimLabel(claim)}] ${claim.claim}${claim.claim_truncated ? ' [claim text truncated; full assertion remains saved]' : ''}${claim.summary !== null ? `\n   Saved summary: ${claim.summary}${claim.summary_truncated ? ' [summary truncated; full text remains saved]' : ''}` : '\n   Saved summary: unavailable on this row'}${claim.error_code ? `\n   Error: ${claim.error_code}${claim.error ? `: ${claim.error}` : ''}` : ''}\n   Citation ID: ${claim.citation_id ?? 'none'}\n   Found citations: ${claim.citation_urls.join(', ') || 'none'}`).join('\n')}\n${nextPage < (offset as number) + claims.length ? `Next offset: ${nextPage} (limit: ${shown.length})` : next}${continuationText(compactContinuation)}${linkGuidance}\n${resumeLabel}: ${JSON.stringify(resumeInput)}`, {
        review_id: reviewId, status: result.status, total_claims: result.total_claims,
        completed_claims: result.completed_claims, pending_claims: result.pending_claims,
        non_factual_claims: result.non_factual_claims,
        material_claims: result.material_claims ?? null, duplicate_claims: result.duplicate_claims ?? null,
        failed_claims: result.failed_claims,
        extraction_complete: result.extraction_complete ?? null,
        extraction_cursor: result.extraction_cursor ?? null, chunk_count: result.chunk_count ?? null,
        source_read_complete: result.source_read_complete ?? null, source_readiness: result.source_readiness ?? null,
        ...(result.credit_usage !== undefined ? { credit_usage: result.credit_usage } : {}),
        ...(result.review_usage !== undefined ? { review_usage: result.review_usage } : {}),
        claims: shown, next_offset: compactNextClaim, next_page_input: compactContinuation,
        resume_input: resumeInput, claims_omitted: claims.length - shown.length,
        coverage_complete: result.coverage_complete ?? null,
        uncovered_source_span_count: result.uncovered_source_span_count ?? null,
        ungrounded_claims: result.ungrounded_claims ?? null,
        uncovered_source_spans: shownGaps,
        next_gap_offset: compactNextGap ?? null,
        rejected_claim_count: result.rejected_claim_count ?? null,
        rejected_claims: shownRejected,
        next_rejected_offset: compactNextRejected ?? null,
        nonclaim_disposition_count: result.nonclaim_disposition_count ?? null,
        nonclaim_dispositions: shownDispositions,
        next_disposition_offset: compactNextDisposition ?? null,
        full_evidence_saved: true, evidence_details_omitted: true,
      });
      return compact;
    };
    // ponytail: bounded by the public 100-row limits; measure the complete response instead of estimating token size.
    for (let sideLimit = 3; sideLimit >= 1; sideLimit--) {
      for (let count = compactClaims.length; count >= (compactClaims.length ? 1 : 0); count--) {
        const compact = buildCompactPage(compactClaims.slice(0, count), sideLimit);
        if (Buffer.byteLength(JSON.stringify(compact)) <= REVIEW_RESPONSE_MAX_BYTES) {
          let packed = compact;
          const maxSideRows = Math.max(gaps.length, rejected.length, dispositions.length);
          for (let expanded = sideLimit + 1; expanded <= maxSideRows; expanded++) {
            const candidate = buildCompactPage(compactClaims.slice(0, count), expanded);
            if (Buffer.byteLength(JSON.stringify(candidate)) > REVIEW_RESPONSE_MAX_BYTES) break;
            packed = candidate;
          }
          return packed;
        }
      }
    }
    return { ...ok(`# Saved document review ${reviewId}\nStatus: ${result.status}\nCompleted: ${result.completed_claims}/${result.total_claims} physical rows; pending (includes failed): ${result.pending_claims}${failedCount}${materialCount}${duplicateCount}${coverage}\nThe requested page exceeds Claude's tool response limit. Even one item per stream exceeds the limit. No claim or side-list item was consumed. Use the Webcite API for full citation objects and coverage lists at these offsets; repeating this tool call cannot retrieve this oversized page.`, {
      review_id: reviewId, status: result.status, total_claims: result.total_claims, material_claims: result.material_claims ?? null,
      completed_claims: result.completed_claims, pending_claims: result.pending_claims,
      non_factual_claims: result.non_factual_claims,
      duplicate_claims: result.duplicate_claims,
      coverage_complete: result.coverage_complete ?? null,
      uncovered_source_span_count: result.uncovered_source_span_count ?? null,
      ungrounded_claims: result.ungrounded_claims ?? null,
      next_gap_offset: gaps.length ? gapOffset : result.next_gap_offset ?? null,
      rejected_claim_count: result.rejected_claim_count ?? null,
      next_rejected_offset: rejected.length ? rejectedOffset : result.next_rejected_offset ?? null,
      nonclaim_disposition_count: result.nonclaim_disposition_count ?? null,
      next_disposition_offset: dispositions.length ? dispositionOffset : result.next_disposition_offset ?? null,
      next_offset: null, blocked_offset: offset, code: 'response_limit_exceeded', full_evidence_saved: true,
    }), isError: true };
  },

  get_document_review_job: async (args, client) => {
    const jobId = requireString(args, 'job_id');
    if (!/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/.test(jobId))
      throw new ToolFailure('invalid_argument', 'job_id must be a review job ID');
    return documentReviewJobOutput(await wrapApi(client.getDocumentReviewJob(jobId)));
  },

  review_document: async (args, client) => {
    const prompt = requireString(args, 'prompt');
    const threadId = requireString(args, 'thread_id');
    const maxCredits = args?.max_account_credits;
    if (maxCredits !== undefined && (!Number.isSafeInteger(maxCredits) ||
        (maxCredits as number) < 1 || (maxCredits as number) > 2147483647))
      throw new ToolFailure('invalid_argument', 'max_account_credits must be an integer from 1 to 2147483647');
    const assetIds = args?.asset_ids;
    const sourceUrls = args?.source_urls;
    const filters = args?.filters;
    if (!wakeIdentityComplete(threadId) || !Array.isArray(assetIds) || assetIds.length === 0 ||
        assetIds.some((id) => typeof id !== 'string' || !wakeIdentityComplete(id)) ||
        new Set(assetIds).size !== assetIds.length ||
        (sourceUrls !== undefined && (!Array.isArray(sourceUrls) ||
          sourceUrls.some((url) => typeof url !== 'string' || !url.startsWith('https://')))) ||
        (filters !== undefined && (!filters || typeof filters !== 'object' || Array.isArray(filters))) ||
        (args?.review_scope !== undefined && args.review_scope !== 'full') ||
        (args?.include_stance !== undefined && typeof args.include_stance !== 'boolean') ||
        (args?.include_verdict !== undefined && typeof args.include_verdict !== 'boolean') ||
        (args?.retry_failed !== undefined && typeof args.retry_failed !== 'boolean'))
      throw new ToolFailure('invalid_argument', 'Pass distinct asset_ids, a stable thread_id, full review scope, and valid HTTPS source URLs, filters and billing flags');
    const options: ReviewDocumentOptions = { prompt, asset_ids: assetIds as string[], thread_id: threadId,
      review_scope: 'full',
      ...(sourceUrls !== undefined ? { source_urls: sourceUrls as string[] } : {}),
      ...(filters !== undefined ? { filters: filters as SourceFilters } : {}),
      include_stance: args?.include_stance !== false,
      include_verdict: args?.include_verdict !== false,
    };
    const suppliedKey = args?.idempotency_key;
    if (suppliedKey !== undefined && (typeof suppliedKey !== 'string' ||
        suppliedKey.length < 1 || suppliedKey.length > 128 || suppliedKey.trim() !== suppliedKey))
      throw new ToolFailure('invalid_argument', 'idempotency_key must be a non-empty string of at most 128 characters');
    const key = (suppliedKey as string | undefined) ?? createHash('sha256').update(JSON.stringify(options)).digest('hex');
    const request = { ...options,
      ...(maxCredits !== undefined ? { max_account_credits: maxCredits as number } : {}),
      ...(args?.retry_failed !== undefined ? { retry_failed: args.retry_failed as boolean } : {}) };
    const result = await wrapApi(client.startDocumentReviewJob(request, key));
    const output = documentReviewJobOutput(result);
    if (maxCredits !== undefined && result.max_account_credits !== maxCredits)
      throw new ToolFailure('invalid_api_output', 'Review response did not confirm max_account_credits. Enforcement is unknown; do not resubmit. Inspect the existing job before further paid work.', {
        details: { job_id: result.job_id, status: result.status, requested_max_account_credits: maxCredits,
          ...(result.credit_usage ? { credit_usage: result.credit_usage } : {}) },
      });
    return output;
  },

  verify_claim: async (args, client) => {
    const options = { ...verifyOptions(args), ...(args?.idempotency_key !== undefined ? {idempotency_key: requireString(args, 'idempotency_key')} : {}) };
    const result = validateVerification(await wrapApi(client.verifyClaim(options)));
    return ok(formatVerifyResult(options.claim, result), { ...result });
  },

  verify_claim_stream: async (args, client, signal) => {
    const options = verifyOptions(args);
    try {
      const { result, events } = await collectStreamEvents(client.verifyClaimStream(options, signal));
      return ok(formatVerifyResult(options.claim, result), { ...result, stream_events: events });
    } catch (error) {
      if (error instanceof ApiClientError) throw error.toToolFailure();
      throw error;
    }
  },

  search_sources: async (args, client) => {
    const query = requireString(args, 'query');
    const limit = clamp(args?.limit, 10, 1, 20);
    const result = await wrapApi(client.searchSources({ query, limit, filters: args?.filters as SourceFilters | undefined }));
    if (!Array.isArray(result?.citations) && !Array.isArray(result?.claim_groups)) {
      throw new ToolFailure('invalid_api_output', 'Source search returned no citation list', {
        actionable: 'Do not treat this as no sources or repeat a chargeable search. Inspect the API response.',
      });
    }

    const parts: string[] = [];
    parts.push(`# Search Results: "${query}"\n`);
    const scope = formatRetrievalScope(result.metadata);
    if (scope) parts.push(scope);

    const groupedCitations = result.claim_groups?.flatMap((group) => group.citations ?? []) ?? [];
    const citations = result.citations?.length ? result.citations : groupedCitations;
    if (citations.length > 0) {
      parts.push(`Found ${citations.length} sources:\n`);
      citations.slice(0, limit).forEach((citation, i) => {
        parts.push(formatCitation(citation, i));
        parts.push('');
      });
      if (citations.length > limit) parts.push(`Showing ${limit} here; the full source list is in structuredContent.`);
    } else {
      parts.push('No sources were retained from this search. This does not establish that the data does not exist.');
    }

    return ok(parts.join('\n'), { ...result });
  },

  list_citations: async (args, client) => {
    const page = clamp(args?.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = clamp(args?.limit, 10, 1, 50);
    const result = await wrapApi(
      client.listCitations({
        page,
        limit,
        thread_id: args?.thread_id as string | undefined,
      }),
    );
    requireApiShape(Array.isArray(result?.data) && Number.isInteger(result?.pagination?.page) &&
      Number.isInteger(result?.pagination?.totalPages) && Number.isInteger(result?.pagination?.total), 'list_citations');

    const parts: string[] = [];
    parts.push(`# Your Verification History\n`);
    parts.push(
      `Page ${result.pagination.page} of ${result.pagination.totalPages} (${result.pagination.total} total)\n`,
    );

    if (result.data.length > 0) {
      result.data.forEach((record, i) => {
        parts.push(`${i + 1}. **${record.prompt}**`);
        parts.push(`   ID: ${record.id}`);
        if (record.created_at) {
          parts.push(`   Date: ${new Date(record.created_at).toLocaleString()}`);
        }
        parts.push('');
      });
    } else {
      parts.push('No verification history found.');
    }

    return ok(parts.join('\n'), { ...result });
  },

  get_citation: async (args, client) => {
    const citationId = requireString(args, 'citation_id');
    const result = await wrapApi(client.getCitation(citationId));

    const normalized = storedVerification(result.data);
    const parts = [
      '# Verification Details', `**Citation ID:** ${result.data.id ?? citationId}`,
      `**Prompt:** ${result.data.prompt}`,
    ];
    if (normalized.final_response) {
      parts.push(formatVerifyResult(result.data.prompt, normalized.final_response));
    } else {
      parts.push('Stored verdict: unavailable (legacy record).');
      normalized.citations.forEach((citation, i) => parts.push(formatCitation(citation, i)));
    }
    return ok(parts.join('\n\n'), { ...result, ...normalized });
  },

  upload_file: async (args, client) => {
    let result;
    if (args?.file_base64 !== undefined) {
      const { bytes, filename } = base64File(args);
      result = await wrapApi(client.uploadBytes(bytes, filename));
    } else {
      result = await wrapApi(client.uploadFile(requireString(args, 'file_path')));
    }

    const parts: string[] = [];
    parts.push(`# File Uploaded Successfully\n`);
    parts.push(`**Asset ID:** ${result.asset_id}`);
    parts.push(`**Filename:** ${result.filename}`);
    parts.push(`**Size:** ${result.size} bytes`);
    if (result.source_version_id) parts.push(`**Source version ID:** ${result.source_version_id}`);
    if (!creditUsage(result)) parts.push('Request credit usage: unknown. A missing upload receipt does not mean zero credits were charged.');

    return ok(parts.join('\n'), { ...result });
  },

  get_source_preview: async (args, client) => {
    const url = args?.url as string | undefined;
    const assetId = args?.asset_id as string | undefined;

    if (!url && !assetId) {
      throw new ToolFailure(
        'invalid_argument',
        'provide either url (web source) or asset_id (uploaded document)',
        { actionable: 'Pass url or asset_id.' },
      );
    }

    const result = await wrapApi(
      client.sourcePreview({
        url,
        asset_id: assetId,
        page: args?.page as number | undefined,
        quote: args?.quote as string | undefined,
      }),
    );
    requireApiShape(typeof result?.deep_link === 'string' && typeof result?.binding?.grounded === 'boolean' &&
      typeof result?.binding?.method === 'string', 'get_source_preview');

    return ok(formatSourcePreview(result), { ...result });
  },

  verify_batch: async (args, client) => {
    const items = args?.items as BatchItem[] | undefined;
    if (!Array.isArray(items) || items.length === 0) {
      throw new ToolFailure('invalid_argument', 'items is required and must be a non-empty array', {
        actionable: 'Pass 1-200 items, each with a quote and a source.',
      });
    }
    if (items.length > 200) {
      throw new ToolFailure(
        'invalid_argument',
        `items holds ${items.length} entries; the maximum per call is 200`,
        { actionable: 'Split the batch into chunks of at most 200.' },
      );
    }

    const results = validateBatch(await wrapApi(client.verifyBatch(items)));
    return ok(formatBatchResults(results), { results, ...(creditUsage(results) ? { credit_usage: creditUsage(results) } : {}) });
  },

  verify_feedback: async (args, client) => {
    const token = requireString(args, 'token');
    const verdict = requireString(args, 'verdict') as FeedbackVerdict;
    if (!['correct', 'incorrect', 'unsure'].includes(verdict)) {
      throw new ToolFailure('invalid_argument', 'verdict must be one of: correct, incorrect, unsure', {
        actionable: 'Use correct, incorrect, or unsure.',
      });
    }

    const recorded = await wrapApi(client.verifyFeedback(token, verdict, args?.note as string | undefined));
    requireApiShape(recorded?.recorded === true, 'verify_feedback');
    return ok(
      `# Feedback Recorded\n\n**Verdict:** ${verdict}${args?.note ? `\n**Note:** ${args.note}` : ''}`,
      { ...recorded, verdict },
    );
  },

  analyze_conflicts: async (args, client) => {
    const figures = args?.figures as ExtractedFigure[] | undefined;
    if (!Array.isArray(figures) || figures.length === 0) {
      throw new ToolFailure('invalid_argument', 'figures is required and must be a non-empty array', {
        actionable: 'Pass figures from extract_figures or your own pipeline.',
      });
    }

    const result = await wrapApi(client.analyzeConflicts(figures));
    requireApiShape(Array.isArray(result?.conflicts) && Array.isArray(result?.recomputations) &&
      typeof result?.review?.needs_review === 'boolean' && Array.isArray(result?.review?.reasons), 'analyze_conflicts');
    return ok(`# Numeric Analysis: ${figures.length} figure(s)\n\n${formatAnalyzeResult(result)}`, { ...result });
  },

  analyze_document: async (args, client) => {
    const assetId = requireString(args, 'asset_id');
    try {
      const result = await client.analyzeDocument(assetId);
      requireApiShape(Array.isArray(result?.figures) && Array.isArray(result?.conflicts) &&
        Array.isArray(result?.recomputations) && typeof result?.review?.needs_review === 'boolean' &&
        Array.isArray(result?.review?.reasons), 'analyze_document');
      return ok(formatDocumentAnalysis(result), { ...result });
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 400 && /Unsupported document type/i.test(error.body)) {
        throw new ToolFailure('invalid_argument', 'analyze_document rejected this file format on the current backend.', {
          details: { status: error.status, body: error.body },
          actionable: 'If this image format is unsupported here, use extract_document to inspect its text, then review_document for a saved full review. Do not retry analyze_document on the same unsupported file.',
        });
      }
      if (error instanceof ApiClientError) throw error.toToolFailure();
      throw error;
    }
  },

  classify_document: async (args, client) => {
    const result = await wrapApi(
      client.classifyDocument({
        ...assetRef(args),
        taxonomy: args?.taxonomy as Taxonomy | undefined,
      }),
    );
    requireApiShape(typeof result?.category === 'string' && Array.isArray(result?.covers), 'classify_document');
    return ok(formatClassify(result), { ...result });
  },

  document_gaps: async (args, client) => {
    const category = requireString(args, 'category');
    const docs = (Array.isArray(args?.docs) ? args?.docs : []) as GapDoc[];
    const result = await wrapApi(
      client.documentGaps({
        category,
        docs,
        taxonomy: args?.taxonomy as Taxonomy | undefined,
        stage: args?.stage as 'early' | 'growth' | undefined,
      }),
    );
    requireApiShape(Array.isArray(result?.items), 'document_gaps');
    return ok(formatGaps(category, result), { ...result });
  },

  extract_document: async (args, client) => {
    const result = await wrapApi(client.extractDocument(assetRef(args)));
    requireApiShape(typeof result?.format === 'string' && typeof result?.markdown === 'string' &&
      Array.isArray(result?.units), 'extract_document');
    return extractionResult(formatExtractedDoc(result), { ...result });
  },

  ask_document: async (args, client) => {
    const question = requireString(args, 'question');
    const documentText = requireString(args, 'documentText');
    const documentName = args?.documentName;
    const hasTextLayer = args?.hasTextLayer;
    const topK = args?.topK;
    if (question.length > 2000 || documentText.length > 2000000 ||
        (documentName !== undefined && (typeof documentName !== 'string' || documentName.length > 300)) ||
        (hasTextLayer !== undefined && typeof hasTextLayer !== 'boolean') ||
        (topK !== undefined && (!Number.isInteger(topK) || (topK as number) < 1 || (topK as number) > 20))) {
      throw new ToolFailure('invalid_argument', 'Invalid document question options');
    }
    const result = await wrapApi(client.askDocument({ question, documentText,
      ...(documentName !== undefined ? { documentName: documentName as string } : {}),
      ...(hasTextLayer !== undefined ? { hasTextLayer: hasTextLayer as boolean } : {}),
      ...(topK !== undefined ? { topK: topK as number } : {}),
    }));
    return ok(JSON.stringify(result), result);
  },

  get_ask_result: async (args, client) => {
    const id = requireString(args, 'id');
    if (/^[a-f0-9]{64}$/i.test(id)) {
      throw new ToolFailure('invalid_argument', 'This is a saved document review ID, not an ask job ID.', {
        actionable: 'Call get_document_review with review_id to recover the saved claims at zero credits.',
      });
    }
    const result = await wrapApi(client.getAskResult(id));
    return ok(JSON.stringify(result), result);
  },

  publish_text_representation: async (args, client) => {
    const id = requireString(args, 'source_version_id');
    if (!wakeIdentityComplete(id)) throw new ToolFailure('invalid_argument', 'Source version ID is incomplete');
    const result = await wrapApi(client.publishTextRepresentation(id));
    return ok(JSON.stringify(result), result);
  },

  get_latest_representation: async (args, client) => {
    const id = requireString(args, 'source_version_id');
    if (!wakeIdentityComplete(id)) throw new ToolFailure('invalid_argument', 'Source version ID is incomplete');
    const result = await wrapApi(client.getLatestRepresentation(id));
    return ok(JSON.stringify(result), result);
  },

  register_source: async (args, client) => {
    const assetId = requireString(args, 'asset_id');
    const { bytes, filename } = base64File(args);
    const result = await wrapApi(client.registerSourceBytes(assetId, bytes, filename));
    return ok(JSON.stringify(result), result);
  },

  read_source_unit: async (args, client) => {
    const ids = ['source_version_id','representation_id','source_unit_id'].map(key => requireString(args,key));
    if (ids.some(id => !wakeIdentityComplete(id)))
      throw new ToolFailure('invalid_argument', 'Source IDs are incomplete');
    const result = await wrapApi(client.readSourceUnit(ids[0]!, ids[1]!, ids[2]!));
    return ok(JSON.stringify(result), result);
  },

  extract_pages: async (args, client) => {
    const result = await wrapApi(client.extractPages(assetRef(args)));
    return extractionResult(JSON.stringify(result), result);
  },

  prepare_ocr_rescue: async (args, client) => {
    const versionId = requireString(args, 'source_version_id');
    const representationId = requireString(args, 'representation_id');
    if (!wakeIdentityComplete(versionId) || !wakeIdentityComplete(representationId)) {
      throw new ToolFailure('invalid_argument', 'Source IDs cannot have surrounding whitespace');
    }
    const result = await wrapApi(client.prepareOcrRescue(versionId, representationId));
    return ok(JSON.stringify(result), result);
  },

  verify_numeric_claim: async (args, client) => {
    const claim = requireString(args, 'claim');
    const operands = args?.operands;
    if (claim.length > 10000 || !Array.isArray(operands) || operands.length < 1 || operands.length > 2 ||
        operands.some((item) => !item || typeof item !== 'object' || Array.isArray(item) ||
          Object.keys(item).some((key) => !['source_version_id', 'representation_id', 'source_unit_id', 'figure_index'].includes(key)) ||
          !['source_version_id', 'representation_id', 'source_unit_id'].every((key) =>
            typeof item[key] === 'string' && wakeIdentityComplete(item[key])) ||
          !Number.isInteger(item.figure_index) || item.figure_index < 0 || item.figure_index > 10000)) {
      throw new ToolFailure('invalid_argument', 'Expected one or two owned source figure references');
    }
    const result = await wrapApi(client.verifyNumericClaim({ claim, operands }));
    return ok(JSON.stringify(result), result);
  },

  extract_figures: async (args, client) => {
    const result = await wrapApi(client.extractFigures(assetRef(args)));
    requireApiShape(Array.isArray(result?.figures), 'extract_figures');
    return ok(formatFigures(result), { ...result });
  },

  accuracy_report: async (_args, client) => {
    const result = await wrapApi(client.accuracyReport());
    requireApiShape(typeof result?.pass === 'boolean' && result?.totals != null, 'accuracy_report');
    return ok(formatAccuracyReport(result), { ...result });
  },

  get_answer: async (args, client) => {
    // W3 #264/#279 pad honesty (same as get_change_impact / resolve_fragment_uses):
    // never trim-launder revision_id into a certified sealed-answer lookup.
    const revisionId = args?.revision_id;
    if (typeof revisionId !== 'string' || !wakeIdentityComplete(revisionId)) {
      throw new ToolFailure(
        'invalid_argument',
        'revision_id is incomplete (blank/whitespace/padded)',
        {
          details: { reason: 'incomplete_answer_revision_identity', field: 'revision_id' },
          actionable:
            'Blank/whitespace/padded revision_id never certifies a sealed answer; do not invent or trim-launder a revision hit.',
        },
      );
    }
    const raw = await wrapApi(client.getAnswer(revisionId));
    const validated = validateResolvedAnswer(raw);
    return ok(formatResolvedAnswer(validated), validated as unknown as Record<string, unknown>);
  },

  get_evidence_packet: async (args, client) => {
    // W3 #264/#279 pad honesty: never trim-launder packet_id into a certified
    // sealed-packet lookup (same identityComplete rule as change-impact / fragment uses).
    const packetId = args?.packet_id;
    if (typeof packetId !== 'string' || !wakeIdentityComplete(packetId)) {
      throw new ToolFailure(
        'invalid_argument',
        'packet_id is incomplete (blank/whitespace/padded)',
        {
          details: { reason: 'incomplete_packet_identity', field: 'packet_id' },
          actionable:
            'Blank/whitespace/padded packet_id never certifies a sealed packet; do not invent or trim-launder a packet hit.',
        },
      );
    }
    const raw = await wrapApi(client.getEvidencePacket(packetId));
    const validated = validateResolvedPacket(raw);
    return ok(formatResolvedPacket(validated), validated as unknown as Record<string, unknown>);
  },

  query_context: async (args, client) => {
    // Backend #314: refuse padded/blank selectPassage text before HTTP — never
    // trim-launder into certified lexical seeds.
    const text = args?.text;
    assertSelectTextComplete(text);
    const maxHops = args?.max_hops;
    if (maxHops !== undefined && maxHops !== 0 && maxHops !== 1 && maxHops !== 2) {
      throw new ToolFailure('invalid_argument', 'max_hops must be 0, 1, or 2', {
        actionable: 'Use 0, 1, or 2 for authorized expansion hops.',
      });
    }
    const filters =
      args?.filters && typeof args.filters === 'object' && !Array.isArray(args.filters)
        ? (args.filters as Record<string, unknown>)
        : undefined;
    // Backend #307: padded/blank filters never certify a lookup_number bind.
    assertLookupFiltersComplete(filters);
    // W2: padded/blank source_texts / source_version_ids never materialize or pin.
    assertQuerySourcesComplete({
      source_texts: args?.source_texts,
      source_version_ids: args?.source_version_ids,
    });
    // W2 after #92/#105: optional padded idempotency_key never certifies a
    // query-context replay pin (same helper as settle/compare_assertions).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.queryContext({
        text,
        source_texts: Array.isArray(args?.source_texts)
          ? (args?.source_texts as string[])
          : undefined,
        source_version_ids: Array.isArray(args?.source_version_ids)
          ? (args?.source_version_ids as string[])
          : undefined,
        // Forward filters as-is — never trim pads into a certified bind.
        filters: filters as Partial<ClaimScope> | undefined,
        max_hops: maxHops as 0 | 1 | 2 | undefined,
        limit: clamp(args?.limit, 10, 1, 50),
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateContextQuery(raw);
    return ok(formatContextQuery(validated), validated as unknown as Record<string, unknown>);
  },

  compare_assertions: async (args, client) => {
    const left = asScope(args?.left, 'left');
    const right = asScope(args?.right, 'right');
    // W2 A_SCOPE pad honesty: refuse padded/blank scope fields before HTTP —
    // never trim-launder equal pads into a certified same/different.
    assertCompareScopeComplete(left, 'left');
    assertCompareScopeComplete(right, 'right');
    // W2 after #92/#101/#102: optional padded idempotency_key never certifies a
    // compare-assertions replay pin (same helper as settle/compare_evaluations).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.compareAssertions({
        left,
        right,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateCompareAssertions(raw);
    return ok(formatCompareAssertions(validated), validated as unknown as Record<string, unknown>);
  },

  resolve_fragment_uses: async (args, client) => {
    if (!args?.selector || typeof args.selector !== 'object' || Array.isArray(args.selector)) {
      throw new ToolFailure('invalid_argument', 'selector object is required', {
        actionable:
          'Provide a FragmentSelector with kind + representationId (tokens or image).',
      });
    }
    // W3: refuse padded/blank selector.representationId before HTTP — never
    // trim-launder into a certified fragment-use match (evidenceId honesty).
    assertFragmentSelectorRepresentationComplete(args.selector);
    if (args.fragments !== undefined && !Array.isArray(args.fragments)) {
      throw new ToolFailure('invalid_argument', 'fragments must be an array when provided');
    }
    // W3 / expand_seeds #68: padded allow-list ids never trim-launder into a
    // certified authorization pin — refuse before HTTP.
    if (args.allowed_fragment_ids !== undefined) {
      assertAllowedFragmentIdsComplete(args.allowed_fragment_ids);
    }
    // W3 #264/#279 pad honesty (same as get_change_impact): never trim-launder
    // sealed packet_id / answer_revision_id into a certified catalog hit.
    let packetId: string | undefined;
    if (typeof args?.packet_id === 'string') {
      if (!wakeIdentityComplete(args.packet_id)) {
        throw new ToolFailure(
          'invalid_argument',
          'packet_id is incomplete (blank/whitespace/padded)',
          {
            details: { reason: 'incomplete_packet_identity', field: 'packet_id' },
            actionable:
              'Blank/whitespace/padded packet_id never certifies a sealed catalog; do not invent or trim-launder a packet hit.',
          },
        );
      }
      packetId = args.packet_id;
    }
    let answerRevisionId: string | undefined;
    if (typeof args?.answer_revision_id === 'string') {
      if (!wakeIdentityComplete(args.answer_revision_id)) {
        throw new ToolFailure(
          'invalid_argument',
          'answer_revision_id is incomplete (blank/whitespace/padded)',
          {
            details: { reason: 'incomplete_answer_revision_identity', field: 'answer_revision_id' },
            actionable:
              'Blank/whitespace/padded answer_revision_id never certifies a sealed catalog; do not invent or trim-launder a sealed answer hit.',
          },
        );
      }
      answerRevisionId = args.answer_revision_id;
    }
    if (packetId && answerRevisionId) {
      throw new ToolFailure(
        'invalid_argument',
        'packet_id and answer_revision_id are mutually exclusive',
        {
          actionable: 'Pass exactly one of packet_id or answer_revision_id for a sealed catalog.',
        },
      );
    }
    const hasClientRows =
      (Array.isArray(args.fragments) && args.fragments.length > 0) ||
      (Array.isArray(args.groups) && args.groups.length > 0) ||
      (Array.isArray(args.links) && args.links.length > 0) ||
      (Array.isArray(args.allowed_fragment_ids) && args.allowed_fragment_ids.length > 0) ||
      (Array.isArray(args.consumers) && args.consumers.length > 0);
    if ((packetId || answerRevisionId) && hasClientRows) {
      throw new ToolFailure(
        'invalid_argument',
        'sealed_catalog_rejects_client_rows: omit fragments/groups/links when packet_id or answer_revision_id is set',
        {
          actionable:
            'Omit fragments, groups, links, consumers, and allowed_fragment_ids when using a sealed id.',
        },
      );
    }
    // W3 after #92/#105/#110/#113: optional padded idempotency_key never certifies a
    // resolve-fragment-uses replay pin (same helper as settle/compare_assertions).
    // formal_check Lean source trailing newlines remain untouched (#110).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.resolveFragmentUses({
        selector: args.selector as Record<string, unknown>,
        ...(packetId ? { packet_id: packetId } : {}),
        ...(answerRevisionId ? { answer_revision_id: answerRevisionId } : {}),
        fragments: Array.isArray(args.fragments) ? args.fragments : undefined,
        groups: Array.isArray(args.groups) ? args.groups : undefined,
        links: Array.isArray(args.links) ? args.links : undefined,
        consumers: Array.isArray(args.consumers) ? args.consumers : undefined,
        allowed_fragment_ids: Array.isArray(args.allowed_fragment_ids)
          ? (args.allowed_fragment_ids as string[])
          : undefined,
        cursor:
          args?.cursor === null || typeof args?.cursor === 'string' ? args.cursor : undefined,
        limit: clamp(args?.limit, 50, 1, 200),
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateResolveFragmentUses(raw);
    return ok(
      formatResolveFragmentUses(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  get_change_impact: async (args, client) => {
    // W3 #264/#279 pad honesty: never trim-launder answer_revision_id /
    // packet_id into a certified freshness or sealed-packet lookup (same
    // identityComplete rule as changed_ids / link endpoints — pads must not
    // look like a clean revision or packet hit).
    let answerRevisionId: string | undefined;
    if (typeof args?.answer_revision_id === 'string') {
      if (!wakeIdentityComplete(args.answer_revision_id)) {
        throw new ToolFailure(
          'invalid_argument',
          'answer_revision_id is incomplete (blank/whitespace/padded)',
          {
            details: { reason: 'incomplete_answer_revision_identity', field: 'answer_revision_id' },
            actionable:
              'Blank/whitespace/padded answer_revision_id never certifies freshness; do not invent or trim-launder a sealed answer hit.',
          },
        );
      }
      answerRevisionId = args.answer_revision_id;
    }
    let packetId: string | undefined;
    if (typeof args?.packet_id === 'string') {
      if (!wakeIdentityComplete(args.packet_id)) {
        throw new ToolFailure(
          'invalid_argument',
          'packet_id is incomplete (blank/whitespace/padded)',
          {
            details: { reason: 'incomplete_packet_identity', field: 'packet_id' },
            actionable:
              'Blank/whitespace/padded packet_id never certifies a sealed packet; do not invent or trim-launder a packet hit.',
          },
        );
      }
      packetId = args.packet_id;
    }
    // Backend #264: forward blank/whitespace changed_ids as-is — never strip into
    // a silent empty list that looks like certified no-impact.
    const changedIds = Array.isArray(args?.changed_ids)
      ? (args.changed_ids as unknown[]).filter((id): id is string => typeof id === 'string')
      : undefined;
    if (!answerRevisionId && (!changedIds || changedIds.length === 0)) {
      throw new ToolFailure(
        'invalid_argument',
        'answer_revision_id or changed_ids is required',
        {
          actionable:
            'Pass answer_revision_id for freshness, or changed_ids for packet impact (blank/whitespace ids fail closed as incomplete_changed_ids).',
        },
      );
    }

    let links: Array<{ source_id: string; consumer_id: string }> | undefined;
    if (args?.links !== undefined) {
      if (!Array.isArray(args.links)) {
        throw new ToolFailure('invalid_argument', 'links must be an array');
      }
      links = [];
      for (const [i, link] of args.links.entries()) {
        if (!link || typeof link !== 'object' || Array.isArray(link)) {
          throw new ToolFailure('invalid_argument', `links[${i}] must be an object`);
        }
        const row = link as Record<string, unknown>;
        // Backend #285/#294: forward blank/whitespace/padded and self-loop
        // endpoints as-is — never trim/drop into certified match / empty impact.
        if (typeof row.source_id !== 'string' || typeof row.consumer_id !== 'string') {
          throw new ToolFailure(
            'invalid_argument',
            `links[${i}] requires string source_id and consumer_id`,
            {
              actionable:
                'Blank/padded link endpoints fail closed on HTTP as incomplete_dependency_graph; self-loops (source_id === consumer_id) as self_loop_dependency.',
            },
          );
        }
        links.push({ source_id: row.source_id, consumer_id: row.consumer_id });
      }
    }

    let window: { start_ms: number; end_ms: number } | undefined;
    if (args?.window !== undefined) {
      if (!args.window || typeof args.window !== 'object' || Array.isArray(args.window)) {
        throw new ToolFailure('invalid_argument', 'window must be an object');
      }
      const w = args.window as Record<string, unknown>;
      if (typeof w.start_ms !== 'number' || typeof w.end_ms !== 'number') {
        throw new ToolFailure('invalid_argument', 'window requires start_ms and end_ms numbers');
      }
      window = { start_ms: w.start_ms, end_ms: w.end_ms };
    }

    const observedAtMs =
      args?.observed_at_ms === null
        ? null
        : typeof args?.observed_at_ms === 'number'
          ? args.observed_at_ms
          : undefined;

    // W3 after #57/#92/#102: optional padded idempotency_key never certifies a
    // change-impact replay pin (same helper as settle/assess_support).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);

    const raw = await wrapApi(
      client.getChangeImpact({
        ...(answerRevisionId ? { answer_revision_id: answerRevisionId } : {}),
        ...(packetId ? { packet_id: packetId } : {}),
        ...(changedIds && changedIds.length > 0 ? { changed_ids: changedIds } : {}),
        ...(links ? { links } : {}),
        ...(observedAtMs !== undefined ? { observed_at_ms: observedAtMs } : {}),
        ...(window ? { window } : {}),
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateChangeImpact(raw);
    return ok(formatChangeImpact(validated), validated as unknown as Record<string, unknown>);
  },

  create_evidence_packet: async (args, client) => {
    // W3: refuse padded/blank claim_text before HTTP — never trim-launder into
    // a certified sealed packet assertion (same honesty as selectPassage #314).
    assertClaimTextComplete(args?.claim_text);
    // W3: optional operator_class pads never seal into a certified class label
    // (restores #85 after #86 squash clobber).
    assertOptionalOperatorClassComplete(args?.operator_class);
    const claimText = args.claim_text;
    const bindings = args?.bindings;
    if (!Array.isArray(bindings) || bindings.length === 0) {
      throw new ToolFailure('invalid_argument', 'bindings must be a non-empty array', {
        actionable:
          'Provide at least one source_version_id / source_unit_id / representation_id binding.',
      });
    }
    // W3 #264/#279 pad honesty: never trim-launder binding identities into a
    // certified sealed packet (same identityComplete rule as sealed catalog ids).
    const normalizedBindings: Array<{
      source_version_id: string;
      source_unit_id: string;
      representation_id: string;
      snippet?: string;
      seed?: string;
    }> = [];
    for (const [i, binding] of bindings.entries()) {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
        throw new ToolFailure('invalid_argument', `bindings[${i}] must be an object`);
      }
      const row = binding as Record<string, unknown>;
      for (const key of ['source_version_id', 'source_unit_id', 'representation_id'] as const) {
        const value = row[key];
        if (typeof value !== 'string' || !wakeIdentityComplete(value)) {
          throw new ToolFailure(
            'invalid_argument',
            `bindings[${i}].${key} is incomplete (blank/whitespace/padded)`,
            {
              details: {
                reason: 'incomplete_binding_identity',
                field: key,
                index: i,
              },
              actionable:
                'Blank/whitespace/padded binding ids never seal an evidence packet; do not invent or trim-launder a binding hit.',
            },
          );
        }
      }
      // Optional binding snippet/seed: when present as string, blank/whitespace/
      // surrounding pads never trim-launder into a certified sealed packet
      // (same honesty as claim_text #76 / binding ids #264/#279).
      if (typeof row.snippet === 'string' && !selectTextComplete(row.snippet)) {
        throw new ToolFailure(
          'invalid_argument',
          `bindings[${i}].snippet is incomplete (blank/whitespace/padded)`,
          {
            details: {
              reason: 'padded_binding_snippet',
              field: 'snippet',
              index: i,
            },
            actionable:
              'Blank/whitespace/padded binding snippet never seals an evidence packet; omit snippet or pass non-blank unpadded text.',
          },
        );
      }
      if (typeof row.seed === 'string' && !wakeIdentityComplete(row.seed)) {
        throw new ToolFailure(
          'invalid_argument',
          `bindings[${i}].seed is incomplete (blank/whitespace/padded)`,
          {
            details: {
              reason: 'incomplete_binding_seed_identity',
              field: 'seed',
              index: i,
            },
            actionable:
              'Blank/whitespace/padded binding seed never seals an evidence packet; omit seed or pass a non-blank unpadded id.',
          },
        );
      }
      normalizedBindings.push({
        source_version_id: row.source_version_id as string,
        source_unit_id: row.source_unit_id as string,
        representation_id: row.representation_id as string,
        ...(typeof row.snippet === 'string' ? { snippet: row.snippet } : {}),
        ...(typeof row.seed === 'string' ? { seed: row.seed } : {}),
      });
    }
    // W3: optional idempotency_key pads never seal/replay into a certified
    // packet pin — refuse before HTTP (same identityComplete honesty as
    // settle/link/attempt #92/#94/#95).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.createEvidencePacket({
        claim_text: claimText,
        operator_class:
          typeof args?.operator_class === 'string' ? args.operator_class : undefined,
        bindings: normalizedBindings,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateCreatePacket(raw);
    return ok(formatCreatePacket(validated), validated as unknown as Record<string, unknown>);
  },

  assess_support: async (args, client) => {
    // Backend assessSupportBodySchema evidenceId pad honesty: never trim-launder
    // claim_revision_id / claim_hash / evidence_group_revision_id /
    // alternative_fragment_id into a certified support assessment (same
    // identityComplete rule as W3 sealed ids / C3 create identities).
    // Restores #73 claim_hash pad refuse if squash-regressed.
    if (
      typeof args?.claim_revision_id !== 'string' ||
      !wakeIdentityComplete(args.claim_revision_id)
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'claim_revision_id is incomplete (blank/whitespace/padded)',
        {
          details: {
            reason: 'incomplete_claim_revision_identity',
            field: 'claim_revision_id',
          },
          actionable:
            'Blank/whitespace/padded claim_revision_id never certifies support; do not invent or trim-launder a claim hit.',
        },
      );
    }
    const claimRevisionId = args.claim_revision_id;
    if (typeof args?.claim_hash !== 'string' || !wakeIdentityComplete(args.claim_hash)) {
      throw new ToolFailure(
        'invalid_argument',
        'claim_hash is incomplete (blank/whitespace/padded)',
        {
          details: {
            reason: 'incomplete_claim_hash_identity',
            field: 'claim_hash',
          },
          actionable:
            'Blank/whitespace/padded claim_hash never certifies support; do not invent or trim-launder a claim hash hit.',
        },
      );
    }
    const claimHash = args.claim_hash;
    if (
      typeof args?.evidence_group_revision_id !== 'string' ||
      !wakeIdentityComplete(args.evidence_group_revision_id)
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'evidence_group_revision_id is incomplete (blank/whitespace/padded)',
        {
          details: {
            reason: 'incomplete_evidence_group_identity',
            field: 'evidence_group_revision_id',
          },
          actionable:
            'Blank/whitespace/padded evidence_group_revision_id never certifies support; do not invent or trim-launder an evidence-group hit.',
        },
      );
    }
    const evidenceGroupRevisionId = args.evidence_group_revision_id;
    let alternativeFragmentId: string | null | undefined;
    if (args?.alternative_fragment_id === null) {
      alternativeFragmentId = null;
    } else if (typeof args?.alternative_fragment_id === 'string') {
      if (!wakeIdentityComplete(args.alternative_fragment_id)) {
        throw new ToolFailure(
          'invalid_argument',
          'alternative_fragment_id is incomplete (blank/whitespace/padded)',
          {
            details: {
              reason: 'incomplete_alternative_fragment_identity',
              field: 'alternative_fragment_id',
            },
            actionable:
              'Blank/whitespace/padded alternative_fragment_id never certifies an alternative; omit or pass a non-blank unpadded id.',
          },
        );
      }
      alternativeFragmentId = args.alternative_fragment_id;
    }
    const tierRaw = args?.tier;
    const tier =
      tierRaw === 1 || tierRaw === 2 || tierRaw === 3
        ? (tierRaw as 1 | 2 | 3)
        : undefined;
    // W3 after #92/#98/#100: optional padded idempotency_key never certifies an
    // assess-support replay pin (same helper as settle/packet/research).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.assessSupport({
        claim_revision_id: claimRevisionId,
        claim_hash: claimHash,
        evidence_group_revision_id: evidenceGroupRevisionId,
        alternative_fragment_id: alternativeFragmentId,
        tier,
        proposed: typeof args?.proposed === 'string' ? args.proposed : undefined,
        binding: typeof args?.binding === 'string' ? args.binding : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateAssessSupport(raw);
    return ok(formatAssessSupport(validated), validated as unknown as Record<string, unknown>);
  },

  assess_meaning: async (args, client) => {
    if (!args?.assessment || typeof args.assessment !== 'object' || Array.isArray(args.assessment)) {
      throw new ToolFailure('invalid_argument', 'assessment object is required');
    }
    // C5/W3 after #92/#102: optional padded idempotency_key never certifies an
    // assess-meaning replay pin (same helper as settle/assess_support).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.assessMeaning({
        assessment: args.assessment as Record<string, unknown>,
        known_false_claim:
          typeof args?.known_false_claim === 'boolean' ? args.known_false_claim : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateAssessMeaning(raw);
    return ok(formatAssessMeaning(validated), validated as unknown as Record<string, unknown>);
  },

  number_inventory: async (args, client) => {
    if (!Array.isArray(args?.occurrences)) {
      throw new ToolFailure('invalid_argument', 'occurrences must be an array', {
        actionable:
          'Provide occurrences[] with recognition_state, non-blank unpadded raw, and an explicit unpadded method (never invent method=native; never trim-launder padded labels).',
      });
    }
    // W2 after #92/#102/#107: optional padded idempotency_key never certifies a
    // number-inventory replay pin (same helper as settle/formal_eligibility).
    // formal_check Lean source trailing newlines remain untouched.
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    // Pass rows through unchanged — do not default omitted method to native.
    const raw = await wrapApi(
      client.numberInventory({
        occurrences: args.occurrences as NumberInventoryOptions['occurrences'],
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateNumberInventory(raw);
    return ok(formatNumberInventory(validated), validated as unknown as Record<string, unknown>);
  },

  find_contradictions: async (args, client) => {
    if (!Array.isArray(args?.claims) || args.claims.length < 2) {
      throw new ToolFailure('invalid_argument', 'claims must contain at least two rows');
    }
    // W3 after #92/#99/#101/#102: optional padded idempotency_key never certifies
    // a contradiction-scan replay pin (same helper as settle/compare/assess).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    // Backend #256/#289: pass claims through unchanged — do not invent bounds or
    // decimal_value, and never trim-launder surrounding pads into certified known
    // intervals or magnitudes (HTTP refuses contradiction_scan_incomplete).
    const raw = await wrapApi(
      client.findContradictions({
        claims: args.claims as FindContradictionsOptions['claims'],
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateFindContradictions(raw);
    return ok(formatFindContradictions(validated), validated as unknown as Record<string, unknown>);
  },

  formal_eligibility: async (args, client) => {
    if (typeof args?.basis_reviewed !== 'boolean' || typeof args?.recognition !== 'string') {
      throw new ToolFailure('invalid_argument', 'basis_reviewed and recognition are required');
    }
    const recognition = args.recognition;
    if (recognition !== 'native' && recognition !== 'reviewed' && recognition !== 'uncertain') {
      throw new ToolFailure('invalid_argument', 'recognition must be native|reviewed|uncertain');
    }
    // W3/P1 after #92/#102: optional padded idempotency_key never certifies a
    // formal-eligibility replay pin (same helper as settle/assess_support).
    // formal_check Lean source trailing newlines remain untouched.
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.formalEligibility({
        decimal: (args.decimal as string | null | undefined) ?? null,
        unit: (args.unit as string | null | undefined) ?? null,
        scale: (args.scale as string | null | undefined) ?? null,
        basis_reviewed: args.basis_reviewed,
        recognition,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateFormalEligibility(raw);
    return ok(formatFormalEligibility(validated), validated as unknown as Record<string, unknown>);
  },

  formal_check: async (args, client) => {
    if (typeof args?.source !== 'string' || !args.source.trim()) {
      throw new ToolFailure('invalid_argument', 'source is required');
    }
    // W3/P2 after #92/#107/#108: optional padded idempotency_key never certifies
    // a formal-check replay pin (same helper as settle/formal_eligibility).
    // Pass Lean source through unchanged — trailing newlines must not trim.
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.formalCheck({
        source: args.source,
        toolchain_version:
          typeof args?.toolchain_version === 'string' ? args.toolchain_version : undefined,
        checker_digest:
          typeof args?.checker_digest === 'string' ? args.checker_digest : undefined,
        require_lean: typeof args?.require_lean === 'boolean' ? args.require_lean : undefined,
        timeout_ms: typeof args?.timeout_ms === 'number' ? args.timeout_ms : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateFormalCheck(raw);
    return ok(formatFormalCheck(validated), validated as unknown as Record<string, unknown>);
  },

  create_claim_relation: async (args, client) => {
    // C1: refuse padded/blank predicate before HTTP — never trim-launder into
    // a certified catalog relation (same honesty as argument_ids #75).
    assertClaimRelationPredicateComplete(args?.predicate);
    if (typeof args?.arguments_resolved !== 'boolean') {
      throw new ToolFailure('invalid_argument', 'arguments_resolved is required');
    }
    // C1: never trim-launder padded argument_ids / claim_revision_id into a
    // certified persisted claim relation.
    assertClaimRelationArgumentIdsComplete(args?.argument_ids);
    const claimRevisionId = assertOptionalClaimRevisionIdComplete(
      args?.claim_revision_id,
    );
    // C1/W3 after #92/#110/#114: optional padded idempotency_key never certifies
    // a claim-relation create/replay pin (same helper as settle/formal_check).
    // formal_check Lean source trailing newlines remain untouched.
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.createClaimRelation({
        predicate: args.predicate,
        argument_ids: args.argument_ids,
        arguments_resolved: args.arguments_resolved,
        claim_revision_id: claimRevisionId,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateCreateClaimRelation(raw);
    return ok(
      formatCreateClaimRelation(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  list_claim_relations: async (args, client) => {
    // C1: padded optional predicate / claim_revision_id never trim-launder into
    // a certified catalog filter.
    const predicate = assertOptionalClaimRelationPredicateComplete(args?.predicate);
    let claimRevisionId: string | undefined;
    if (typeof args?.claim_revision_id === 'string') {
      if (!wakeIdentityComplete(args.claim_revision_id)) {
        throw new ToolFailure(
          'invalid_argument',
          'claim_revision_id is incomplete (blank/whitespace/padded)',
          {
            details: {
              reason: 'incomplete_claim_revision_identity',
              field: 'claim_revision_id',
            },
            actionable:
              'Blank/whitespace/padded claim_revision_id never certifies a claim-relation hit; do not invent or trim-launder a revision hit.',
          },
        );
      }
      claimRevisionId = args.claim_revision_id;
    }
    const raw = await wrapApi(
      client.listClaimRelations({
        predicate,
        claim_revision_id: claimRevisionId,
      }),
    );
    const validated = validateListClaimRelations(raw);
    return ok(
      formatListClaimRelations(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  create_metric_definition: async (args, client) => {
    if (!args?.definition || typeof args.definition !== 'object' || Array.isArray(args.definition)) {
      throw new ToolFailure('invalid_argument', 'definition object is required');
    }
    // C1 after #92/#112: optional padded idempotency_key never certifies a
    // metric-definition create/replay pin (same helper as settle/number_inventory).
    // formal_check Lean source trailing newlines remain untouched.
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.createMetricDefinition({
        definition: args.definition as Record<string, unknown>,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateCreateMetricDefinition(raw);
    return ok(
      formatCreateMetricDefinition(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  list_metric_definitions: async (args, client) => {
    const raw = await wrapApi(
      client.listMetricDefinitions({
        metric: typeof args?.metric === 'string' ? args.metric : undefined,
      }),
    );
    const validated = validateListMetricDefinitions(raw);
    return ok(
      formatListMetricDefinitions(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  claim_structure_tier: async (args, client) => {
    if (!args?.assertion || typeof args.assertion !== 'object' || Array.isArray(args.assertion)) {
      throw new ToolFailure('invalid_argument', 'assertion object is required');
    }
    // C1/W3 after #92/#112/#114: optional padded idempotency_key never certifies a
    // claim-structure-tier replay pin (same helper as settle/number_inventory).
    // formal_check Lean source trailing newlines remain untouched.
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.claimStructureTier({
        assertion: args.assertion as Record<string, unknown>,
        definition:
          args?.definition === null
            ? null
            : args?.definition && typeof args.definition === 'object' && !Array.isArray(args.definition)
              ? (args.definition as Record<string, unknown>)
              : undefined,
        ambiguity:
          args?.ambiguity === null
            ? null
            : args?.ambiguity && typeof args.ambiguity === 'object' && !Array.isArray(args.ambiguity)
              ? (args.ambiguity as Record<string, unknown>)
              : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateClaimStructureTier(raw);
    return ok(
      formatClaimStructureTier(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  claim_structure_resolve_definition: async (args, client) => {
    if (
      typeof args?.metric !== 'string' ||
      typeof args?.knowledge_as_of !== 'string' ||
      typeof args?.effective_at !== 'string' ||
      !Array.isArray(args?.catalog)
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'metric, knowledge_as_of, effective_at, and catalog are required',
      );
    }
    // C1/W3 after #92/#115/#116: optional padded idempotency_key never certifies
    // a claim-structure resolve-definition replay pin (same helper as
    // settle/create_claim_relation). formal_check Lean source trailing newlines
    // remain untouched.
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.claimStructureResolveDefinition({
        metric: args.metric,
        knowledge_as_of: args.knowledge_as_of,
        effective_at: args.effective_at,
        catalog: args.catalog as Record<string, unknown>[],
        decision:
          args?.decision === null
            ? null
            : args?.decision && typeof args.decision === 'object' && !Array.isArray(args.decision)
              ? (args.decision as Record<string, unknown>)
              : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateClaimStructureResolveDefinition(raw);
    return ok(
      formatClaimStructureResolveDefinition(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  formalize_claim_relation: async (args, client) => {
    // C1: refuse padded/blank predicate before HTTP — never trim-launder into
    // a certified formalize dry-run (same honesty as create #75/#predicate-pad).
    assertClaimRelationPredicateComplete(args?.predicate);
    if (typeof args?.arguments_resolved !== 'boolean') {
      throw new ToolFailure('invalid_argument', 'arguments_resolved is required');
    }
    // C1: never trim-launder padded argument_ids into a certified formalize dry-run.
    assertClaimRelationArgumentIdsComplete(args?.argument_ids);
    const raw = await wrapApi(
      client.formalizeClaimRelation({
        predicate: args.predicate,
        argument_ids: args.argument_ids,
        arguments_resolved: args.arguments_resolved,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateFormalizeClaimRelation(raw);
    return ok(
      formatFormalizeClaimRelation(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  create_research_run: async (args, client) => {
    if (
      typeof args?.objective !== 'string' ||
      typeof args?.snapshot_id !== 'string' ||
      typeof args?.workflow_version !== 'string' ||
      !args?.budget ||
      typeof args.budget !== 'object'
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'objective, snapshot_id, workflow_version, and budget are required',
      );
    }
    // C3: refuse padded/blank objective before HTTP — never trim-launder into
    // a certified research-run purpose (same honesty as claim_text #76).
    assertResearchObjectiveComplete(args.objective);
    // Backend evidenceId / ResearchScope (#281/#297): padded create identities
    // never certify a run — refuse before HTTP (never trim-launder).
    assertCreateResearchIdentityComplete(args);
    // Backend #304: padded open requirement ids never certify a loop stop.
    assertRequirementIdListComplete(
      args?.open_requirement_ids,
      'create_research_run.open_requirement_ids',
      'open_requirement_ids',
    );
    // C3 after #92/#95: optional padded idempotency_key never certifies a
    // create-once research-run replay pin (sibling of settle/attempt pads).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const budget = args.budget as Record<string, unknown>;
    const raw = await wrapApi(
      client.createResearchRun({
        objective: args.objective,
        snapshot_id: args.snapshot_id,
        workflow_version: args.workflow_version,
        deal_id: typeof args?.deal_id === 'string' ? args.deal_id : undefined,
        session_id: typeof args?.session_id === 'string' ? args.session_id : undefined,
        budget: {
          max_credits: Number(budget.max_credits),
          max_tokens: Number(budget.max_tokens),
          deadline_ms: Number(budget.deadline_ms),
        },
        root_operation_id:
          typeof args?.root_operation_id === 'string' || args?.root_operation_id === null
            ? (args.root_operation_id as string | null)
            : undefined,
        root_idempotency_key:
          typeof args?.root_idempotency_key === 'string'
            ? args.root_idempotency_key
            : undefined,
        open_requirement_ids: Array.isArray(args?.open_requirement_ids)
          ? (args.open_requirement_ids as string[])
          : undefined,
        max_steps: typeof args?.max_steps === 'number' ? args.max_steps : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateCreateResearchRun(raw);
    return ok(
      formatCreateResearchRun(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  get_research_run: async (args, client) => {
    // C3: refuse padded/blank run_id before HTTP — never trim-launder into a
    // certified research-run lookup.
    assertResearchRunIdComplete(args?.run_id);
    const raw = await wrapApi(client.getResearchRun({ run_id: args.run_id }));
    const validated = validateGetResearchRun(raw);
    return ok(formatGetResearchRun(validated), validated as unknown as Record<string, unknown>);
  },

  list_research_runs: async (args, client) => {
    // Backend #288: refuse blank/padded client tenant overrides before HTTP.
    assertListTenantArgHonesty(args);
    const raw = await wrapApi(client.listResearchRuns());
    const validated = validateListResearchRuns(raw);
    return ok(
      formatListResearchRuns(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  checkpoint_research_run: async (args, client) => {
    // C3: refuse padded/blank run_id before HTTP — never trim-launder into a
    // certified checkpoint target.
    assertResearchRunIdComplete(args?.run_id);
    if (
      typeof args?.expected_revision !== 'number' ||
      !args?.run ||
      typeof args.run !== 'object'
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'run_id, expected_revision, and run are required',
      );
    }
    const run = args.run as ResearchRunPayload;
    // Backend #268/#277: blank/whitespace wait subject or scope tenant never wakes —
    // refuse before HTTP so equal blanks cannot look like a certified match.
    assertWakeSubjectComplete(run.wait, 'checkpoint_research_run.run.wait');
    assertWakeTenantComplete(run, 'checkpoint_research_run.run');
    // Backend #297: padded note/scope ids never certify eligible memory.
    assertEligibleNotesComplete(run, 'checkpoint_research_run.run');
    // Backend #304: padded loopStop requirement ids never certify a stop.
    assertLoopProgressComplete(run, 'checkpoint_research_run.run');
    // C3 after #92/#95: optional padded idempotency_key never certifies a
    // checkpoint-once replay pin (sibling of create_research_run / settle).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.checkpointResearchRun({
        run_id: args.run_id,
        expected_revision: args.expected_revision,
        // Forward wait/scope/note ids as-is — never invent or strip whitespace.
        run,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateCheckpointResearchRun(raw);
    return ok(
      formatCheckpointResearchRun(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  resolve_seeds: async (args, client) => {
    // Backend #311/#314: refuse padded/blank resolve text before HTTP — never
    // trim-launder into certified seed candidates.
    const text = args?.text;
    assertResolveSeedsTextComplete(text);
    if (args?.index !== undefined && !Array.isArray(args.index)) {
      throw new ToolFailure('invalid_argument', 'index must be an array when provided');
    }
    const filters =
      args?.filters && typeof args.filters === 'object' && !Array.isArray(args.filters)
        ? (args.filters as Record<string, unknown>)
        : undefined;
    // Backend #311: refuse padded/blank filters before HTTP — never trim-launder
    // into a certified scope_tuple or fall through to bare_term.
    assertResolveSeedsFiltersComplete(filters);
    // W2 after #92/#105/#110/#111: optional padded idempotency_key never certifies a
    // resolve-seeds replay pin (same helper as settle/compare_assertions).
    // formal_check Lean source trailing newlines remain untouched (#110).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.resolveSeeds({
        text,
        filters: filters as Record<string, string | null | undefined> | undefined,
        index: Array.isArray(args?.index)
          ? (args.index as ResolveSeedsOptions['index'])
          : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateResolveSeeds(raw);
    return ok(formatResolveSeeds(validated), validated as unknown as Record<string, unknown>);
  },

  expand_seeds: async (args, client) => {
    if (
      !Array.isArray(args?.seeds) ||
      !Array.isArray(args?.edges) ||
      !Array.isArray(args?.allowed)
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'seeds, edges, and allowed are required arrays',
      );
    }
    // C2: refuse padded/blank seed/edge/allowed ids before HTTP — never
    // trim-launder equal pads into a certified authorized expansion.
    assertExpandSeedGraphComplete({
      seeds: args.seeds,
      edges: args.edges,
      allowed: args.allowed,
    });
    if (
      args?.hops !== undefined &&
      (typeof args.hops !== 'number' || !Number.isFinite(args.hops))
    ) {
      throw new ToolFailure('invalid_argument', 'hops must be a finite number when provided');
    }
    // C2/W2 after #92/#106/#115: optional padded idempotency_key never certifies
    // an expand-seeds replay pin (same helper as settle/create_claim_relation).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.expandSeeds({
        seeds: args.seeds as string[],
        edges: args.edges as Array<{ from: string; to: string }>,
        allowed: args.allowed as string[],
        hops: typeof args?.hops === 'number' ? args.hops : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateExpandSeeds(raw);
    return ok(formatExpandSeeds(validated), validated as unknown as Record<string, unknown>);
  },

  learning_judge: async (args, client) => {
    if (typeof args?.verdict !== 'string' || typeof args?.attempts !== 'number') {
      throw new ToolFailure('invalid_argument', 'verdict and attempts are required');
    }
    const verdict = args.verdict;
    if (
      verdict !== 'pass' &&
      verdict !== 'fail' &&
      verdict !== 'uncertain' &&
      verdict !== 'error'
    ) {
      throw new ToolFailure('invalid_argument', 'verdict must be pass|fail|uncertain|error');
    }
    const raw = await wrapApi(
      client.learningJudge({
        hard_failures: Array.isArray(args?.hard_failures)
          ? (args.hard_failures as string[])
          : undefined,
        verdict,
        attempts: args.attempts,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateLearningJudge(raw);
    return ok(formatLearningJudge(validated), validated as unknown as Record<string, unknown>);
  },

  learning_apply: async (args, client) => {
    if (!args?.proposal || typeof args.proposal !== 'object' || Array.isArray(args.proposal)) {
      throw new ToolFailure('invalid_argument', 'proposal object is required');
    }
    const gate =
      args.gate === null
        ? null
        : args.gate && typeof args.gate === 'object' && !Array.isArray(args.gate)
          ? (args.gate as { gateId: string; allowed: boolean; reason: string })
          : null;
    const raw = await wrapApi(
      client.learningApply({
        proposal: args.proposal as Record<string, unknown>,
        gate,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateLearningApply(raw);
    return ok(formatLearningApply(validated), validated as unknown as Record<string, unknown>);
  },

  learning_placeholder: async (args, client) => {
    const raw = await wrapApi(
      client.learningPlaceholder({
        criterion: typeof args?.criterion === 'string' ? args.criterion : undefined,
      }),
    );
    const validated = validateLearningPlaceholder(raw);
    return ok(
      formatLearningPlaceholder(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  format_certify: async (args, client) => {
    if (
      typeof args?.kind !== 'string' ||
      !Array.isArray(args?.expected) ||
      !Array.isArray(args?.found)
    ) {
      throw new ToolFailure('invalid_argument', 'kind, expected, and found are required');
    }
    const allowed = new Set([
      'spreadsheet',
      'office',
      'text',
      'image',
      'container',
      'media',
    ]);
    if (!allowed.has(args.kind)) {
      throw new ToolFailure(
        'invalid_argument',
        'kind must be spreadsheet|office|text|image|container|media',
      );
    }
    const raw = await wrapApi(
      client.formatCertify({
        kind: args.kind as
          | 'spreadsheet'
          | 'office'
          | 'text'
          | 'image'
          | 'container'
          | 'media',
        expected: args.expected,
        found: args.found,
        decode_finished:
          typeof args?.decode_finished === 'boolean'
            ? args.decode_finished
            : undefined,
        alignments: Array.isArray(args?.alignments) ? args.alignments : undefined,
        require_precise_timing:
          typeof args?.require_precise_timing === 'boolean'
            ? args.require_precise_timing
            : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateFormatCertify(raw);
    return ok(formatFormatCertify(validated), validated as unknown as Record<string, unknown>);
  },

  reserve_research_budget: async (args, client) => {
    // C3: refuse padded/blank run_id before HTTP — never trim-launder into a
    // certified reserve against another run.
    assertResearchRunIdComplete(args?.run_id);
    // C3/I4 after #83: padded idempotency_key / kind never certify a budget
    // reserve replay (same honesty as open_operation_root).
    assertOperationIdempotencyKindComplete(
      args,
      'run_id, idempotency_key, kind, and credits are required',
      'a research-budget reserve/replay',
    );
    if (typeof args?.credits !== 'number') {
      throw new ToolFailure(
        'invalid_argument',
        'run_id, idempotency_key, kind, and credits are required',
      );
    }
    const raw = await wrapApi(
      client.reserveResearchBudget({
        run_id: args.run_id,
        idempotency_key: args.idempotency_key as string,
        kind: args.kind as string,
        credits: args.credits,
        tokens: typeof args?.tokens === 'number' ? args.tokens : undefined,
      }),
    );
    const validated = validateReserveResearchBudget(raw);
    return ok(
      formatReserveResearchBudget(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  open_operation_root: async (args, client) => {
    // C3/I4: padded idempotency_key / kind never certify a root open/replay.
    assertOpenOperationRootIdentityComplete(args);
    if (
      typeof args?.max_credits !== 'number' ||
      typeof args?.max_tokens !== 'number' ||
      typeof args?.deadline_ms !== 'number'
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'idempotency_key, kind, max_credits, max_tokens, and deadline_ms are required',
      );
    }
    const raw = await wrapApi(
      client.openOperationRoot({
        idempotency_key: args.idempotency_key as string,
        kind: args.kind as string,
        max_credits: args.max_credits,
        max_tokens: args.max_tokens,
        deadline_ms: args.deadline_ms,
      }),
    );
    const validated = validateOpenOperationRoot(raw);
    return ok(
      formatOpenOperationRoot(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  reserve_operation: async (args, client) => {
    // C3/I4: padded idempotency_key / kind never certify a reserve/replay
    // (sibling of open_operation_root #83).
    assertOperationIdempotencyKindComplete(
      args,
      'idempotency_key, kind, and credits are required',
      'an operation reserve/replay',
    );
    if (typeof args?.credits !== 'number') {
      throw new ToolFailure(
        'invalid_argument',
        'idempotency_key, kind, and credits are required',
      );
    }
    const raw = await wrapApi(
      client.reserveOperation({
        idempotency_key: args.idempotency_key as string,
        kind: args.kind as string,
        credits: args.credits,
        tokens: typeof args?.tokens === 'number' ? args.tokens : undefined,
        root_operation_id: (() => {
          if (typeof args?.root_operation_id !== 'string') return null;
          // Same evidenceId pad honesty as create_research_run.root_operation_id.
          if (!wakeIdentityComplete(args.root_operation_id)) {
            throw new ToolFailure(
              'invalid_argument',
              'root_operation_id is incomplete (blank/whitespace/padded)',
              {
                details: {
                  reason: 'incomplete_operation_identity',
                  field: 'root_operation_id',
                },
                actionable:
                  'Blank/whitespace/padded root_operation_id never certifies a shared root; pass null to omit or a non-blank unpadded id.',
              },
            );
          }
          return args.root_operation_id;
        })(),
      }),
    );
    const validated = validateReserveOperation(raw);
    return ok(
      formatReserveOperation(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  get_operation: async (args, client) => {
    // C3/I4: refuse padded/blank operation_id before HTTP — never trim-launder
    // into a certified EvidenceOperation lookup.
    assertEvidenceOperationIdComplete(args?.operation_id);
    const raw = await wrapApi(client.getOperation({ operation_id: args.operation_id }));
    const validated = validateGetOperation(raw);
    return ok(formatGetOperation(validated), validated as unknown as Record<string, unknown>);
  },

  get_operation_availability: async (args, client) => {
    // C3/I4: refuse padded/blank operation_id before HTTP — never trim-launder
    // into a certified availability lookup.
    assertEvidenceOperationIdComplete(args?.operation_id);
    const raw = await wrapApi(
      client.getOperationAvailability({ operation_id: args.operation_id }),
    );
    const validated = validateGetOperationAvailability(raw);
    return ok(
      formatGetOperationAvailability(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  settle_operation: async (args, client) => {
    // C3/I4: refuse padded/blank operation_id before HTTP — never trim-launder
    // into a certified settle target.
    assertEvidenceOperationIdComplete(args?.operation_id);
    // C3/I4 after #88: optional padded idempotency_key never certifies a settle
    // replay pin (same honesty as required reserve_operation idempotency).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    if (args?.settled_credits !== null && typeof args?.settled_credits !== 'number') {
      throw new ToolFailure(
        'invalid_argument',
        'settled_credits must be a number or null',
      );
    }
    const raw = await wrapApi(
      client.settleOperation({
        operation_id: args.operation_id,
        settled_credits: args.settled_credits as number | null,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateSettleOperation(raw);
    return ok(
      formatSettleOperation(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  release_operation: async (args, client) => {
    // C3/I4: refuse padded/blank operation_id before HTTP — never trim-launder
    // into a certified release target.
    assertEvidenceOperationIdComplete(args?.operation_id);
    const raw = await wrapApi(
      client.releaseOperation({ operation_id: args.operation_id }),
    );
    const validated = validateReleaseOperation(raw);
    return ok(
      formatReleaseOperation(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  record_operation_attempt: async (args, client) => {
    // C3/I4: refuse padded/blank operation_id before HTTP — never trim-launder
    // into a certified attempt record target.
    assertEvidenceOperationIdComplete(args?.operation_id);
    // C3/I4: padded provider / model / provider_idempotency_key never certify
    // attempt attribution or a provider replay pin (sibling of kind #83/#87).
    assertRecordOperationAttemptProviderComplete(args);
    // C3/I4 after #92/#94: optional padded idempotency_key never certifies an
    // attempt-record replay pin (same helper as settle/link).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.recordOperationAttempt({
        operation_id: args.operation_id,
        provider: args.provider as string,
        model:
          typeof args?.model === 'string' || args?.model === null
            ? (args.model as string | null)
            : undefined,
        provider_idempotency_key:
          typeof args?.provider_idempotency_key === 'string' ||
          args?.provider_idempotency_key === null
            ? (args.provider_idempotency_key as string | null)
            : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateRecordOperationAttempt(raw);
    return ok(
      formatRecordOperationAttempt(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  resolve_operation_attempt: async (args, client) => {
    // C3/I4: refuse padded/blank attempt_id before HTTP — never trim-launder
    // into a certified attempt resolve.
    assertEvidenceAttemptIdComplete(args?.attempt_id);
    if (
      args?.state !== 'succeeded' &&
      args?.state !== 'failed' &&
      args?.state !== 'outcome_unknown'
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'state must be succeeded|failed|outcome_unknown',
      );
    }
    // C3/I4 after #89: padded failure_class / price fields never certify an
    // outcome class or settlement pin (null failure_class / null|omit price ok).
    assertResolveOperationAttemptOutcomeComplete(args);
    // C3/I4 after #92/#94: optional padded idempotency_key never certifies an
    // attempt-resolve replay pin (same helper as settle/link).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.resolveOperationAttempt({
        attempt_id: args.attempt_id,
        state: args.state,
        failure_class:
          typeof args?.failure_class === 'string' || args?.failure_class === null
            ? (args.failure_class as string | null)
            : undefined,
        measurements:
          args?.measurements &&
          typeof args.measurements === 'object' &&
          !Array.isArray(args.measurements)
            ? (args.measurements as Record<string, unknown>)
            : undefined,
        price:
          args?.price === null
            ? null
            : args?.price && typeof args.price === 'object' && !Array.isArray(args.price)
              ? (args.price as {
                  amount: string;
                  currency: string;
                  priceRevision: string;
                })
              : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateResolveOperationAttempt(raw);
    return ok(
      formatResolveOperationAttempt(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  link_operation_consumer: async (args, client) => {
    // C3/I4: refuse padded/blank operation_id and consumer identity before HTTP —
    // never trim-launder into a certified consumer link.
    assertEvidenceOperationIdComplete(args?.operation_id);
    const consumerKind = args?.consumer_kind;
    const consumerId = args?.consumer_id;
    assertEvidenceConsumerIdentityComplete({
      consumer_kind: consumerKind,
      consumer_id: consumerId,
    });
    // C3/I4 after #92: optional padded idempotency_key never certifies a consumer
    // link replay pin (same honesty as settle_operation optional idempotency).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.linkOperationConsumer({
        operation_id: args.operation_id,
        consumer_kind: consumerKind as string,
        consumer_id: consumerId as string,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateLinkOperationConsumer(raw);
    return ok(
      formatLinkOperationConsumer(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  get_consumer_usage: async (args, client) => {
    // C3/I4: refuse padded/blank consumer identity before HTTP — never
    // trim-launder into a certified usage aggregate.
    const consumerKind = args?.consumer_kind;
    const consumerId = args?.consumer_id;
    assertEvidenceConsumerIdentityComplete({
      consumer_kind: consumerKind,
      consumer_id: consumerId,
    });
    const raw = await wrapApi(
      client.getConsumerUsage({
        consumer_kind: consumerKind as string,
        consumer_id: consumerId as string,
      }),
    );
    const validated = validateGetConsumerUsage(raw);
    return ok(
      formatGetConsumerUsage(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  get_provider_cost: async (args, client) => {
    if (!Array.isArray(args?.operation_ids) || args.operation_ids.length === 0) {
      throw new ToolFailure('invalid_argument', 'operation_ids array is required');
    }
    // C3/I4: refuse blank/padded operation_ids before HTTP — never trim-launder
    // into a certified provider-cost aggregate.
    for (const [i, id] of (args.operation_ids as unknown[]).entries()) {
      if (typeof id !== 'string' || !wakeIdentityComplete(id)) {
        throw new ToolFailure(
          'invalid_argument',
          `operation_ids[${i}] is incomplete (blank/whitespace/padded)`,
          {
            details: {
              reason: 'incomplete_operation_identity',
              field: 'operation_ids',
              index: i,
            },
            actionable:
              'Blank/whitespace/padded operation_ids never certify provider cost; do not invent or trim-launder an operation match.',
          },
        );
      }
    }
    // C3/I4 after #92/#95/#97: optional padded idempotency_key never certifies
    // a provider-cost replay pin (same helper as settle/attempt/workflow).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.getProviderCost({
        operation_ids: args.operation_ids as string[],
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateGetProviderCost(raw);
    return ok(
      formatGetProviderCost(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  formal_resolution_state: async (args, client) => {
    // W3/P4 after #92/#107: optional padded idempotency_key never certifies a
    // formal-resolution-state replay pin (same helper as formal_eligibility).
    // formal_check Lean source trailing newlines remain untouched.
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.formalResolutionState({
        missing_operands:
          typeof args?.missing_operands === 'boolean' ? args.missing_operands : undefined,
        undefined_definition:
          typeof args?.undefined_definition === 'boolean'
            ? args.undefined_definition
            : undefined,
        proof_search_failed:
          typeof args?.proof_search_failed === 'boolean'
            ? args.proof_search_failed
            : undefined,
        proof_timed_out:
          typeof args?.proof_timed_out === 'boolean' ? args.proof_timed_out : undefined,
        counterexample_found:
          typeof args?.counterexample_found === 'boolean'
            ? args.counterexample_found
            : undefined,
        checked_negation:
          typeof args?.checked_negation === 'boolean' ? args.checked_negation : undefined,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateFormalResolutionState(raw);
    return ok(
      formatFormalResolutionState(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  formal_revenue_bridge: async (args, client) => {
    if (
      typeof args?.totalPoints !== 'string' ||
      typeof args?.currency !== 'string' ||
      typeof args?.period !== 'string' ||
      typeof args?.entityId !== 'string' ||
      typeof args?.scale !== 'string' ||
      !Array.isArray(args?.components)
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'totalPoints, currency, period, entityId, scale, and components are required',
      );
    }
    const raw = await wrapApi(
      client.formalRevenueBridge({
        totalPoints: args.totalPoints,
        currency: args.currency,
        period: args.period,
        entityId: args.entityId,
        scale: args.scale,
        components: args.components as FormalRevenueBridgeOptions['components'],
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateFormalRevenueBridge(raw);
    return ok(
      formatFormalRevenueBridge(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  eval_catalog: async (_args, client) => {
    const raw = await wrapApi(client.evalCatalog());
    const validated = validateEvalCatalog(raw);
    return ok(formatEvalCatalog(validated), validated as unknown as Record<string, unknown>);
  },

  certify_private_upload: async (_args, client) => {
    const raw = await wrapApi(client.certifyPrivateUpload());
    const validated = validateCertifyPrivateUpload(raw);
    return ok(
      formatCertifyPrivateUpload(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  certify_retrieve_flag: async (_args, client) => {
    const raw = await wrapApi(client.certifyRetrieveFlag());
    const validated = validateCertifyRetrieveFlag(raw);
    return ok(
      formatCertifyRetrieveFlag(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  proofs_applies: async (args, client) => {
    if (
      typeof args?.status !== 'string' ||
      typeof args?.binding_hash !== 'string' ||
      typeof args?.toolchain_version !== 'string' ||
      typeof args?.current_binding_hash !== 'string'
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'status, binding_hash, toolchain_version, and current_binding_hash are required',
      );
    }
    const raw = await wrapApi(
      client.proofsApplies({
        status: args.status,
        binding_hash: args.binding_hash,
        toolchain_version: args.toolchain_version,
        current_binding_hash: args.current_binding_hash,
        approved_toolchains: Array.isArray(args?.approved_toolchains)
          ? (args.approved_toolchains as string[])
          : undefined,
        checker_digest:
          typeof args?.checker_digest === 'string' ? args.checker_digest : undefined,
      }),
    );
    const validated = validateProofsApplies(raw);
    return ok(formatProofsApplies(validated), validated as unknown as Record<string, unknown>);
  },

  publish_context_workflow: async (args, client) => {
    if (!args?.workflow || typeof args.workflow !== 'object' || Array.isArray(args.workflow)) {
      throw new ToolFailure('invalid_argument', 'workflow object is required');
    }
    // W3: optional padded idempotency_key never certifies a publish-once pin
    // (sibling of settle/link #92/#94).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.publishContextWorkflow(
        args.workflow as import('./types.js').SavedWorkflowPayload,
        typeof args.idempotency_key === 'string' ? args.idempotency_key : undefined,
      ),
    );
    return ok(
      `# Workflow Published\n\n**Revision:** ${(raw as any).revision ?? (raw as any).workflow?.revision}`,
      raw as unknown as Record<string, unknown>,
    );
  },

  get_context_workflow: async (args, client) => {
    // W3: padded revision_id never certifies a saved workflow revision.
    assertWorkflowPathIdComplete(
      args?.revision_id,
      'revision_id',
      'incomplete_workflow_revision_identity',
    );
    const raw = await wrapApi(client.getContextWorkflow(args.revision_id));
    return ok(
      `# Context Workflow\n\n**Revision:** ${raw.revision}\n**Kind:** ${raw.kind}\n**Trigger:** ${raw.trigger}`,
      raw as unknown as Record<string, unknown>,
    );
  },

  run_saved_workflow: async (args, client) => {
    // W3: padded revision_id / event_id never certify a saved workflow run.
    assertWorkflowPathIdComplete(
      args?.revision_id,
      'revision_id',
      'incomplete_workflow_revision_identity',
    );
    const mode = requireString(args, 'mode');
    if (mode !== 'preview' && mode !== 'propose') {
      throw new ToolFailure('invalid_argument', 'mode must be preview or propose');
    }
    assertWorkflowPathIdComplete(
      args?.event_id,
      'event_id',
      'incomplete_workflow_event_identity',
    );
    if (!args?.input || typeof args.input !== 'object' || Array.isArray(args.input)) {
      throw new ToolFailure('invalid_argument', 'input object is required');
    }
    // W3: optional padded idempotency_key never certifies a run-once pin
    // (sibling of settle/link #92/#94).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.runSavedWorkflow({
        revision_id: args.revision_id,
        mode,
        event_id: args.event_id,
        input: args.input as Record<string, unknown>,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    return ok(
      `# Workflow Run\n\n**Run:** ${raw.runId}\n**Mode:** ${raw.mode}\n**Review item:** ${
        raw.reviewItem ? `${raw.reviewItem.system}/${raw.reviewItem.id}` : 'null'
      }`,
      raw as unknown as Record<string, unknown>,
    );
  },

  get_workflow_run: async (args, client) => {
    // W3: padded run_id never certifies a workflow run artifact.
    assertWorkflowPathIdComplete(args?.run_id, 'run_id', 'incomplete_workflow_run_identity');
    const raw = await wrapApi(client.getWorkflowRun(args.run_id));
    return ok(
      `# Workflow Run\n\n**Run:** ${raw.runId}\n**Workflow revision:** ${raw.workflowRevision}`,
      raw as unknown as Record<string, unknown>,
    );
  },

  get_evaluation: async (args, client) => {
    // W3: padded run_id never certifies an evaluation run artifact.
    assertEvalPathIdComplete(args?.run_id, 'run_id', 'incomplete_evaluation_run_identity');
    const raw = await wrapApi(client.getEvaluation(args.run_id));
    return ok(
      `# Evaluation Run\n\n**Run:** ${raw.run_id}\n**Private gold denied:** ${raw.private_gold_denied ? 'yes' : 'no'}`,
      raw as unknown as Record<string, unknown>,
    );
  },

  compare_evaluations: async (args, client) => {
    // W3: padded baseline/candidate run ids never certify a compare hit.
    assertEvalPathIdComplete(
      args?.baseline_run_id,
      'baseline_run_id',
      'incomplete_evaluation_run_identity',
    );
    assertEvalPathIdComplete(
      args?.candidate_run_id,
      'candidate_run_id',
      'incomplete_evaluation_run_identity',
    );
    // W3 after #79/#95/#97–#100: optional padded idempotency_key never certifies
    // a compare replay pin (same helper as settle/link/attempt/workflow/research).
    assertOptionalOperationIdempotencyKeyComplete(args?.idempotency_key);
    const raw = await wrapApi(
      client.compareEvaluations({
        baseline_run_id: args.baseline_run_id,
        candidate_run_id: args.candidate_run_id,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    return ok(
      `# Evaluation Compare\n\n**Baseline:** ${raw.baseline_run_id}\n**Candidate:** ${raw.candidate_run_id}`,
      raw as unknown as Record<string, unknown>,
    );
  },

  get_evaluation_case: async (args, client) => {
    // W3: padded run_id / case_id never certify an evaluation case artifact.
    assertEvalPathIdComplete(args?.run_id, 'run_id', 'incomplete_evaluation_run_identity');
    assertEvalPathIdComplete(args?.case_id, 'case_id', 'incomplete_evaluation_case_identity');
    const raw = await wrapApi(client.getEvaluationCase(args.run_id, args.case_id));
    return ok(
      `# Evaluation Case\n\n**Run:** ${raw.run_id}\n**Case:** ${raw.case_id}`,
      raw as unknown as Record<string, unknown>,
    );
  },
};
