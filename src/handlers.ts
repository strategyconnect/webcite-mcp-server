/**
 * Tool handlers — one per entry in TOOLS. Each returns the text shown to the agent;
 * throwing marks the tool call as an error.
 */

import type { WebCiteApiClient } from './api-client.js';
import {
  formatAccuracyReport,
  formatAnalyzeResult,
  formatBatchResults,
  formatCitation,
  formatClassify,
  formatDocumentAnalysis,
  formatExtractedDoc,
  formatFigures,
  formatGaps,
  formatSourcePreview,
  formatVerifyResult,
} from './formatters.js';
import { collectStreamEvents } from './stream.js';
import type {
  AssetRefOptions,
  BatchItem,
  Citation,
  ExtractedFigure,
  FeedbackVerdict,
  GapDoc,
  Taxonomy,
  VerifyClaimOptions,
} from './types.js';

type Args = Record<string, unknown> | undefined;

export type ToolHandler = (args: Args, client: WebCiteApiClient) => Promise<string>;

function requireString(args: Args, key: string): string {
  const value = args?.[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function assetRef(args: Args): AssetRefOptions {
  const assetId = args?.asset_id as string | undefined;
  const assetUrl = args?.asset_url as string | undefined;
  if (!assetId && !assetUrl) {
    throw new Error('provide either asset_id (uploaded file) or asset_url (direct file URL)');
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

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : fallback;
  return Math.min(Math.max(n, min), max);
}

export const handlers: Record<string, ToolHandler> = {
  verify_claim: async (args, client) => {
    const options = verifyOptions(args);
    const result = await client.verifyClaim(options);
    return formatVerifyResult(options.claim, result);
  },

  verify_claim_stream: async (args, client) => {
    const options = verifyOptions(args);
    const { result, events } = await collectStreamEvents(client.verifyClaimStream(options));

    if (result) return formatVerifyResult(options.claim, result);

    // Fallback: return raw events if we couldn't assemble a result
    const eventSummary = events
      .map((e) => `[${e.event}] ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}`)
      .join('\n');
    return `# Streaming Verification: "${options.claim}"\n\nReceived ${events.length} events but could not assemble a structured result.\n\n## Raw Events:\n${eventSummary}`;
  },

  search_sources: async (args, client) => {
    const query = requireString(args, 'query');
    const limit = clamp(args?.limit, 10, 1, 20);
    const result = await client.searchSources({ query, limit });

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

    return parts.join('\n');
  },

  list_citations: async (args, client) => {
    const page = clamp(args?.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = clamp(args?.limit, 10, 1, 50);
    const result = await client.listCitations({
      page,
      limit,
      thread_id: args?.thread_id as string | undefined,
    });

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

    return parts.join('\n');
  },

  get_citation: async (args, client) => {
    const citationId = requireString(args, 'citation_id');
    const result = await client.getCitation(citationId);

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

    return parts.join('\n');
  },

  upload_file: async (args, client) => {
    const filePath = requireString(args, 'file_path');
    const result = await client.uploadFile(filePath);

    const parts: string[] = [];
    parts.push(`# File Uploaded Successfully\n`);
    parts.push(`**File ID:** ${result.file_id}`);
    parts.push(`**Filename:** ${result.filename}`);
    parts.push(`**Type:** ${result.mime_type}`);
    parts.push(`**Size:** ${result.size} bytes`);

    return parts.join('\n');
  },

  get_source_preview: async (args, client) => {
    const url = args?.url as string | undefined;
    const assetId = args?.asset_id as string | undefined;

    if (!url && !assetId) {
      throw new Error('provide either url (web source) or asset_id (uploaded document)');
    }

    const result = await client.sourcePreview({
      url,
      asset_id: assetId,
      page: args?.page as number | undefined,
      quote: args?.quote as string | undefined,
    });

    return formatSourcePreview(result);
  },

  verify_batch: async (args, client) => {
    const items = args?.items as BatchItem[] | undefined;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items is required and must be a non-empty array');
    }
    if (items.length > 200) {
      throw new Error(`items holds ${items.length} entries; the maximum per call is 200`);
    }

    const results = await client.verifyBatch(items);
    return formatBatchResults(results);
  },

  verify_feedback: async (args, client) => {
    const token = requireString(args, 'token');
    const verdict = requireString(args, 'verdict') as FeedbackVerdict;
    if (!['correct', 'incorrect', 'unsure'].includes(verdict)) {
      throw new Error('verdict must be one of: correct, incorrect, unsure');
    }

    await client.verifyFeedback(token, verdict, args?.note as string | undefined);
    return `# Feedback Recorded\n\n**Verdict:** ${verdict}${args?.note ? `\n**Note:** ${args.note}` : ''}`;
  },

  analyze_conflicts: async (args, client) => {
    const figures = args?.figures as ExtractedFigure[] | undefined;
    if (!Array.isArray(figures) || figures.length === 0) {
      throw new Error('figures is required and must be a non-empty array');
    }

    const result = await client.analyzeConflicts(figures);
    return `# Numeric Analysis: ${figures.length} figure(s)\n\n${formatAnalyzeResult(result)}`;
  },

  analyze_document: async (args, client) => {
    const assetId = requireString(args, 'asset_id');
    const result = await client.analyzeDocument(assetId);
    return formatDocumentAnalysis(result);
  },

  classify_document: async (args, client) => {
    const result = await client.classifyDocument({
      ...assetRef(args),
      taxonomy: args?.taxonomy as Taxonomy | undefined,
    });
    return formatClassify(result);
  },

  document_gaps: async (args, client) => {
    const category = requireString(args, 'category');
    const docs = (Array.isArray(args?.docs) ? args?.docs : []) as GapDoc[];
    const result = await client.documentGaps({
      category,
      docs,
      taxonomy: args?.taxonomy as Taxonomy | undefined,
      stage: args?.stage as 'early' | 'growth' | undefined,
    });
    return formatGaps(category, result);
  },

  extract_document: async (args, client) => {
    const result = await client.extractDocument(assetRef(args));
    return formatExtractedDoc(result);
  },

  extract_figures: async (args, client) => {
    const result = await client.extractFigures(assetRef(args));
    return formatFigures(result.figures ?? []);
  },

  accuracy_report: async (_args, client) => {
    const result = await client.accuracyReport();
    return formatAccuracyReport(result);
  },
};
