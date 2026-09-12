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
  ChangeImpactOptions,
  ChangeImpactResponse,
  Citation,
  ClassifyOptions,
  ClassifyResult,
  CompareAssertionsOptions,
  CompareAssertionsResponse,
  ContextQueryResponse,
  CreateEvidencePacketOptions,
  CreateEvidencePacketResponse,
  AssessSupportOptions,
  AssessSupportResponse,
  AssessMeaningOptions,
  AssessMeaningResponse,
  FindContradictionsOptions,
  FindContradictionsResponse,
  FormalEligibilityOptions,
  FormalEligibilityResponse,
  FormalCheckOptions,
  FormalCheckResponse,
  CreateClaimRelationOptions,
  CreateClaimRelationResponse,
  ListClaimRelationsOptions,
  ListClaimRelationsResponse,
  CreateMetricDefinitionOptions,
  CreateMetricDefinitionResponse,
  ListMetricDefinitionsOptions,
  ListMetricDefinitionsResponse,
  CreateResearchRunOptions,
  CreateResearchRunResponse,
  GetResearchRunOptions,
  GetResearchRunResponse,
  CheckpointResearchRunOptions,
  CheckpointResearchRunResponse,
  ResolveSeedsOptions,
  ResolveSeedsResponse,
  LearningJudgeOptions,
  LearningJudgeResponse,
  LearningApplyOptions,
  LearningApplyResponse,
  LearningPlaceholderOptions,
  LearningPlaceholderResponse,
  FormatCertifyOptions,
  FormatCertifyResponse,
  DocumentAnalysisResponse,
  EvalCatalogResponse,
  EvaluationCaseResponse,
  EvaluationCompareResponse,
  EvaluationDescribeResponse,
  ExtractedDoc,
  ExtractedFigure,
  AssetRefOptions,
  FeedbackVerdict,
  FiguresResponse,
  GapsOptions,
  GapsResponse,
  ListCitationsOptions,
  ListCitationsResponse,
  QueryContextOptions,
  ResolvedAnswerResponse,
  ResolvedPacketResponse,
  SavedWorkflowPayload,
  SearchSourcesOptions,
  SourcePreviewOptions,
  SourcePreviewResponse,
  SSEEvent,
  UploadResponse,
  VerifyClaimOptions,
  VerifyClaimResponse,
  WorkflowExecutionResponse,
} from './types.js';
import { ApiClientError } from './errors.js';

export * from './types.js';
export { ApiClientError, ToolFailure } from './errors.js';

