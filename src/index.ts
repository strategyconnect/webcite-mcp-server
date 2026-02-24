#!/usr/bin/env node
/**
 * WebCite MCP Server
 *
 * Provides fact verification and citation tools for Claude.
 *
 * Tools:
 * - verify_claim: Full verification with stance analysis and verdict
 * - verify_claim_stream: Streaming verification (collects SSE events, returns assembled result)
 * - search_sources: Quick citation search without analysis
 * - list_citations: List past verification results
 * - get_citation: Get details of a specific verification
 * - upload_file: Upload a file for use as verification context
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  WebCiteApiClient,
  type Citation,
  type ClaimGroup,
  type SSEEvent,
  type Verdict,
  type VerifyClaimResponse,
} from './api-client.js';

// Get API key from environment
const API_KEY = process.env.WEBCITE_API_KEY;
const BASE_URL = process.env.WEBCITE_API_URL || 'https://api.webcite.co';

if (!API_KEY) {
  console.error('Error: WEBCITE_API_KEY environment variable is required');
  console.error('Get your API key at https://webcite.co/api-keys');
  process.exit(1);
}

const client = new WebCiteApiClient(API_KEY, BASE_URL);

// Define tools
const TOOLS = [
  {
    name: 'verify_claim',
    description: `Verify a factual claim against authoritative sources. Returns sources with stance analysis (supports/contradicts/neutral) and an overall verdict.

Use this when you need to:
- Fact-check a specific claim
- Find sources that support or contradict a statement
- Get a confidence score for a claim's accuracy

Credits: 2-4 depending on options (search: 2, +stance: 1, +verdict: 1)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        claim: {
          type: 'string',
          description: 'The factual claim to verify (e.g., "The Eiffel Tower is 330 meters tall")',
        },
        thread_id: {
          type: 'string',
          description:
            'Thread ID to group related verifications in a session. Pass the same thread_id to continue a conversation.',
        },
        include_stance: {
          type: 'boolean',
          description:
            'Include stance analysis (supports/contradicts) for each source. Adds 1 credit. Default: true',
          default: true,
        },
        include_verdict: {
          type: 'boolean',
          description:
            'Generate an overall verdict with confidence score. Adds 1 credit. Default: true',
          default: true,
        },
        decompose_claim: {
          type: 'boolean',
          description:
            'Break complex claims into sub-claims and verify each independently. Useful for multi-part claims.',
          default: false,
        },
      },
      required: ['claim'],
    },
  },
  {
    name: 'verify_claim_stream',
    description: `Verify a factual claim using the streaming endpoint. Collects all intermediate results (claim decomposition progress, per-sub-claim results) and returns the assembled result.

Prefer this over verify_claim when:
- The claim is complex and may take a long time to verify
- You want intermediate progress data (sub-claim decomposition, per-claim results)
- You want to avoid HTTP timeouts on long-running verifications

Returns the same formatted output as verify_claim. Credits: same as verify_claim.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        claim: {
          type: 'string',
          description: 'The factual claim to verify',
        },
        thread_id: {
          type: 'string',
          description:
            'Thread ID to group related verifications in a session. Pass the same thread_id to continue a conversation.',
        },
        include_stance: {
          type: 'boolean',
          description: 'Include stance analysis for each source. Default: true',
          default: true,
        },
        include_verdict: {
          type: 'boolean',
          description: 'Generate an overall verdict with confidence score. Default: true',
          default: true,
        },
        decompose_claim: {
          type: 'boolean',
          description: 'Break complex claims into sub-claims and verify each independently.',
          default: false,
        },
      },
      required: ['claim'],
    },
  },
  {
    name: 'search_sources',
    description: `Search for authoritative sources related to a query. Returns raw citations without stance analysis or verdict.

Use this when you need to:
- Find sources on a topic quickly
- Get raw search results for further analysis
- Save credits by skipping analysis

Credits: 2 (search only)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query or claim to find sources for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of sources to return (1-20)',
          default: 10,
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_citations',
    description: `List your past verification results. Useful for reviewing previous fact-checks or continuing a research session.

Credits: 0 (free)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: {
          type: 'number',
          description: 'Page number (starts at 1)',
          default: 1,
          minimum: 1,
        },
        limit: {
          type: 'number',
          description: 'Results per page (max 50)',
          default: 10,
          minimum: 1,
          maximum: 50,
        },
        thread_id: {
          type: 'string',
          description: 'Filter by thread ID to get citations from a specific session',
        },
      },
    },
  },
  {
    name: 'get_citation',
    description: `Get the full details of a specific past verification by its ID.

Credits: 0 (free)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        citation_id: {
          type: 'string',
          description: 'The citation ID to retrieve',
        },
      },
      required: ['citation_id'],
    },
  },
  {
    name: 'upload_file',
    description: `Upload a file to WebCite for use as verification context. Supports documents (PDF, DOCX, TXT) and other common file types.

Use this when you need to:
- Verify claims against a specific document
- Provide additional context for fact-checking
- Upload research papers or reports for analysis`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Absolute path to the file to upload',
        },
      },
      required: ['file_path'],
    },
  },
];

/**
 * Format a citation for display
 */
