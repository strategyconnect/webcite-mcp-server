/**
 * Validate API responses before exposing structuredContent.
 * Render text from the same validated object — never regenerate evidence.
 */

import { ToolFailure } from './errors.js';
import {
  NUMBER_OCCURRENCE_METHODS,
  NUMBER_OCCURRENCE_INTERPRETATIONS,
} from './types.js';
import type {
  ChangeImpactResponse,
  CompareAssertionsResponse,
  ResolveFragmentUsesResponse,
  FragmentUseMatch,
  FragmentUseMatchKind,
  ContextQueryResponse,
  CreateEvidencePacketResponse,
  AssessSupportResponse,
  AssessMeaningResponse,
  FindContradictionsResponse,
  NumberInventoryResponse,
  NumberInventoryOccurrence,
  NumberOccurrenceMethod,
  NumberOccurrenceInterpretation,
  NumberRecognitionState,
  FormalEligibilityResponse,
  FormalCheckResponse,
  CreateClaimRelationResponse,
  ListClaimRelationsResponse,
  CreateMetricDefinitionResponse,
  ListMetricDefinitionsResponse,
  CreateResearchRunResponse,
  GetResearchRunResponse,
  CheckpointResearchRunResponse,
  ResolveSeedsResponse,
  ExpandSeedsResponse,
  LearningJudgeResponse,
  LearningApplyResponse,
  LearningPlaceholderResponse,
  FormatCertifyResponse,
  ReserveResearchBudgetResponse,
  OpenOperationRootResponse,
  ReserveOperationResponse,
  GetOperationResponse,
  GetOperationAvailabilityResponse,
  SettleOperationResponse,
  ReleaseOperationResponse,
  RecordOperationAttemptResponse,
  ResolveOperationAttemptResponse,
  LinkOperationConsumerResponse,
  GetConsumerUsageResponse,
  GetProviderCostResponse,
  ProofsAppliesResponse,
  FormalResolutionStateResponse,
  FormalRevenueBridgeResponse,
  ClaimStructureTierResponse,
  ClaimStructureResolveDefinitionResponse,
  FormalizeClaimRelationResponse,
  EvalCatalogResponse,
  CertifyPrivateUploadResponse,
  CertifyRetrieveFlagResponse,
  ResolvedAnswerResponse,
  ResolvedPacketResponse,
  ScopeCompareResult,
} from './types.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) {
    throw new ToolFailure('invalid_api_output', `${label} must be an object`, {
      actionable: 'Do not invent a substitute response; retry or report the API contract drift.',
    });
  }
  return value;
}

function requireString(obj: Record<string, unknown>, key: string, label: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolFailure('invalid_api_output', `${label}.${key} is required`, {
      details: { key },
      actionable: 'Reject the payload; do not regenerate missing identity fields.',
    });
  }
  return value;
}

export function validateResolvedAnswer(raw: unknown): ResolvedAnswerResponse {
  const root = requireObject(raw, 'ResolvedAnswer');
  const answer = requireObject(root.answer, 'ResolvedAnswer.answer');
  const evidence = requireObject(root.evidence, 'ResolvedAnswer.evidence');
  const packet = requireObject(evidence.packet, 'ResolvedAnswer.evidence.packet');

  return {
    ...(root as unknown as ResolvedAnswerResponse),
    answer: {
      id: requireString(answer, 'id', 'answer'),
      revisionId: requireString(answer, 'revisionId', 'answer'),
      contentHash: requireString(answer, 'contentHash', 'answer'),
      text: typeof answer.text === 'string' ? answer.text : '',
      textHash: typeof answer.textHash === 'string' ? answer.textHash : undefined,
      inputPacketId: requireString(answer, 'inputPacketId', 'answer'),
      inputPacketContentHash: requireString(answer, 'inputPacketContentHash', 'answer'),
      outputPacketId: requireString(answer, 'outputPacketId', 'answer'),
      schemaVersion: typeof answer.schemaVersion === 'number' ? answer.schemaVersion : undefined,
      justifications: Array.isArray(answer.justifications) ? answer.justifications : undefined,
      spans: Array.isArray(answer.spans) ? answer.spans : undefined,
    },
    evidence: {
      ...evidence,
      packet: {
        id: requireString(packet, 'id', 'packet'),
        contentHash: requireString(packet, 'contentHash', 'packet'),
        operationId: typeof packet.operationId === 'string' ? packet.operationId : undefined,
        engineVersion: typeof packet.engineVersion === 'string' ? packet.engineVersion : undefined,
        refs: Array.isArray(packet.refs) ? (packet.refs as ResolvedAnswerResponse['evidence']['packet']['refs']) : [],
        gaps: Array.isArray(packet.gaps) ? (packet.gaps as string[]) : [],
        assertions: Array.isArray(packet.assertions)
          ? (packet.assertions as NonNullable<ResolvedAnswerResponse['evidence']['packet']['assertions']>)
          : [],
      },
    },
  };
}

