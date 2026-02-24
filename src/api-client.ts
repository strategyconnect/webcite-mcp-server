/**
 * WebCite API Client - Public API endpoints
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface VerifyClaimOptions {
  claim: string;
  thread_id?: string;
  include_stance?: boolean;
  include_verdict?: boolean;
  decompose_claim?: boolean;
  use_claim_decomposition?: boolean;
}

export interface SearchSourcesOptions {
  query: string;
  limit?: number;
}

export interface ListCitationsOptions {
  page?: number;
  limit?: number;
  thread_id?: string;
}

export interface Citation {
  id: string;
  title: string;
  url: string;
  snippet: string;
  author?: string;
  status?: string;
  credibility_score?: number;
  rank?: number;
  stance?: 'supports' | 'contradicts' | 'partially_supports' | 'neutral' | 'irrelevant';
  stance_confidence?: number;
  stance_explanation?: string;
  ranking_factors?: {
    source_authority: number;
    content_relevance: number;
    recency: number;
  };
  source_metadata?: {
    domain: string;
    domain_category: string;
    is_primary_source: boolean;
    is_fact_check_site: boolean;
  };
  publication_year?: number;
}

export interface Verdict {
  claim: string;
  result: 'supported' | 'partially_supported' | 'contradicted' | 'mixed' | 'unverifiable';
  confidence: number;
  summary: string;
  stance_breakdown: {
    supports: number;
    partially_supports: number;
    contradicts: number;
    neutral: number;
  };
  key_findings?: Array<{
    finding: string;
    citation_ids: string[];
    confidence: number;
  }>;
  corrections?: Array<{
    claimed: string;
    actual: string;
    citation_ids: string[];
  }>;
  unverified_claims?: string[];
}

export interface ClaimGroup {
  claim_id: string;
  claim_index: number;
  claim: string;
  stance_summary: 'supported' | 'contradicted' | 'mixed' | 'unverifiable';
  citation_count: number;
  citations: Citation[];
  verdict?: Verdict;
}

export interface VerifyClaimResponse {
  claim_groups: ClaimGroup[];
  totalResults: number;
  thread_id: string;
  citations?: Citation[];
  verdict?: Verdict;
  generated_prompts?: string[];
  credit_usage?: {
    credits_used: number;
    credits_remaining: number;
  };
}

export interface CitationRecord {
  id: string;
  thread_id: string;
  prompt: string;
  citation?: string | Citation[];
  created_at?: string;
}

export interface ListCitationsResponse {
  data: CitationRecord[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface SSEEvent {
  event: string;
  data: unknown;
}

export interface UploadResponse {
  success: boolean;
  file_id: string;
  filename: string;
  mime_type: string;
  size: number;
}

export class WebCiteApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.webcite.co') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WebCite API error (${response.status}): ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  async verifyClaim(options: VerifyClaimOptions): Promise<VerifyClaimResponse> {
    return this.request('/api/v1/verify', {
      method: 'POST',
      body: JSON.stringify({
        claim: options.claim,
        thread_id: options.thread_id,
        include_stance: options.include_stance !== false,
        include_verdict: options.include_verdict !== false,
        decompose_claim: options.decompose_claim ?? options.use_claim_decomposition ?? false,
      }),
    });
  }

  async *verifyClaimStream(options: VerifyClaimOptions): AsyncGenerator<SSEEvent> {
    const url = `${this.baseUrl}/api/v1/verify/stream`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        claim: options.claim,
        thread_id: options.thread_id,
        include_stance: options.include_stance !== false,
        include_verdict: options.include_verdict !== false,
        decompose_claim: options.decompose_claim ?? options.use_claim_decomposition ?? false,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WebCite API error (${response.status}): ${errorBody}`);
    }

    if (!response.body) {
      throw new Error('No response body received from streaming endpoint');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? '';

        let currentEvent = 'message';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          } else if (line === '' && currentData) {
            // Empty line marks end of an SSE event
            try {
              yield { event: currentEvent, data: JSON.parse(currentData) };
            } catch {
              yield { event: currentEvent, data: currentData };
            }
            currentEvent = 'message';
            currentData = '';
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        const lines = buffer.split('\n');
        let currentEvent = 'message';
        let currentData = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);
          }
        }
        if (currentData) {
          try {
            yield { event: currentEvent, data: JSON.parse(currentData) };
          } catch {
            yield { event: currentEvent, data: currentData };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async searchSources(options: SearchSourcesOptions): Promise<VerifyClaimResponse> {
    return this.request('/api/v1/sources/search', {
      method: 'POST',
      body: JSON.stringify({
        query: options.query,
        limit: options.limit ?? 10,
      }),
    });
  }

  async listCitations(options: ListCitationsOptions = {}): Promise<ListCitationsResponse> {
    const params = new URLSearchParams();
    if (options.page) params.append('page', String(options.page));
    if (options.limit) params.append('limit', String(options.limit));
    if (options.thread_id) params.append('thread_id', options.thread_id);
    const qs = params.toString();
    return this.request(`/api/v1/citations${qs ? `?${qs}` : ''}`, { method: 'GET' });
  }

  async getCitation(citationId: string): Promise<{ data: { prompt: string; citation: string | Citation[] } }> {
    return this.request(`/api/v1/citations/${encodeURIComponent(citationId)}`, { method: 'GET' });
  }

  async uploadFile(filePath: string): Promise<UploadResponse> {
    const fileBuffer = await fs.readFile(filePath);
    const fileName = path.basename(filePath);

    const formData = new FormData();
    formData.append('file', new Blob([fileBuffer]), fileName);

    const url = `${this.baseUrl}/api/v1/upload`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`WebCite API error (${response.status}): ${errorBody}`);
    }

    return response.json() as Promise<UploadResponse>;
  }
}