function formatCitation(citation: Citation, index: number): string {
  const parts: string[] = [];
  parts.push(`${index + 1}. **${citation.title || 'Untitled'}**`);
  parts.push(`   URL: ${citation.url}`);

  if (citation.stance) {
    const stanceEmoji: Record<string, string> = {
      supports: '\u2713',
      partially_supports: '~',
      contradicts: '\u2717',
      neutral: '\u25CB',
      irrelevant: '\u2014',
    };
    parts.push(
      `   Stance: ${stanceEmoji[citation.stance] || '?'} ${citation.stance}${citation.stance_confidence ? ` (${citation.stance_confidence}% confidence)` : ''}`,
    );
  }

  if (citation.credibility_score) {
    parts.push(`   Credibility: ${citation.credibility_score}/100`);
  }

  if (citation.snippet) {
    const truncatedSnippet =
      citation.snippet.length > 200 ? citation.snippet.substring(0, 200) + '...' : citation.snippet;
    parts.push(`   Snippet: "${truncatedSnippet}"`);
  }

  if (citation.stance_explanation) {
    parts.push(`   Analysis: ${citation.stance_explanation}`);
  }

  return parts.join('\n');
}

/**
 * Format a verdict for display
 */
function formatVerdict(verdict: Verdict): string {
  const parts: string[] = [];

  const resultEmoji: Record<string, string> = {
    supported: '\u2713',
    partially_supported: '~',
    contradicted: '\u2717',
    mixed: '\u26A1',
    unverifiable: '?',
  };

  parts.push(`## Verdict: ${resultEmoji[verdict.result] || '?'} ${verdict.result.toUpperCase()}`);
  parts.push(`**Confidence:** ${verdict.confidence}%`);
  parts.push(`**Summary:** ${verdict.summary}`);

  if (verdict.stance_breakdown) {
    const sb = verdict.stance_breakdown;
    parts.push(`\n**Source Breakdown:**`);
    parts.push(`- Supporting: ${sb.supports}`);
    parts.push(`- Partially supporting: ${sb.partially_supports}`);
    parts.push(`- Contradicting: ${sb.contradicts}`);
    parts.push(`- Neutral: ${sb.neutral}`);
  }

  if (verdict.key_findings && verdict.key_findings.length > 0) {
    parts.push(`\n**Key Findings:**`);
    verdict.key_findings.forEach((finding, i) => {
      parts.push(`${i + 1}. ${finding.finding} (${finding.confidence}% confidence)`);
    });
  }

  if (verdict.corrections && verdict.corrections.length > 0) {
    parts.push(`\n**Corrections:**`);
    verdict.corrections.forEach((correction, i) => {
      parts.push(`${i + 1}. Claimed: "${correction.claimed}" \u2192 Actual: "${correction.actual}"`);
    });
  }

  if (verdict.unverified_claims && verdict.unverified_claims.length > 0) {
    parts.push(`\n**Unverified Parts:**`);
    verdict.unverified_claims.forEach((claim, i) => {
      parts.push(`${i + 1}. ${claim}`);
    });
  }

  return parts.join('\n');
}

/**
 * Format a claim group for display
 */