export function validateResolvedPacket(raw: unknown): ResolvedPacketResponse {
  const root = requireObject(raw, 'ResolvedPacket');
  const packet = requireObject(root.packet, 'ResolvedPacket.packet');
  return {
    ...root,
    packet: {
      id: requireString(packet, 'id', 'packet'),
      contentHash: requireString(packet, 'contentHash', 'packet'),
      operationId: typeof packet.operationId === 'string' ? packet.operationId : undefined,
      engineVersion: typeof packet.engineVersion === 'string' ? packet.engineVersion : undefined,
      refs: Array.isArray(packet.refs) ? (packet.refs as ResolvedPacketResponse['packet']['refs']) : [],
      gaps: Array.isArray(packet.gaps) ? (packet.gaps as string[]) : [],
      assertions: Array.isArray(packet.assertions)
        ? (packet.assertions as NonNullable<ResolvedPacketResponse['packet']['assertions']>)
        : [],
    },
  };
}

export function validateContextQuery(raw: unknown): ContextQueryResponse {
  const root = requireObject(raw, 'ContextQuery');
  const status = root.status;
  if (status !== 'ok' && status !== 'refuse') {
    throw new ToolFailure('invalid_api_output', 'ContextQuery.status must be ok or refuse', {
      actionable: 'Treat malformed status as failure; empty refs with status refuse is a successful no-match.',
    });
  }
  if (!Array.isArray(root.refs)) {
    throw new ToolFailure('invalid_api_output', 'ContextQuery.refs must be an array', {
      actionable: 'Do not invent refs when the API omits them.',
    });
  }
  return {
    operatorClass: typeof root.operatorClass === 'string' ? root.operatorClass : 'unsupported',
    status,
    refuseReason: typeof root.refuseReason === 'string' ? root.refuseReason : undefined,
    queryPlan: isObject(root.queryPlan)
      ? {
          operatorClass:
            typeof root.queryPlan.operatorClass === 'string'
              ? root.queryPlan.operatorClass
              : String(root.operatorClass ?? ''),
          seeds: Array.isArray(root.queryPlan.seeds) ? (root.queryPlan.seeds as string[]) : [],
          truncated: root.queryPlan.truncated === true,
          traversedRelationIds: Array.isArray(root.queryPlan.traversedRelationIds)
            ? (root.queryPlan.traversedRelationIds as string[])
            : [],
        }
      : {
          operatorClass: String(root.operatorClass ?? ''),
          seeds: [],
          truncated: false,
          traversedRelationIds: [],
        },
    refs: root.refs as ContextQueryResponse['refs'],
    gaps: Array.isArray(root.gaps) ? (root.gaps as string[]) : [],
    engine: root.engine === 'context_graph' ? 'context_graph' : 'context_graph',
    presentation: isObject(root.presentation)
      ? {
          numbered_refs: Array.isArray(root.presentation.numbered_refs)
            ? (root.presentation.numbered_refs as NonNullable<
                ContextQueryResponse['presentation']
              >['numbered_refs'])
            : [],
        }
      : undefined,
  };
}

const COMPARE_RESULTS: ScopeCompareResult[] = ['same', 'different', 'unknown'];

export function validateCompareAssertions(raw: unknown): CompareAssertionsResponse {
  const root = requireObject(raw, 'CompareAssertions');
  if (!COMPARE_RESULTS.includes(root.result as ScopeCompareResult)) {
    throw new ToolFailure('invalid_api_output', 'CompareAssertions.result must be same|different|unknown', {
      actionable: 'Never treat a missing result as contradiction.',
    });
  }
  return {
    result: root.result as ScopeCompareResult,
    left: isObject(root.left) ? root.left : {},
    right: isObject(root.right) ? root.right : {},
  };
}

const FRAGMENT_USE_MATCH_KINDS: FragmentUseMatchKind[] = [
  'exact',
  'contains',
  'contained',
  'overlap',
];

function validateFragmentUseMatch(raw: unknown, index: number): FragmentUseMatch {
  const row = requireObject(raw, `ResolveFragmentUses.matches[${index}]`);
  if (!FRAGMENT_USE_MATCH_KINDS.includes(row.matchKind as FragmentUseMatchKind)) {
    throw new ToolFailure(
      'invalid_api_output',
      `ResolveFragmentUses.matches[${index}].matchKind must be exact|contains|contained|overlap`,
    );
  }
  if (row.semanticSupport !== false) {
    throw new ToolFailure(
      'invalid_api_output',
      `ResolveFragmentUses.matches[${index}].semanticSupport must be false`,
      {
        actionable: 'Overlap never implies semantic support; do not invent supported.',
      },
    );
  }
  const useAge = row.useAge;
  if (useAge !== 'current' && useAge !== 'historical') {
    throw new ToolFailure(
      'invalid_api_output',
      `ResolveFragmentUses.matches[${index}].useAge must be current|historical`,
    );
  }
  return {
    matchKind: row.matchKind as FragmentUseMatchKind,
    fragmentId: requireString(row, 'fragmentId', `ResolveFragmentUses.matches[${index}]`),
    groupIds: Array.isArray(row.groupIds) ? (row.groupIds as string[]) : [],
    linkIds: Array.isArray(row.linkIds) ? (row.linkIds as string[]) : [],
    consumerIds: Array.isArray(row.consumerIds) ? (row.consumerIds as string[]) : [],
    useAge,
    semanticSupport: false,
  };
}

