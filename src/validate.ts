/**
 * Validate API responses before exposing structuredContent.
 * Render text from the same validated object — never regenerate evidence.
 */

import { ToolFailure } from './errors.js';
import type {
  ChangeImpactResponse,
  CompareAssertionsResponse,
  ContextQueryResponse,
  CreateEvidencePacketResponse,
  AssessSupportResponse,
  AssessMeaningResponse,
  FindContradictionsResponse,
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

export function validateChangeImpact(raw: unknown): ChangeImpactResponse {
  const root = requireObject(raw, 'ChangeImpact');
  const freshness = requireObject(root.freshness, 'ChangeImpact.freshness');
  const coverage = freshness.coverage;
  if (coverage !== 'complete' && coverage !== 'unknown') {
    throw new ToolFailure('invalid_api_output', 'ChangeImpact.freshness.coverage must be complete|unknown', {
      actionable: 'Do not report silent "no changes" when coverage is missing.',
    });
  }
  return {
    answer_revision_id: requireString(root, 'answer_revision_id', 'ChangeImpact'),
    freshness: {
      claimRevisionIds: Array.isArray(freshness.claimRevisionIds)
        ? (freshness.claimRevisionIds as string[])
        : [],
      coverage,
      unresolvedSourceVersionIds: Array.isArray(freshness.unresolvedSourceVersionIds)
        ? (freshness.unresolvedSourceVersionIds as string[])
        : [],
      reasons: Array.isArray(freshness.reasons) ? (freshness.reasons as string[]) : [],
      selectionState: freshness.selectionState === 'unknown' ? 'unknown' : undefined,
      observation:
        freshness.observation === 'newer_known_version' ||
        freshness.observation === 'no_newer_known_version' ||
        freshness.observation === 'undetermined'
          ? freshness.observation
          : undefined,
    },
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
  return {
    count: typeof root.count === 'number' ? root.count : root.pairs.length,
    pairs: root.pairs as FindContradictionsResponse['pairs'],
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