function formatClaimGroup(group: ClaimGroup): string {
  const parts: string[] = [];
  parts.push(`### Claim ${group.claim_index}: "${group.claim}"`);
  parts.push(`Status: ${group.stance_summary} | Sources: ${group.citation_count}`);

  if (group.citations && group.citations.length > 0) {
    parts.push('\n**Sources:**');
    group.citations.slice(0, 5).forEach((citation, i) => {
      parts.push(formatCitation(citation, i));
    });
    if (group.citations.length > 5) {
      parts.push(`\n... and ${group.citations.length - 5} more sources`);
    }
  }

  if (group.verdict) {
    parts.push('\n' + formatVerdict(group.verdict));
  }

  return parts.join('\n');
}

/**
 * Format a VerifyClaimResponse into readable text
 */
function formatVerifyResult(claim: string, result: VerifyClaimResponse): string {
  const parts: string[] = [];
  parts.push(`# Fact Check: "${claim}"\n`);

  // Show claim groups (unified structure)
  if (result.claim_groups && result.claim_groups.length > 0) {
    if (result.claim_groups.length === 1) {
      // Single claim - show directly
      const group = result.claim_groups[0];
      if (group.verdict) {
        parts.push(formatVerdict(group.verdict));
        parts.push('');
      }
      if (group.citations && group.citations.length > 0) {
        parts.push('## Sources\n');
        group.citations.forEach((citation, i) => {
          parts.push(formatCitation(citation, i));
          parts.push('');
        });
      }
    } else {
      // Multiple claims - show each group
      parts.push(`Found ${result.claim_groups.length} sub-claims:\n`);
      result.claim_groups.forEach((group) => {
        parts.push(formatClaimGroup(group));
        parts.push('\n---\n');
      });
    }
  } else if (result.citations && result.citations.length > 0) {
    // Legacy format - direct citations
    if (result.verdict) {
      parts.push(formatVerdict(result.verdict));
      parts.push('');
    }
    parts.push('## Sources\n');
    result.citations.forEach((citation, i) => {
      parts.push(formatCitation(citation, i));
      parts.push('');
    });
  } else {
    parts.push('No sources found for this claim.');
  }

  // Add credit usage info
  if (result.credit_usage) {
    parts.push(
      `\n---\nCredits used: ${result.credit_usage.credits_used} | Remaining: ${result.credit_usage.credits_remaining}`,
    );
  }

  return parts.join('\n');
}

/**
 * Collect streaming SSE events into a VerifyClaimResponse
 */
async function collectStreamEvents(
  stream: AsyncGenerator<SSEEvent>,
): Promise<{ result: VerifyClaimResponse | null; events: SSEEvent[] }> {
  const events: SSEEvent[] = [];
  let finalResult: VerifyClaimResponse | null = null;

  for await (const event of stream) {
    events.push(event);

    // The 'complete' or 'result' event typically contains the final assembled response
    if (event.event === 'complete' || event.event === 'result' || event.event === 'done') {
      if (event.data && typeof event.data === 'object') {
        finalResult = event.data as VerifyClaimResponse;
      }
    }
  }

  // If no explicit final event, try to assemble from accumulated events
  if (!finalResult) {
    const claimGroups: ClaimGroup[] = [];
    let creditUsage: VerifyClaimResponse['credit_usage'] | undefined;
    let threadId = '';

    for (const event of events) {
      const data = event.data as Record<string, unknown>;
      if (!data || typeof data !== 'object') continue;

      if (event.event === 'claim_group' && data) {
        claimGroups.push(data as unknown as ClaimGroup);
      }
      if (event.event === 'credit_usage' && data) {
        creditUsage = data as VerifyClaimResponse['credit_usage'];
      }
      if (data.thread_id) {
        threadId = data.thread_id as string;
      }
      // Some backends send the full result in the last data event
      if (data.claim_groups) {
        finalResult = data as unknown as VerifyClaimResponse;
      }
    }

    if (!finalResult && claimGroups.length > 0) {
      finalResult = {
        claim_groups: claimGroups,
        totalResults: claimGroups.reduce((sum, g) => sum + g.citation_count, 0),
        thread_id: threadId,
        credit_usage: creditUsage,
      };
    }
  }

  return { result: finalResult, events };
}

