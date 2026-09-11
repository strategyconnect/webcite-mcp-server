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