export function validateResolveFragmentUses(raw: unknown): ResolveFragmentUsesResponse {
  const root = requireObject(raw, 'ResolveFragmentUses');
  if (root.status !== 'ok' && root.status !== 'refuse') {
    throw new ToolFailure(
      'invalid_api_output',
      'ResolveFragmentUses.status must be ok|refuse',
      {
        actionable: 'Refuse is not an HTTP error; do not invent matches on contract drift.',
      },
    );
  }
  if (!Array.isArray(root.matches)) {
    throw new ToolFailure('invalid_api_output', 'ResolveFragmentUses.matches must be an array');
  }
  const matches = root.matches.map((row, i) => validateFragmentUseMatch(row, i));
  if (root.status === 'refuse' && matches.length > 0) {
    throw new ToolFailure(
      'invalid_api_output',
      'ResolveFragmentUses refuse must return empty matches',
    );
  }
  const nextCursor =
    root.nextCursor === null || typeof root.nextCursor === 'string' ? root.nextCursor : null;
  return {
    status: root.status,
    reason: typeof root.reason === 'string' ? root.reason : undefined,
    matches,
    nextCursor,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
    packet_id: typeof root.packet_id === 'string' ? root.packet_id : undefined,
    answer_revision_id:
      typeof root.answer_revision_id === 'string' ? root.answer_revision_id : undefined,
  };
}

export function validateChangeImpact(raw: unknown): ChangeImpactResponse {
  const root = requireObject(raw, 'ChangeImpact');
  const hasFreshness = root.freshness !== undefined && root.freshness !== null;
  const hasPacketImpact = root.packet_impact !== undefined && root.packet_impact !== null;
  if (!hasFreshness && !hasPacketImpact) {
    throw new ToolFailure(
      'invalid_api_output',
      'ChangeImpact requires freshness and/or packet_impact',
      {
        actionable:
          'Do not treat a bare engine envelope as certified no-impact or no-freshness.',
      },
    );
  }

  let freshness: ChangeImpactResponse['freshness'];
  if (hasFreshness) {
    const f = requireObject(root.freshness, 'ChangeImpact.freshness');
    const coverage = f.coverage;
    if (coverage !== 'complete' && coverage !== 'unknown') {
      throw new ToolFailure(
        'invalid_api_output',
        'ChangeImpact.freshness.coverage must be complete|unknown',
        {
          actionable: 'Do not report silent "no changes" when coverage is missing.',
        },
      );
    }
    freshness = {
      claimRevisionIds: Array.isArray(f.claimRevisionIds) ? (f.claimRevisionIds as string[]) : [],
      coverage,
      unresolvedSourceVersionIds: Array.isArray(f.unresolvedSourceVersionIds)
        ? (f.unresolvedSourceVersionIds as string[])
        : [],
      reasons: Array.isArray(f.reasons) ? (f.reasons as string[]) : [],
      selectionState: f.selectionState === 'unknown' ? 'unknown' : undefined,
      observation:
        f.observation === 'newer_known_version' ||
        f.observation === 'no_newer_known_version' ||
        f.observation === 'undetermined'
          ? f.observation
          : undefined,
    };
  }

  let packet_impact: ChangeImpactResponse['packet_impact'];
  if (hasPacketImpact) {
    const p = requireObject(root.packet_impact, 'ChangeImpact.packet_impact');
    const coverage = p.coverage;
    if (coverage !== 'complete' && coverage !== 'unknown') {
      throw new ToolFailure(
        'invalid_api_output',
        'ChangeImpact.packet_impact.coverage must be complete|unknown',
        {
          actionable:
            'Incomplete packet impact must fail closed (change_impact_incomplete), not ship unknown coverage as certified empty.',
        },
      );
    }
    if (!Array.isArray(p.affectedConsumerIds)) {
      throw new ToolFailure(
        'invalid_api_output',
        'ChangeImpact.packet_impact.affectedConsumerIds must be an array',
      );
    }
    if (!Array.isArray(p.unresolved)) {
      throw new ToolFailure(
        'invalid_api_output',
        'ChangeImpact.packet_impact.unresolved must be an array',
      );
    }
    if (coverage === 'unknown') {
      throw new ToolFailure(
        'invalid_api_output',
        'ChangeImpact.packet_impact.coverage unknown must not be accepted as success',
        {
          actionable:
            'HTTP should have refused with change_impact_incomplete; do not invent certified no-impact.',
        },
      );
    }
    const inWindow =
      p.inWindow === true || p.inWindow === false || p.inWindow === null ? p.inWindow : null;
    packet_impact = {
      affectedConsumerIds: p.affectedConsumerIds.filter(
        (id): id is string => typeof id === 'string',
      ),
      inWindow,
      unresolved: p.unresolved.filter((u): u is string => typeof u === 'string'),
      coverage,
    };
  }

  return {
    answer_revision_id:
      typeof root.answer_revision_id === 'string' ? root.answer_revision_id : undefined,
    freshness,
    packet_id: typeof root.packet_id === 'string' ? root.packet_id : undefined,
    packet_impact,
    engine: 'context_graph',
  };
}