// Create and configure the server
const server = new Server(
  {
    name: 'webcite',
    version: '1.2.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'verify_claim': {
        const claim = args?.claim as string;
        const threadId = args?.thread_id as string | undefined;
        const includeStance = args?.include_stance !== false;
        const includeVerdict = args?.include_verdict !== false;
        const decomposeClaim = args?.decompose_claim === true;

        if (!claim) {
          return {
            content: [{ type: 'text', text: 'Error: claim is required' }],
            isError: true,
          };
        }

        const result = await client.verifyClaim({
          claim,
          thread_id: threadId,
          include_stance: includeStance,
          include_verdict: includeVerdict,
          use_claim_decomposition: decomposeClaim,
        });

        return {
          content: [{ type: 'text', text: formatVerifyResult(claim, result) }],
        };
      }

      case 'verify_claim_stream': {
        const claim = args?.claim as string;
        const threadId = args?.thread_id as string | undefined;
        const includeStance = args?.include_stance !== false;
        const includeVerdict = args?.include_verdict !== false;
        const decomposeClaim = args?.decompose_claim === true;

        if (!claim) {
          return {
            content: [{ type: 'text', text: 'Error: claim is required' }],
            isError: true,
          };
        }

        const stream = client.verifyClaimStream({
          claim,
          thread_id: threadId,
          include_stance: includeStance,
          include_verdict: includeVerdict,
          use_claim_decomposition: decomposeClaim,
        });

        const { result, events } = await collectStreamEvents(stream);

        if (result) {
          const output = formatVerifyResult(claim, result);
          return {
            content: [{ type: 'text', text: output }],
          };
        }

        // Fallback: return raw events if we couldn't assemble a result
        const eventSummary = events
          .map((e) => `[${e.event}] ${typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}`)
          .join('\n');
        return {
          content: [
            {
              type: 'text',
              text: `# Streaming Verification: "${claim}"\n\nReceived ${events.length} events but could not assemble a structured result.\n\n## Raw Events:\n${eventSummary}`,
            },
          ],
        };
      }

      case 'search_sources': {
        const query = args?.query as string;
        const limit = Math.min(Math.max((args?.limit as number) || 10, 1), 20);

        if (!query) {
          return {
            content: [{ type: 'text', text: 'Error: query is required' }],
            isError: true,
          };
        }

        const result = await client.searchSources({ query, limit });

        // Format the response
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

        return {
          content: [{ type: 'text', text: parts.join('\n') }],
        };
      }

      case 'list_citations': {
        const page = Math.max((args?.page as number) || 1, 1);
        const limit = Math.min(Math.max((args?.limit as number) || 10, 1), 50);
        const threadId = args?.thread_id as string | undefined;

        const result = await client.listCitations({ page, limit, thread_id: threadId });

        // Format the response
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

        return {
          content: [{ type: 'text', text: parts.join('\n') }],
        };
      }

      case 'get_citation': {
        const citationId = args?.citation_id as string;

        if (!citationId) {
          return {
            content: [{ type: 'text', text: 'Error: citation_id is required' }],
            isError: true,
          };
        }

        const result = await client.getCitation(citationId);

        // Format the response
        const parts: string[] = [];
        parts.push(`# Verification Details\n`);
        parts.push(`**Prompt:** ${result.data.prompt}\n`);

        // Parse citations if they're a string
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

        return {
          content: [{ type: 'text', text: parts.join('\n') }],
        };
      }

      case 'upload_file': {
        const filePath = args?.file_path as string;

        if (!filePath) {
          return {
            content: [{ type: 'text', text: 'Error: file_path is required' }],
            isError: true,
          };
        }

        const result = await client.uploadFile(filePath);

        const parts: string[] = [];
        parts.push(`# File Uploaded Successfully\n`);
        parts.push(`**File ID:** ${result.file_id}`);
        parts.push(`**Filename:** ${result.filename}`);
        parts.push(`**Type:** ${result.mime_type}`);
        parts.push(`**Size:** ${result.size} bytes`);

        return {
          content: [{ type: 'text', text: parts.join('\n') }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('WebCite MCP Server running');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
