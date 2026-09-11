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
  formatContextQuery,
  formatCreatePacket,
  formatAssessSupport,
  formatAssessMeaning,
  formatDocumentAnalysis,
  formatEvalCatalog,
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
  validateContextQuery,
  validateCreatePacket,
  validateAssessSupport,
  validateAssessMeaning,
  validateEvalCatalog,
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

  get_change_impact: async (args, client) => {
    const answerRevisionId = requireString(args, 'answer_revision_id');
    const raw = await wrapApi(
      client.getChangeImpact({
        answer_revision_id: answerRevisionId,
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

  eval_catalog: async (_args, client) => {
    const raw = await wrapApi(client.evalCatalog());
    const validated = validateEvalCatalog(raw);
    return ok(formatEvalCatalog(validated), validated as unknown as Record<string, unknown>);
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
