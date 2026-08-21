/**
 * WebCite API Client - Public API endpoints
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  AccuracyReport,
  AnalyzeResult,
  BatchItem,
  BatchResultItem,
  Citation,
  ClassifyOptions,
  ClassifyResult,
  DocumentAnalysisResponse,
  ExtractedDoc,
  ExtractedFigure,
  AssetRefOptions,
  FeedbackVerdict,
  FiguresResponse,
  GapsOptions,
  GapsResponse,
  ListCitationsOptions,
  ListCitationsResponse,
  SearchSourcesOptions,
  SourcePreviewOptions,
  SourcePreviewResponse,
  SSEEvent,
  UploadResponse,
  VerifyClaimOptions,
  VerifyClaimResponse,
} from './types.js';

export * from './types.js';

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

  private verifyBody(options: VerifyClaimOptions): string {
    return JSON.stringify({
      claim: options.claim,
      thread_id: options.thread_id,
      include_stance: options.include_stance !== false,
      include_verdict: options.include_verdict !== false,
      decompose_claim: options.decompose_claim ?? options.use_claim_decomposition ?? false,
    });
  }

  async verifyClaim(options: VerifyClaimOptions): Promise<VerifyClaimResponse> {
    return this.request('/api/v1/verify', {
      method: 'POST',
      body: this.verifyBody(options),
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
      body: this.verifyBody(options),
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

  async sourcePreview(options: SourcePreviewOptions): Promise<SourcePreviewResponse> {
    return this.request('/api/v1/citations/source-preview', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  /** Bind many quotes back to their sources in one call. */
  async verifyBatch(items: BatchItem[]): Promise<BatchResultItem[]> {
    return this.request('/api/v1/verify/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  /** Record a human verdict on a batch result, using its feedback_token. */
  async verifyFeedback(
    token: string,
    verdict: FeedbackVerdict,
    note?: string,
  ): Promise<{ recorded: true }> {
    return this.request('/api/v1/verify/feedback', {
      method: 'POST',
      body: JSON.stringify({ token, verdict, note }),
    });
  }

  /** Recompute and cross-check figures you already extracted. */
  async analyzeConflicts(figures: ExtractedFigure[]): Promise<AnalyzeResult> {
    return this.request('/api/v1/analyze/conflicts', {
      method: 'POST',
      body: JSON.stringify({ figures }),
    });
  }

  /** Extract, recompute and cross-check a spreadsheet or PDF in one call. */
  async analyzeDocument(assetId: string): Promise<DocumentAnalysisResponse> {
    return this.request('/api/v1/analyze/document', {
      method: 'POST',
      body: JSON.stringify({ asset_id: assetId }),
    });
  }

  async classifyDocument(options: ClassifyOptions): Promise<ClassifyResult> {
    return this.request('/api/v1/classify', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async documentGaps(options: GapsOptions): Promise<GapsResponse> {
    return this.request('/api/v1/gaps', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async extractDocument(options: AssetRefOptions): Promise<ExtractedDoc> {
    return this.request('/api/v1/extract', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async extractFigures(options: AssetRefOptions): Promise<FiguresResponse> {
    return this.request('/api/v1/extract/figures', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async accuracyReport(): Promise<AccuracyReport> {
    return this.request('/api/v1/accuracy', { method: 'GET' });
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