export class WebCiteApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = 'https://api.webcite.co') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    extras: { idempotencyKey?: string } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      ...(options.headers as Record<string, string> | undefined),
    };
    if (extras.idempotencyKey) {
      headers['Idempotency-Key'] = extras.idempotencyKey;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ApiClientError(response.status, errorBody);
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
      throw new ApiClientError(response.status, errorBody);
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
      throw new ApiClientError(response.status, errorBody);
    }

    return response.json() as Promise<UploadResponse>;
  }

  /* ---------------------------------------------------------- context graph (v2) */

  async getAnswer(revisionId: string): Promise<ResolvedAnswerResponse> {
    return this.request(`/api/v2/answers/${encodeURIComponent(revisionId)}`, {
      method: 'GET',
    });
  }

  async getEvidencePacket(packetId: string): Promise<ResolvedPacketResponse> {
    return this.request(`/api/v2/evidence-packets/${encodeURIComponent(packetId)}`, {
      method: 'GET',
    });
  }

  async queryContext(options: QueryContextOptions): Promise<ContextQueryResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/query',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async compareAssertions(
    options: CompareAssertionsOptions,
  ): Promise<CompareAssertionsResponse> {
    const { idempotency_key, left, right } = options;
    return this.request(
      '/api/v2/context/compare-assertions',
      { method: 'POST', body: JSON.stringify({ left, right }) },
      { idempotencyKey: idempotency_key },
    );
  }

  async getChangeImpact(options: ChangeImpactOptions): Promise<ChangeImpactResponse> {
    const { idempotency_key, answer_revision_id } = options;
    return this.request(
      '/api/v2/context/change-impact',
      { method: 'POST', body: JSON.stringify({ answer_revision_id }) },
      { idempotencyKey: idempotency_key },
    );
  }

  async createEvidencePacket(
    options: CreateEvidencePacketOptions,
  ): Promise<CreateEvidencePacketResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/evidence-packets',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async assessSupport(options: AssessSupportOptions): Promise<AssessSupportResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/assess-support',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async assessMeaning(options: AssessMeaningOptions): Promise<AssessMeaningResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/assess-meaning',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async findContradictions(
    options: FindContradictionsOptions,
  ): Promise<FindContradictionsResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/contradictions',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async formalEligibility(
    options: FormalEligibilityOptions,
  ): Promise<FormalEligibilityResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/formal/eligibility',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async formalCheck(options: FormalCheckOptions): Promise<FormalCheckResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/formal/check',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async createClaimRelation(
    options: CreateClaimRelationOptions,
  ): Promise<CreateClaimRelationResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/claim-relations',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async listClaimRelations(
    options: ListClaimRelationsOptions = {},
  ): Promise<ListClaimRelationsResponse> {
    const params = new URLSearchParams();
    if (options.predicate) params.set('predicate', options.predicate);
    if (options.claim_revision_id) params.set('claim_revision_id', options.claim_revision_id);
    const q = params.toString();
    return this.request(
      `/api/v2/context/claim-relations${q ? `?${q}` : ''}`,
      { method: 'GET' },
    );
  }

  async createMetricDefinition(
    options: CreateMetricDefinitionOptions,
  ): Promise<CreateMetricDefinitionResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/metric-definitions',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async listMetricDefinitions(
    options: ListMetricDefinitionsOptions = {},
  ): Promise<ListMetricDefinitionsResponse> {
    const params = new URLSearchParams();
    if (options.metric) params.set('metric', options.metric);
    const q = params.toString();
    return this.request(
      `/api/v2/context/metric-definitions${q ? `?${q}` : ''}`,
      { method: 'GET' },
    );
  }

  async createResearchRun(
    options: CreateResearchRunOptions,
  ): Promise<CreateResearchRunResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/research-runs',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async getResearchRun(options: GetResearchRunOptions): Promise<GetResearchRunResponse> {
    return this.request(
      `/api/v2/context/research-runs/${encodeURIComponent(options.run_id)}`,
      { method: 'GET' },
    );
  }

  async checkpointResearchRun(
    options: CheckpointResearchRunOptions,
  ): Promise<CheckpointResearchRunResponse> {
    const { run_id, idempotency_key, ...body } = options;
    return this.request(
      `/api/v2/context/research-runs/${encodeURIComponent(run_id)}/checkpoints`,
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async resolveSeeds(options: ResolveSeedsOptions): Promise<ResolveSeedsResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/resolve-seeds',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async learningJudge(options: LearningJudgeOptions): Promise<LearningJudgeResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/learning/judge',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async learningApply(options: LearningApplyOptions): Promise<LearningApplyResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/learning/apply',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async learningPlaceholder(
    options: LearningPlaceholderOptions = {},
  ): Promise<LearningPlaceholderResponse> {
    const params = new URLSearchParams();
    if (options.criterion) params.set('criterion', options.criterion);
    const q = params.toString();
    return this.request(
      `/api/v2/context/learning/placeholder${q ? `?${q}` : ''}`,
      { method: 'GET' },
    );
  }

  async formatCertify(options: FormatCertifyOptions): Promise<FormatCertifyResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/format/certify',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async evalCatalog(): Promise<EvalCatalogResponse> {
    return this.request('/api/v2/context/eval/catalog', { method: 'GET' });
  }

  async publishContextWorkflow(
    workflow: SavedWorkflowPayload,
    idempotencyKey?: string,
  ): Promise<{ revision?: string; workflow?: SavedWorkflowPayload } & SavedWorkflowPayload> {
    return this.request(
      '/api/v2/context/workflows',
      { method: 'POST', body: JSON.stringify(workflow) },
      { idempotencyKey },
    );
  }

  async getContextWorkflow(revisionId: string): Promise<SavedWorkflowPayload> {
    return this.request(`/api/v2/context/workflows/${encodeURIComponent(revisionId)}`, {
      method: 'GET',
    });
  }

  async runSavedWorkflow(options: {
    revision_id: string;
    mode: 'preview' | 'propose';
    event_id: string;
    input: Record<string, unknown>;
    idempotency_key?: string;
  }): Promise<WorkflowExecutionResponse> {
    const { revision_id, idempotency_key, ...body } = options;
    return this.request(
      `/api/v2/context/workflows/${encodeURIComponent(revision_id)}/runs`,
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async getWorkflowRun(runId: string): Promise<WorkflowExecutionResponse> {
    return this.request(`/api/v2/context/runs/${encodeURIComponent(runId)}`, {
      method: 'GET',
    });
  }

  async getEvaluation(runId: string): Promise<EvaluationDescribeResponse> {
    return this.request(`/api/v2/context/evaluations/${encodeURIComponent(runId)}`, {
      method: 'GET',
    });
  }

  async compareEvaluations(options: {
    baseline_run_id: string;
    candidate_run_id: string;
    idempotency_key?: string;
  }): Promise<EvaluationCompareResponse> {
    const { idempotency_key, ...body } = options;
    return this.request(
      '/api/v2/context/evaluations/compare',
      { method: 'POST', body: JSON.stringify(body) },
      { idempotencyKey: idempotency_key },
    );
  }

  async getEvaluationCase(
    runId: string,
    caseId: string,
  ): Promise<EvaluationCaseResponse> {
    return this.request(
      `/api/v2/context/evaluations/${encodeURIComponent(runId)}/cases/${encodeURIComponent(caseId)}`,
      { method: 'GET' },
    );
  }
}