export function validateCreatePacket(raw: unknown): CreateEvidencePacketResponse {
  const root = requireObject(raw, 'CreateEvidencePacket');
  return {
    packet_id: requireString(root, 'packet_id', 'CreateEvidencePacket'),
    content_hash: typeof root.content_hash === 'string' ? root.content_hash : undefined,
    input_packet_id: typeof root.input_packet_id === 'string' ? root.input_packet_id : undefined,
    operation_id: typeof root.operation_id === 'string' ? root.operation_id : undefined,
    gaps: Array.isArray(root.gaps) ? (root.gaps as string[]) : undefined,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateAssessSupport(raw: unknown): AssessSupportResponse {
  const root = requireObject(raw, 'AssessSupport');
  const judgment = requireObject(root.judgment, 'AssessSupport.judgment');
  return {
    assessmentId: requireString(root, 'assessmentId', 'AssessSupport'),
    target: requireObject(root.target, 'AssessSupport.target') as Record<string, unknown>,
    evidenceGroupRevisionId: requireString(
      root,
      'evidenceGroupRevisionId',
      'AssessSupport',
    ),
    alternativeFragmentId:
      root.alternativeFragmentId === null || typeof root.alternativeFragmentId === 'string'
        ? (root.alternativeFragmentId as string | null)
        : undefined,
    judgment: judgment as Record<string, unknown>,
    bindings: Array.isArray(root.bindings) ? root.bindings : undefined,
    explanation: typeof root.explanation === 'string' ? root.explanation : undefined,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateAssessMeaning(raw: unknown): AssessMeaningResponse {
  const root = requireObject(raw, 'AssessMeaning');
  return {
    meaning: requireString(root, 'meaning', 'AssessMeaning'),
    authority: requireString(root, 'authority', 'AssessMeaning'),
    falseClaimSupport: requireString(root, 'falseClaimSupport', 'AssessMeaning'),
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateFindContradictions(raw: unknown): FindContradictionsResponse {
  const root = requireObject(raw, 'FindContradictions');
  if (!Array.isArray(root.pairs)) {
    throw new ToolFailure('invalid_api_output', 'FindContradictions.pairs must be an array');
  }
  if (!Array.isArray(root.unresolved)) {
    throw new ToolFailure('invalid_api_output', 'FindContradictions.unresolved must be an array');
  }
  const coverage = root.coverage;
  if (coverage !== 'complete' && coverage !== 'unknown') {
    throw new ToolFailure(
      'invalid_api_output',
      'FindContradictions.coverage must be complete|unknown',
      {
        actionable:
          'Incomplete contradiction scans must fail closed (contradiction_scan_incomplete), not ship unknown coverage as certified all-clear.',
      },
    );
  }
  if (coverage === 'unknown') {
    throw new ToolFailure(
      'invalid_api_output',
      'FindContradictions.coverage unknown must not be accepted as success',
      {
        actionable:
          'HTTP should have refused with contradiction_scan_incomplete (unknown_interval_bounds / missing_decimal_value); do not invent certified no-contradiction.',
      },
    );
  }
  return {
    count: typeof root.count === 'number' ? root.count : root.pairs.length,
    pairs: root.pairs as FindContradictionsResponse['pairs'],
    coverage,
    unresolved: root.unresolved.filter((u): u is string => typeof u === 'string'),
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

const NUMBER_METHOD_SET = new Set<string>(NUMBER_OCCURRENCE_METHODS);
const NUMBER_INTERPRETATION_SET = new Set<string>(NUMBER_OCCURRENCE_INTERPRETATIONS);
const NUMBER_RECOGNITION_SET = new Set<string>(['read', 'uncertain', 'unreadable']);

function validateNumberInventoryOccurrence(
  raw: unknown,
  index: number,
): NumberInventoryOccurrence {
  const label = `NumberInventory.occurrences[${index}]`;
  const row = requireObject(raw, label);
  const id = requireString(row, 'id', label);
  const fragmentRaw = row.fragment_id ?? row.fragmentId;
  if (typeof fragmentRaw !== 'string' || !fragmentRaw.trim()) {
    throw new ToolFailure('invalid_api_output', `${label}.fragment_id is required`, {
      actionable: 'Reject the payload; do not invent occurrence identity.',
    });
  }
  const rawText = row.raw;
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw new ToolFailure('invalid_api_output', `${label}.raw must be a non-blank string`, {
      actionable:
        'Blank raw is incomplete (missing_occurrence_raw); do not invent a glyph or method=native.',
    });
  }
  const method = row.method;
  if (typeof method !== 'string' || !NUMBER_METHOD_SET.has(method)) {
    throw new ToolFailure(
      'invalid_api_output',
      `${label}.method must be native|ocr|asr|human|chart_estimate`,
      {
        actionable:
          'Never invent method=native for omitted/invalid method; incomplete inventories must fail closed.',
      },
    );
  }
  const interpretation = row.interpretation;
  if (typeof interpretation !== 'string' || !NUMBER_INTERPRETATION_SET.has(interpretation)) {
    throw new ToolFailure(
      'invalid_api_output',
      `${label}.interpretation must be measure|date|identifier|ordinal|range|formula|unknown`,
      {
        actionable: 'Reject invalid interpretation labels; do not repair them.',
      },
    );
  }
  const recognition =
    row.recognition_state ?? row.recognitionState;
  if (typeof recognition !== 'string' || !NUMBER_RECOGNITION_SET.has(recognition)) {
    throw new ToolFailure(
      'invalid_api_output',
      `${label}.recognition_state must be read|uncertain|unreadable`,
    );
  }
  const decimal =
    row.normalized_decimal !== undefined ? row.normalized_decimal : row.normalizedDecimal;
  if (decimal !== null && typeof decimal !== 'string') {
    throw new ToolFailure(
      'invalid_api_output',
      `${label}.normalized_decimal must be string|null`,
    );
  }
  return {
    id,
    raw: rawText,
    fragment_id: fragmentRaw,
    normalized_decimal: decimal === undefined ? null : (decimal as string | null),
    interpretation: interpretation as NumberOccurrenceInterpretation,
    method: method as NumberOccurrenceMethod,
    recognition_state: recognition as NumberRecognitionState,
  };
}

export function validateNumberInventory(raw: unknown): NumberInventoryResponse {
  const root = requireObject(raw, 'NumberInventory');
  const counts = requireObject(root.counts, 'NumberInventory.counts');
  if (!Array.isArray(root.occurrences)) {
    throw new ToolFailure('invalid_api_output', 'NumberInventory.occurrences must be an array');
  }
  if (!Array.isArray(root.unresolved)) {
    throw new ToolFailure('invalid_api_output', 'NumberInventory.unresolved must be an array');
  }
  const coverage = root.coverage;
  if (coverage !== 'complete' && coverage !== 'unknown') {
    throw new ToolFailure(
      'invalid_api_output',
      'NumberInventory.coverage must be complete|unknown',
    );
  }
  const read = counts.read;
  const uncertain = counts.uncertain;
  const unreadable = counts.unreadable;
  if (
    typeof read !== 'number' ||
    typeof uncertain !== 'number' ||
    typeof unreadable !== 'number'
  ) {
    throw new ToolFailure(
      'invalid_api_output',
      'NumberInventory.counts requires read/uncertain/unreadable numbers',
    );
  }
  const occurrences = root.occurrences.map((row, index) =>
    validateNumberInventoryOccurrence(row, index),
  );
  return {
    counts: { read, uncertain, unreadable },
    occurrences,
    coverage,
    unresolved: root.unresolved.filter((u): u is string => typeof u === 'string'),
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateFormalEligibility(raw: unknown): FormalEligibilityResponse {
  const root = requireObject(raw, 'FormalEligibility');
  return {
    eligible: root.eligible === true,
    scaling_ok: root.scaling_ok === true,
    scaling_error: typeof root.scaling_error === 'string' ? root.scaling_error : null,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateFormalCheck(raw: unknown): FormalCheckResponse {
  const root = requireObject(raw, 'FormalCheck');
  return {
    status: requireString(root, 'status', 'FormalCheck'),
    toolchainVersion: requireString(root, 'toolchainVersion', 'FormalCheck'),
    checkerDigest: requireString(root, 'checkerDigest', 'FormalCheck'),
    checkerPolicyRevision: requireString(root, 'checkerPolicyRevision', 'FormalCheck'),
    reason: typeof root.reason === 'string' ? root.reason : undefined,
    mode: typeof root.mode === 'string' ? root.mode : undefined,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateCreateClaimRelation(raw: unknown): CreateClaimRelationResponse {
  const root = requireObject(raw, 'CreateClaimRelation');
  const relation = requireObject(root.relation, 'CreateClaimRelation.relation');
  return {
    relation: {
      id: requireString(relation, 'id', 'relation'),
      predicate: requireString(relation, 'predicate', 'relation'),
      argumentIds: Array.isArray(relation.argumentIds)
        ? (relation.argumentIds as string[])
        : [],
      argumentsResolved: relation.argumentsResolved === true,
      claimRevisionId:
        typeof relation.claimRevisionId === 'string' ? relation.claimRevisionId : null,
      contentHash: requireString(relation, 'contentHash', 'relation'),
    },
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateListClaimRelations(raw: unknown): ListClaimRelationsResponse {
  const root = requireObject(raw, 'ListClaimRelations');
  if (!Array.isArray(root.relations)) {
    throw new ToolFailure('invalid_api_output', 'ListClaimRelations.relations must be an array');
  }
  return {
    relations: root.relations as ListClaimRelationsResponse['relations'],
    recognised: Array.isArray(root.recognised) ? (root.recognised as string[]) : [],
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateCreateMetricDefinition(
  raw: unknown,
): CreateMetricDefinitionResponse {
  const root = requireObject(raw, 'CreateMetricDefinition');
  return {
    revisionId: requireString(root, 'revisionId', 'CreateMetricDefinition'),
    contentHash: requireString(root, 'contentHash', 'CreateMetricDefinition'),
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateListMetricDefinitions(
  raw: unknown,
): ListMetricDefinitionsResponse {
  const root = requireObject(raw, 'ListMetricDefinitions');
  if (!Array.isArray(root.definitions)) {
    throw new ToolFailure(
      'invalid_api_output',
      'ListMetricDefinitions.definitions must be an array',
    );
  }
  return {
    definitions: root.definitions as Record<string, unknown>[],
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

function requireResearchRun(raw: unknown, label: string): CreateResearchRunResponse['run'] {
  const run = requireObject(raw, label);
  return {
    ...run,
    id: requireString(run, 'id', label),
    checkpointRevision:
      typeof run.checkpointRevision === 'number' ? run.checkpointRevision : 0,
    objective: typeof run.objective === 'string' ? run.objective : '',
    phase: typeof run.phase === 'string' ? run.phase : 'running',
  };
}

export function validateCreateResearchRun(raw: unknown): CreateResearchRunResponse {
  const root = requireObject(raw, 'CreateResearchRun');
  return {
    run: requireResearchRun(root.run, 'CreateResearchRun.run'),
    opened_root: typeof root.opened_root === 'boolean' ? root.opened_root : undefined,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateGetResearchRun(raw: unknown): GetResearchRunResponse {
  const root = requireObject(raw, 'GetResearchRun');
  return {
    run: requireResearchRun(root.run, 'GetResearchRun.run'),
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateCheckpointResearchRun(
  raw: unknown,
): CheckpointResearchRunResponse {
  const root = requireObject(raw, 'CheckpointResearchRun');
  return {
    run: requireResearchRun(root.run, 'CheckpointResearchRun.run'),
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateResolveSeeds(raw: unknown): ResolveSeedsResponse {
  const root = requireObject(raw, 'ResolveSeeds');
  if (!Array.isArray(root.candidates)) {
    throw new ToolFailure('invalid_api_output', 'ResolveSeeds.candidates must be an array');
  }
  return {
    candidates: root.candidates as ResolveSeedsResponse['candidates'],
    leading_resolver:
      typeof root.leading_resolver === 'string' || root.leading_resolver === null
        ? (root.leading_resolver as string | null)
        : null,
    index_source: typeof root.index_source === 'string' ? root.index_source : undefined,
    index_size: typeof root.index_size === 'number' ? root.index_size : undefined,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateExpandSeeds(raw: unknown): ExpandSeedsResponse {
  const root = requireObject(raw, 'ExpandSeeds');
  if (!Array.isArray(root.seeds)) {
    throw new ToolFailure('invalid_api_output', 'ExpandSeeds.seeds must be an array');
  }
  if (typeof root.hops !== 'number' || !Number.isFinite(root.hops)) {
    throw new ToolFailure('invalid_api_output', 'ExpandSeeds.hops must be a number');
  }
  return {
    seeds: root.seeds as string[],
    hops: root.hops,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateLearningJudge(raw: unknown): LearningJudgeResponse {
  const root = requireObject(raw, 'LearningJudge');
  const action = requireString(root, 'action', 'LearningJudge');
  if (
    action !== 'accept' &&
    action !== 'reject' &&
    action !== 'more_evidence' &&
    action !== 'escalate'
  ) {
    throw new ToolFailure('invalid_api_output', `LearningJudge.action invalid: ${action}`);
  }
  return {
    action,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateLearningApply(raw: unknown): LearningApplyResponse {
  const root = requireObject(raw, 'LearningApply');
  const status = requireString(root, 'status', 'LearningApply');
  if (status !== 'applied' && status !== 'refused') {
    throw new ToolFailure('invalid_api_output', `LearningApply.status invalid: ${status}`);
  }
  return {
    status,
    proposalId: typeof root.proposalId === 'string' ? root.proposalId : undefined,
    gateId: typeof root.gateId === 'string' ? root.gateId : undefined,
    reason: typeof root.reason === 'string' ? root.reason : undefined,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateLearningPlaceholder(
  raw: unknown,
): LearningPlaceholderResponse {
  const root = requireObject(raw, 'LearningPlaceholder');
  return {
    checkpoint: requireObject(root.checkpoint, 'LearningPlaceholder.checkpoint'),
    authoritative: root.authoritative === true,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateFormatCertify(raw: unknown): FormatCertifyResponse {
  const root = requireObject(raw, 'FormatCertify');
  return {
    ok: root.ok === true,
    kind: requireString(root, 'kind', 'FormatCertify'),
    reason: typeof root.reason === 'string' ? root.reason : undefined,
    missingCount: typeof root.missingCount === 'number' ? root.missingCount : undefined,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateReserveResearchBudget(
  raw: unknown,
): ReserveResearchBudgetResponse {
  const root = requireObject(raw, 'ReserveResearchBudget');
  return {
    operationId: requireString(root, 'operationId', 'ReserveResearchBudget'),
    replay: root.replay === true,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateOpenOperationRoot(
  raw: unknown,
): OpenOperationRootResponse {
  const root = requireObject(raw, 'OpenOperationRoot');
  const operation = requireObject(root.operation, 'OpenOperationRoot.operation');
  return {
    operation,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateReserveOperation(
  raw: unknown,
): ReserveOperationResponse {
  const root = requireObject(raw, 'ReserveOperation');
  const operation = requireObject(root.operation, 'ReserveOperation.operation');
  return {
    operation: { id: requireString(operation, 'id', 'ReserveOperation.operation') },
    replay: root.replay === true,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateGetOperation(raw: unknown): GetOperationResponse {
  const root = requireObject(raw, 'GetOperation');
  const operation = requireObject(root.operation, 'GetOperation.operation');
  return {
    operation,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateGetOperationAvailability(
  raw: unknown,
): GetOperationAvailabilityResponse {
  const root = requireObject(raw, 'GetOperationAvailability');
  const availability = requireObject(
    root.availability,
    'GetOperationAvailability.availability',
  );
  const num = (key: string) => {
    const value = availability[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ToolFailure(
        'invalid_api_output',
        `GetOperationAvailability.availability.${key} must be a number`,
      );
    }
    return value;
  };
  return {
    availability: {
      maxCredits: num('maxCredits'),
      maxTokens: num('maxTokens'),
      settledCredits: num('settledCredits'),
      outstandingCredits: num('outstandingCredits'),
      outstandingTokens: num('outstandingTokens'),
    },
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateSettleOperation(raw: unknown): SettleOperationResponse {
  const root = requireObject(raw, 'SettleOperation');
  const operation = requireObject(root.operation, 'SettleOperation.operation');
  return {
    operation,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateReleaseOperation(raw: unknown): ReleaseOperationResponse {
  const root = requireObject(raw, 'ReleaseOperation');
  const operation = requireObject(root.operation, 'ReleaseOperation.operation');
  return {
    operation,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateRecordOperationAttempt(
  raw: unknown,
): RecordOperationAttemptResponse {
  const root = requireObject(raw, 'RecordOperationAttempt');
  const attempt = requireObject(root.attempt, 'RecordOperationAttempt.attempt');
  return {
    attempt,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateResolveOperationAttempt(
  raw: unknown,
): ResolveOperationAttemptResponse {
  const root = requireObject(raw, 'ResolveOperationAttempt');
  const attempt = requireObject(root.attempt, 'ResolveOperationAttempt.attempt');
  return {
    attempt,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateLinkOperationConsumer(
  raw: unknown,
): LinkOperationConsumerResponse {
  const root = requireObject(raw, 'LinkOperationConsumer');
  const consumer = requireObject(root.consumer, 'LinkOperationConsumer.consumer');
  return {
    consumer,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateGetConsumerUsage(raw: unknown): GetConsumerUsageResponse {
  const root = requireObject(raw, 'GetConsumerUsage');
  const usage = requireObject(root.usage, 'GetConsumerUsage.usage');
  if (!Array.isArray(usage.operationIds)) {
    throw new ToolFailure(
      'invalid_api_output',
      'GetConsumerUsage.usage.operationIds must be an array',
    );
  }
  return {
    usage: {
      operationIds: usage.operationIds as string[],
      knownCredits:
        typeof usage.knownCredits === 'number' || usage.knownCredits === null
          ? (usage.knownCredits as number | null)
          : null,
      completeness:
        typeof usage.completeness === 'string' ? usage.completeness : 'unknown',
    },
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateGetProviderCost(raw: unknown): GetProviderCostResponse {
  const root = requireObject(raw, 'GetProviderCost');
  const cost = requireObject(root.cost, 'GetProviderCost.cost');
  if (!Array.isArray(cost.attemptIds)) {
    throw new ToolFailure(
      'invalid_api_output',
      'GetProviderCost.cost.attemptIds must be an array',
    );
  }
  if (!Array.isArray(cost.unknownAttemptIds)) {
    throw new ToolFailure(
      'invalid_api_output',
      'GetProviderCost.cost.unknownAttemptIds must be an array',
    );
  }
  return {
    cost: {
      attemptIds: cost.attemptIds as string[],
      knownCost:
        typeof cost.knownCost === 'string' || cost.knownCost === null
          ? (cost.knownCost as string | null)
          : null,
      currency:
        typeof cost.currency === 'string' || cost.currency === null
          ? (cost.currency as string | null)
          : null,
      completeness:
        typeof cost.completeness === 'string' ? cost.completeness : 'unknown',
      unknownAttemptIds: cost.unknownAttemptIds as string[],
    },
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateProofsApplies(raw: unknown): ProofsAppliesResponse {
  const root = requireObject(raw, 'ProofsApplies');
  if (typeof root.applies !== 'boolean') {
    throw new ToolFailure('invalid_api_output', 'ProofsApplies.applies must be a boolean');
  }
  return {
    applies: root.applies,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateFormalResolutionState(
  raw: unknown,
): FormalResolutionStateResponse {
  const root = requireObject(raw, 'FormalResolutionState');
  return {
    state: requireString(root, 'state', 'FormalResolutionState'),
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateFormalRevenueBridge(
  raw: unknown,
): FormalRevenueBridgeResponse {
  const root = requireObject(raw, 'FormalRevenueBridge');
  const status = requireString(root, 'status', 'FormalRevenueBridge');
  if (status !== 'discharged' && status !== 'refused') {
    throw new ToolFailure(
      'invalid_api_output',
      `FormalRevenueBridge.status invalid: ${status}`,
    );
  }
  return {
    status,
    sum: typeof root.sum === 'string' ? root.sum : undefined,
    reason: typeof root.reason === 'string' ? root.reason : undefined,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateClaimStructureTier(
  raw: unknown,
): ClaimStructureTierResponse {
  const root = requireObject(raw, 'ClaimStructureTier');
  const tier = root.tier;
  if (tier !== 1 && tier !== 2 && tier !== 3) {
    throw new ToolFailure(
      'invalid_api_output',
      `ClaimStructureTier.tier invalid: ${String(tier)}`,
    );
  }
  return {
    tier,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateClaimStructureResolveDefinition(
  raw: unknown,
): ClaimStructureResolveDefinitionResponse {
  const root = requireObject(raw, 'ClaimStructureResolveDefinition');
  const kind = requireString(root, 'kind', 'ClaimStructureResolveDefinition');
  if (kind !== 'definition' && kind !== 'ambiguity') {
    throw new ToolFailure(
      'invalid_api_output',
      `ClaimStructureResolveDefinition.kind invalid: ${kind}`,
    );
  }
  return {
    kind,
    result: root.result,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateFormalizeClaimRelation(
  raw: unknown,
): FormalizeClaimRelationResponse {
  const root = requireObject(raw, 'FormalizeClaimRelation');
  let relation: FormalizeClaimRelationResponse['relation'] = null;
  if (root.relation !== null && root.relation !== undefined) {
    const rel = requireObject(root.relation, 'FormalizeClaimRelation.relation');
    relation = {
      predicate: requireString(rel, 'predicate', 'relation'),
      argumentIds: Array.isArray(rel.argumentIds)
        ? (rel.argumentIds as string[])
        : [],
      argumentsResolved: rel.argumentsResolved === true,
    };
  }
  return {
    relation,
    formalized: root.formalized === true,
    recognised: Array.isArray(root.recognised) ? (root.recognised as string[]) : [],
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateEvalCatalog(raw: unknown): EvalCatalogResponse {
  const root = requireObject(raw, 'EvalCatalog');
  if (!Array.isArray(root.suites)) {
    throw new ToolFailure('invalid_api_output', 'EvalCatalog.suites must be an array', {
      actionable: 'Do not expose private gold when the catalog is malformed.',
    });
  }
  return {
    suites: root.suites.map((suite, i) => {
      const s = requireObject(suite, `EvalCatalog.suites[${i}]`);
      return {
        id: requireString(s, 'id', `suites[${i}]`),
        caseCount: typeof s.caseCount === 'number' ? s.caseCount : 0,
        surfaceIds: Array.isArray(s.surfaceIds) ? (s.surfaceIds as string[]) : [],
      };
    }),
    private_gold_denied: root.private_gold_denied !== false,
  };
}

export function validateCertifyPrivateUpload(
  raw: unknown,
): CertifyPrivateUploadResponse {
  const root = requireObject(raw, 'CertifyPrivateUpload');
  if (typeof root.ok !== 'boolean') {
    throw new ToolFailure(
      'invalid_api_output',
      'CertifyPrivateUpload.ok must be a boolean',
      {
        actionable:
          'Do not invent private-upload readiness; retry or report API contract drift.',
      },
    );
  }
  return {
    ok: root.ok,
    mode: typeof root.mode === 'string' ? root.mode : undefined,
    reason: typeof root.reason === 'string' ? root.reason : undefined,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}

export function validateCertifyRetrieveFlag(
  raw: unknown,
): CertifyRetrieveFlagResponse {
  const root = requireObject(raw, 'CertifyRetrieveFlag');
  if (typeof root.ok !== 'boolean' || typeof root.enabled !== 'boolean') {
    throw new ToolFailure(
      'invalid_api_output',
      'CertifyRetrieveFlag.ok and enabled must be booleans',
      {
        actionable:
          'Do not invent retrieve-flag posture; retry or report API contract drift.',
      },
    );
  }
  return {
    ok: root.ok,
    enabled: root.enabled,
    default_off: root.default_off !== false,
    engine: typeof root.engine === 'string' ? root.engine : undefined,
  };
}
