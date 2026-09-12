/**
 * Tool handlers — one per entry in ALL_TOOLS.
 * Context tools validate API responses before structuredContent and render text
 * from that same validated object (never regenerate evidence via a model).
 */

import { ApiClientError, ToolFailure, type WebCiteApiClient } from './api-client.js';
import {
  formatAccuracyReport,
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

export type ToolSuccess = {
  text: string;
  structuredContent?: Record<string, unknown>;
};

export type ToolHandler = (args: Args, client: WebCiteApiClient) => Promise<ToolSuccess>;

function ok(text: string, structuredContent?: Record<string, unknown>): ToolSuccess {
  return structuredContent ? { text, structuredContent } : { text };
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

function assetRef(args: Args): AssetRefOptions {
  const assetId = args?.asset_id as string | undefined;
  const assetUrl = args?.asset_url as string | undefined;
  if (!assetId && !assetUrl) {
    throw new ToolFailure(
      'invalid_argument',
      'provide either asset_id (uploaded file) or asset_url (direct file URL)',
      { actionable: 'Pass asset_id from upload_file, or a direct asset_url.' },
    );
  }
  return { asset_id: assetId, asset_url: assetUrl };
}

function verifyOptions(args: Args): VerifyClaimOptions {
  return {
    claim: requireString(args, 'claim'),
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
  verify_claim: async (args, client) => {
    const options = verifyOptions(args);
    const result = await wrapApi(client.verifyClaim(options));
    return ok(formatVerifyResult(options.claim, result));
  },

  verify_claim_stream: async (args, client) => {
    const options = verifyOptions(args);
    try {
      const { result, events } = await collectStreamEvents(client.verifyClaimStream(options));
      if (result) return ok(formatVerifyResult(options.claim, result));
      const eventSummary = events
        .map((e) => `[${e.event}] ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}`)
        .join('\n');
      return ok(
        `# Streaming Verification: "${options.claim}"\n\nReceived ${events.length} events but could not assemble a structured result.\n\n## Raw Events:\n${eventSummary}`,
      );
    } catch (error) {
      if (error instanceof ApiClientError) throw error.toToolFailure();
      throw error;
    }
  },

  search_sources: async (args, client) => {
    const query = requireString(args, 'query');
    const limit = clamp(args?.limit, 10, 1, 20);
    const result = await wrapApi(client.searchSources({ query, limit }));

    const parts: string[] = [];
    parts.push(`# Search Results: "${query}"\n`);

    const citations = result.claim_groups?.[0]?.citations || result.citations || [];
    if (citations.length > 0) {
      parts.push(`Found ${citations.length} sources:\n`);
      citations.slice(0, limit).forEach((citation, i) => {
        parts.push(formatCitation(citation, i));
        parts.push('');
      });
    } else {
      parts.push('No sources found for this query.');
    }

    return ok(parts.join('\n'));
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

    return ok(parts.join('\n'));
  },

  get_citation: async (args, client) => {
    const citationId = requireString(args, 'citation_id');
    const result = await wrapApi(client.getCitation(citationId));

    const parts: string[] = [];
    parts.push(`# Verification Details\n`);
    parts.push(`**Prompt:** ${result.data.prompt}\n`);

    let citations: Citation[] = [];
    if (typeof result.data.citation === 'string') {
      try {
        citations = JSON.parse(result.data.citation);
      } catch {
        citations = [];
      }
    } else if (Array.isArray(result.data.citation)) {
      citations = result.data.citation;
    }

    if (citations.length > 0) {
      parts.push('## Sources\n');
      citations.forEach((citation, i) => {
        parts.push(formatCitation(citation, i));
        parts.push('');
      });
    }

    return ok(parts.join('\n'));
  },

  upload_file: async (args, client) => {
    const filePath = requireString(args, 'file_path');
    const result = await wrapApi(client.uploadFile(filePath));

    const parts: string[] = [];
    parts.push(`# File Uploaded Successfully\n`);
    parts.push(`**File ID:** ${result.file_id}`);
    parts.push(`**Filename:** ${result.filename}`);
    parts.push(`**Type:** ${result.mime_type}`);
    parts.push(`**Size:** ${result.size} bytes`);

    return ok(parts.join('\n'));
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

    return ok(formatSourcePreview(result));
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

    const results = await wrapApi(client.verifyBatch(items));
    return ok(formatBatchResults(results));
  },

  verify_feedback: async (args, client) => {
    const token = requireString(args, 'token');
    const verdict = requireString(args, 'verdict') as FeedbackVerdict;
    if (!['correct', 'incorrect', 'unsure'].includes(verdict)) {
      throw new ToolFailure('invalid_argument', 'verdict must be one of: correct, incorrect, unsure', {
        actionable: 'Use correct, incorrect, or unsure.',
      });
    }

    await wrapApi(client.verifyFeedback(token, verdict, args?.note as string | undefined));
    return ok(
      `# Feedback Recorded\n\n**Verdict:** ${verdict}${args?.note ? `\n**Note:** ${args.note}` : ''}`,
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
    return ok(`# Numeric Analysis: ${figures.length} figure(s)\n\n${formatAnalyzeResult(result)}`);
  },

  analyze_document: async (args, client) => {
    const assetId = requireString(args, 'asset_id');
    const result = await wrapApi(client.analyzeDocument(assetId));
    return ok(formatDocumentAnalysis(result));
  },

  classify_document: async (args, client) => {
    const result = await wrapApi(
      client.classifyDocument({
        ...assetRef(args),
        taxonomy: args?.taxonomy as Taxonomy | undefined,
      }),
    );
    return ok(formatClassify(result));
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
    return ok(formatGaps(category, result));
  },

  extract_document: async (args, client) => {
    const result = await wrapApi(client.extractDocument(assetRef(args)));
    return ok(formatExtractedDoc(result));
  },

  extract_figures: async (args, client) => {
    const result = await wrapApi(client.extractFigures(assetRef(args)));
    return ok(formatFigures(result.figures ?? []));
  },

  accuracy_report: async (_args, client) => {
    const result = await wrapApi(client.accuracyReport());
    return ok(formatAccuracyReport(result));
  },

  get_answer: async (args, client) => {
    const revisionId = requireString(args, 'revision_id');
    const raw = await wrapApi(client.getAnswer(revisionId));
    const validated = validateResolvedAnswer(raw);
    return ok(formatResolvedAnswer(validated), validated as unknown as Record<string, unknown>);
  },

  get_evidence_packet: async (args, client) => {
    const packetId = requireString(args, 'packet_id');
    const raw = await wrapApi(client.getEvidencePacket(packetId));
    const validated = validateResolvedPacket(raw);
    return ok(formatResolvedPacket(validated), validated as unknown as Record<string, unknown>);
  },

  query_context: async (args, client) => {
    const text = requireString(args, 'text');
    const maxHops = args?.max_hops;
    if (maxHops !== undefined && maxHops !== 0 && maxHops !== 1 && maxHops !== 2) {
      throw new ToolFailure('invalid_argument', 'max_hops must be 0, 1, or 2', {
        actionable: 'Use 0, 1, or 2 for authorized expansion hops.',
      });
    }
    const raw = await wrapApi(
      client.queryContext({
        text,
        source_texts: Array.isArray(args?.source_texts)
          ? (args?.source_texts as string[])
          : undefined,
        source_version_ids: Array.isArray(args?.source_version_ids)
          ? (args?.source_version_ids as string[])
          : undefined,
        filters:
          args?.filters && typeof args.filters === 'object' && !Array.isArray(args.filters)
            ? (args.filters as Partial<ClaimScope>)
            : undefined,
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
    if (args.fragments !== undefined && !Array.isArray(args.fragments)) {
      throw new ToolFailure('invalid_argument', 'fragments must be an array when provided');
    }
    const packetId =
      typeof args?.packet_id === 'string' ? args.packet_id.trim() : '';
    const answerRevisionId =
      typeof args?.answer_revision_id === 'string' ? args.answer_revision_id.trim() : '';
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
    const answerRevisionId =
      typeof args?.answer_revision_id === 'string' && args.answer_revision_id.trim()
        ? args.answer_revision_id.trim()
        : undefined;
    const changedIds = Array.isArray(args?.changed_ids)
      ? (args.changed_ids as unknown[]).filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        )
      : undefined;
    if (!answerRevisionId && (!changedIds || changedIds.length === 0)) {
      throw new ToolFailure(
        'invalid_argument',
        'answer_revision_id or changed_ids is required',
        {
          actionable:
            'Pass answer_revision_id for freshness, or non-empty changed_ids for packet impact.',
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
        const sourceId = typeof row.source_id === 'string' ? row.source_id.trim() : '';
        const consumerId = typeof row.consumer_id === 'string' ? row.consumer_id.trim() : '';
        if (!sourceId || !consumerId) {
          throw new ToolFailure(
            'invalid_argument',
            `links[${i}] requires non-empty source_id and consumer_id`,
            {
              actionable:
                'Blank link endpoints fail closed on HTTP as change_impact_incomplete; supply complete endpoints.',
            },
          );
        }
        links.push({ source_id: sourceId, consumer_id: consumerId });
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

    const raw = await wrapApi(
      client.getChangeImpact({
        ...(answerRevisionId ? { answer_revision_id: answerRevisionId } : {}),
        ...(typeof args?.packet_id === 'string' && args.packet_id.trim()
          ? { packet_id: args.packet_id.trim() }
          : {}),
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
    const claimText = requireString(args, 'claim_text');
    const bindings = args?.bindings;
    if (!Array.isArray(bindings) || bindings.length === 0) {
      throw new ToolFailure('invalid_argument', 'bindings must be a non-empty array', {
        actionable:
          'Provide at least one source_version_id / source_unit_id / representation_id binding.',
      });
    }
    for (const [i, binding] of bindings.entries()) {
      if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
        throw new ToolFailure('invalid_argument', `bindings[${i}] must be an object`);
      }
      const row = binding as Record<string, unknown>;
      for (const key of ['source_version_id', 'source_unit_id', 'representation_id'] as const) {
        if (typeof row[key] !== 'string' || !(row[key] as string).trim()) {
          throw new ToolFailure('invalid_argument', `bindings[${i}].${key} is required`);
        }
      }
    }
    const raw = await wrapApi(
      client.createEvidencePacket({
        claim_text: claimText,
        operator_class:
          typeof args?.operator_class === 'string' ? args.operator_class : undefined,
        bindings: bindings as Array<{
          source_version_id: string;
          source_unit_id: string;
          representation_id: string;
          snippet?: string;
          seed?: string;
        }>,
        idempotency_key:
          typeof args?.idempotency_key === 'string' ? args.idempotency_key : undefined,
      }),
    );
    const validated = validateCreatePacket(raw);
    return ok(formatCreatePacket(validated), validated as unknown as Record<string, unknown>);
  },

  assess_support: async (args, client) => {
    const claimRevisionId = requireString(args, 'claim_revision_id');
    const claimHash = requireString(args, 'claim_hash');
    const evidenceGroupRevisionId = requireString(args, 'evidence_group_revision_id');
    const tierRaw = args?.tier;
    const tier =
      tierRaw === 1 || tierRaw === 2 || tierRaw === 3
        ? (tierRaw as 1 | 2 | 3)
        : undefined;
    const raw = await wrapApi(
      client.assessSupport({
        claim_revision_id: claimRevisionId,
        claim_hash: claimHash,
        evidence_group_revision_id: evidenceGroupRevisionId,
        alternative_fragment_id:
          typeof args?.alternative_fragment_id === 'string'
            ? args.alternative_fragment_id
            : args?.alternative_fragment_id === null
              ? null
              : undefined,
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
          'Provide occurrences[] with recognition_state, non-blank raw, and an explicit method (never invent method=native).',
      });
    }
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
    // Pass claims through unchanged — do not invent bounds or decimal_value.
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
    if (typeof args?.predicate !== 'string' || !Array.isArray(args?.argument_ids)) {
      throw new ToolFailure('invalid_argument', 'predicate and argument_ids are required');
    }
    if (typeof args?.arguments_resolved !== 'boolean') {
      throw new ToolFailure('invalid_argument', 'arguments_resolved is required');
    }
    const raw = await wrapApi(
      client.createClaimRelation({
        predicate: args.predicate,
        argument_ids: args.argument_ids as string[],
        arguments_resolved: args.arguments_resolved,
        claim_revision_id:
          typeof args?.claim_revision_id === 'string' || args?.claim_revision_id === null
            ? (args.claim_revision_id as string | null)
            : undefined,
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
    const raw = await wrapApi(
      client.listClaimRelations({
        predicate: typeof args?.predicate === 'string' ? args.predicate : undefined,
        claim_revision_id:
          typeof args?.claim_revision_id === 'string' ? args.claim_revision_id : undefined,
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
    if (typeof args?.predicate !== 'string' || !Array.isArray(args?.argument_ids)) {
      throw new ToolFailure('invalid_argument', 'predicate and argument_ids are required');
    }
    if (typeof args?.arguments_resolved !== 'boolean') {
      throw new ToolFailure('invalid_argument', 'arguments_resolved is required');
    }
    const raw = await wrapApi(
      client.formalizeClaimRelation({
        predicate: args.predicate,
        argument_ids: args.argument_ids as string[],
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
    if (typeof args?.run_id !== 'string' || !args.run_id.trim()) {
      throw new ToolFailure('invalid_argument', 'run_id is required');
    }
    const raw = await wrapApi(client.getResearchRun({ run_id: args.run_id }));
    const validated = validateGetResearchRun(raw);
    return ok(formatGetResearchRun(validated), validated as unknown as Record<string, unknown>);
  },

  list_research_runs: async (_args, client) => {
    const raw = await wrapApi(client.listResearchRuns());
    const validated = validateListResearchRuns(raw);
    return ok(
      formatListResearchRuns(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  checkpoint_research_run: async (args, client) => {
    if (
      typeof args?.run_id !== 'string' ||
      typeof args?.expected_revision !== 'number' ||
      !args?.run ||
      typeof args.run !== 'object'
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'run_id, expected_revision, and run are required',
      );
    }
    const raw = await wrapApi(
      client.checkpointResearchRun({
        run_id: args.run_id,
        expected_revision: args.expected_revision,
        run: args.run as ResearchRunPayload,
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
    if (typeof args?.text !== 'string') {
      throw new ToolFailure('invalid_argument', 'text is required');
    }
    if (args?.index !== undefined && !Array.isArray(args.index)) {
      throw new ToolFailure('invalid_argument', 'index must be an array when provided');
    }
    const raw = await wrapApi(
      client.resolveSeeds({
        text: args.text,
        filters:
          args.filters && typeof args.filters === 'object' && !Array.isArray(args.filters)
            ? (args.filters as Record<string, string | null | undefined>)
            : undefined,
        index: Array.isArray(args.index)
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
    if (
      args?.hops !== undefined &&
      (typeof args.hops !== 'number' || !Number.isFinite(args.hops))
    ) {
      throw new ToolFailure('invalid_argument', 'hops must be a finite number when provided');
    }
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
    if (
      typeof args?.run_id !== 'string' ||
      typeof args?.idempotency_key !== 'string' ||
      typeof args?.kind !== 'string' ||
      typeof args?.credits !== 'number'
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'run_id, idempotency_key, kind, and credits are required',
      );
    }
    const raw = await wrapApi(
      client.reserveResearchBudget({
        run_id: args.run_id,
        idempotency_key: args.idempotency_key,
        kind: args.kind,
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
    if (
      typeof args?.idempotency_key !== 'string' ||
      typeof args?.kind !== 'string' ||
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
        idempotency_key: args.idempotency_key,
        kind: args.kind,
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
    if (
      typeof args?.idempotency_key !== 'string' ||
      typeof args?.kind !== 'string' ||
      typeof args?.credits !== 'number'
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'idempotency_key, kind, and credits are required',
      );
    }
    const raw = await wrapApi(
      client.reserveOperation({
        idempotency_key: args.idempotency_key,
        kind: args.kind,
        credits: args.credits,
        tokens: typeof args?.tokens === 'number' ? args.tokens : undefined,
        root_operation_id:
          typeof args?.root_operation_id === 'string'
            ? args.root_operation_id
            : null,
      }),
    );
    const validated = validateReserveOperation(raw);
    return ok(
      formatReserveOperation(validated),
      validated as unknown as Record<string, unknown>,
    );
  },

  get_operation: async (args, client) => {
    if (typeof args?.operation_id !== 'string' || !args.operation_id.trim()) {
      throw new ToolFailure('invalid_argument', 'operation_id is required');
    }
    const raw = await wrapApi(client.getOperation({ operation_id: args.operation_id }));
    const validated = validateGetOperation(raw);
    return ok(formatGetOperation(validated), validated as unknown as Record<string, unknown>);
  },

  get_operation_availability: async (args, client) => {
    if (typeof args?.operation_id !== 'string' || !args.operation_id.trim()) {
      throw new ToolFailure('invalid_argument', 'operation_id is required');
    }
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
    if (typeof args?.operation_id !== 'string' || !args.operation_id.trim()) {
      throw new ToolFailure('invalid_argument', 'operation_id is required');
    }
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
    if (typeof args?.operation_id !== 'string' || !args.operation_id.trim()) {
      throw new ToolFailure('invalid_argument', 'operation_id is required');
    }
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
    if (
      typeof args?.operation_id !== 'string' ||
      !args.operation_id.trim() ||
      typeof args?.provider !== 'string'
    ) {
      throw new ToolFailure('invalid_argument', 'operation_id and provider are required');
    }
    const raw = await wrapApi(
      client.recordOperationAttempt({
        operation_id: args.operation_id,
        provider: args.provider,
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
    if (typeof args?.attempt_id !== 'string' || !args.attempt_id.trim()) {
      throw new ToolFailure('invalid_argument', 'attempt_id is required');
    }
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
    if (
      typeof args?.operation_id !== 'string' ||
      typeof args?.consumer_kind !== 'string' ||
      typeof args?.consumer_id !== 'string'
    ) {
      throw new ToolFailure(
        'invalid_argument',
        'operation_id, consumer_kind, and consumer_id are required',
      );
    }
    const raw = await wrapApi(
      client.linkOperationConsumer({
        operation_id: args.operation_id,
        consumer_kind: args.consumer_kind,
        consumer_id: args.consumer_id,
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
    if (typeof args?.consumer_kind !== 'string' || typeof args?.consumer_id !== 'string') {
      throw new ToolFailure(
        'invalid_argument',
        'consumer_kind and consumer_id are required',
      );
    }
    const raw = await wrapApi(
      client.getConsumerUsage({
        consumer_kind: args.consumer_kind,
        consumer_id: args.consumer_id,
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
    if (args.operation_ids.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new ToolFailure(
        'invalid_argument',
        'operation_ids must be non-empty strings',
      );
    }
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
    const revisionId = requireString(args, 'revision_id');
    const raw = await wrapApi(client.getContextWorkflow(revisionId));
    return ok(
      `# Context Workflow\n\n**Revision:** ${raw.revision}\n**Kind:** ${raw.kind}\n**Trigger:** ${raw.trigger}`,
      raw as unknown as Record<string, unknown>,
    );
  },

  run_saved_workflow: async (args, client) => {
    const revisionId = requireString(args, 'revision_id');
    const mode = requireString(args, 'mode');
    if (mode !== 'preview' && mode !== 'propose') {
      throw new ToolFailure('invalid_argument', 'mode must be preview or propose');
    }
    const eventId = requireString(args, 'event_id');
    if (!args?.input || typeof args.input !== 'object' || Array.isArray(args.input)) {
      throw new ToolFailure('invalid_argument', 'input object is required');
    }
    const raw = await wrapApi(
      client.runSavedWorkflow({
        revision_id: revisionId,
        mode,
        event_id: eventId,
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
    const runId = requireString(args, 'run_id');
    const raw = await wrapApi(client.getWorkflowRun(runId));
    return ok(
      `# Workflow Run\n\n**Run:** ${raw.runId}\n**Workflow revision:** ${raw.workflowRevision}`,
      raw as unknown as Record<string, unknown>,
    );
  },

  get_evaluation: async (args, client) => {
    const runId = requireString(args, 'run_id');
    const raw = await wrapApi(client.getEvaluation(runId));
    return ok(
      `# Evaluation Run\n\n**Run:** ${raw.run_id}\n**Private gold denied:** ${raw.private_gold_denied ? 'yes' : 'no'}`,
      raw as unknown as Record<string, unknown>,
    );
  },

  compare_evaluations: async (args, client) => {
    const baseline = requireString(args, 'baseline_run_id');
    const candidate = requireString(args, 'candidate_run_id');
    const raw = await wrapApi(
      client.compareEvaluations({
        baseline_run_id: baseline,
        candidate_run_id: candidate,
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
    const runId = requireString(args, 'run_id');
    const caseId = requireString(args, 'case_id');
    const raw = await wrapApi(client.getEvaluationCase(runId, caseId));
    return ok(
      `# Evaluation Case\n\n**Run:** ${raw.run_id}\n**Case:** ${raw.case_id}`,
      raw as unknown as Record<string, unknown>,
    );
  },
};
