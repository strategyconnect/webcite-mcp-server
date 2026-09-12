/**
 * Human-readable formatting of WebCite API responses for MCP tool output.
 */

import type {
  AccuracyReport,
  AnalyzeResult,
  BatchResultItem,
  ChangeImpactResponse,
  Citation,
  ClaimGroup,
  ClassifyResult,
  CompareAssertionsResponse,
  Conflict,
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
  DocumentAnalysisResponse,
  EvalCatalogResponse,
  CertifyPrivateUploadResponse,
  CertifyRetrieveFlagResponse,
  ExtractedDoc,
  ExtractedFigure,
  FigureProvenance,
  GapsResponse,
  Recomputation,
  ResolvedAnswerResponse,
  ResolvedPacketResponse,
  SourcePreviewResponse,
  Verdict,
  VerifyClaimResponse,
} from './types.js';

/** Cap on extracted document text, so a large file cannot flood the agent's context. */
const MAX_TEXT_CHARS = 8000;

function truncate(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n... [truncated ${text.length - max} more characters]`;
}

/**
 * Format a source preview for display
 */
export function formatSourcePreview(p: SourcePreviewResponse): string {
  const parts: string[] = [];
  const groundedMark = p.binding.grounded ? '✓ grounded' : '✗ not grounded';

  if (p.kind === 'web') {
    parts.push(`# Source Preview (web)\n`);
    if (p.title) parts.push(`**${p.title}**`);
    parts.push(`**URL:** ${p.url}`);
  } else if (p.kind === 'grid') {
    parts.push(`# Source Preview (spreadsheet)\n`);
    if (p.sheet) parts.push(`**Sheet:** ${p.sheet}`);
    parts.push(`**Asset:** ${p.asset_id} (page ${p.page})`);
  } else {
    parts.push(`# Source Preview (document page)\n`);
    parts.push(`**Asset:** ${p.asset_id} (page ${p.page})`);
  }

  if (p.quote) parts.push(`**Quote:** "${p.quote}"`);
  parts.push(`**Binding:** ${groundedMark} (${p.binding.method})`);
  parts.push(`**Deep link:** ${p.deep_link}`);

  if (p.text) {
    parts.push(`\n---\n`);
    parts.push(truncate(p.text));
  }

  return parts.join('\n');
}

/**
 * Format a citation for display
 */
export function formatCitation(citation: Citation, index: number): string {
  const parts: string[] = [];
  parts.push(`${index + 1}. **${citation.title || 'Untitled'}**`);
  parts.push(`   URL: ${citation.url}`);

  if (citation.stance) {
    const stanceEmoji: Record<string, string> = {
      supports: '✓',
      partially_supports: '~',
      contradicts: '✗',
      neutral: '○',
      irrelevant: '—',
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
export function formatVerdict(verdict: Verdict): string {
  const parts: string[] = [];

  const resultEmoji: Record<string, string> = {
    supported: '✓',
    partially_supported: '~',
    contradicted: '✗',
    mixed: '⚡',
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
      parts.push(`${i + 1}. Claimed: "${correction.claimed}" → Actual: "${correction.actual}"`);
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
export function formatClaimGroup(group: ClaimGroup): string {
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
export function formatVerifyResult(claim: string, result: VerifyClaimResponse): string {
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
 * Format batch verification results — one line of verdict per item, then the
 * feedback token so a caller can accept or reject each result.
 */
export function formatBatchResults(items: BatchResultItem[]): string {
  const parts: string[] = [];
  const grounded = items.filter((i) => i.binding?.grounded).length;
  const failed = items.filter((i) => i.error).length;

  parts.push(`# Batch Verification: ${items.length} item(s)\n`);
  parts.push(`**Grounded:** ${grounded}/${items.length}${failed ? ` | **Errors:** ${failed}` : ''}\n`);

  items.forEach((item, i) => {
    const mark = item.error ? '!' : item.binding?.grounded ? '✓' : '✗';
    parts.push(`${i + 1}. ${mark} "${truncate(item.quote ?? '', 200)}"`);
    if (item.id) parts.push(`   ID: ${item.id}`);
    if (item.error) {
      parts.push(`   Error: ${item.error}`);
    } else {
      const b = item.binding ?? { grounded: false, method: 'unbound' };
      parts.push(
        `   Binding: ${b.grounded ? 'grounded' : 'not grounded'} (${b.method}${b.score !== undefined ? `, score ${b.score}` : ''})`,
      );
      if (b.matched_text) parts.push(`   Matched: "${truncate(b.matched_text, 300)}"`);
      const v = item.verification;
      if (v) {
        parts.push(
          `   Verification: ${v.band} | layer ${v.layer} | confidence ${v.confidence}${v.review_reason ? ` | review: ${v.review_reason}` : ''}`,
        );
      }
      if (item.feedback_token) parts.push(`   Feedback token: ${item.feedback_token}`);
    }
    parts.push('');
  });

  return parts.join('\n');
}

function provenanceLabel(p?: FigureProvenance): string {
  if (!p) return 'unknown source';
  const where = [p.sheet ? `sheet ${p.sheet}` : null, p.cell, p.page ? `p.${p.page}` : null]
    .filter(Boolean)
    .join(' ');
  return `${p.documentName || p.assetId}${where ? ` (${where})` : ''} [${p.method} read]`;
}

function formatFigureLine(f: ExtractedFigure, index: number): string {
  const scope = [f.entity, f.period].filter(Boolean).join(' · ');
  const flags = [
    f.band ? f.band : null,
    f.bound === true ? 'bound' : f.bound === false ? 'unbound' : null,
  ]
    .filter(Boolean)
    .join(', ');
  const parts = [
    `${index + 1}. **${f.metric}** = ${f.value} ${f.unit}${scope ? ` — ${scope}` : ''}`,
    `   Source: ${provenanceLabel(f.provenance)}${flags ? ` | ${flags}` : ''}`,
  ];
  if (f.reviewReason) parts.push(`   Review: ${f.reviewReason}`);
  return parts.join('\n');
}

function formatConflict(c: Conflict, index: number): string {
  const parts: string[] = [];
  parts.push(`${index + 1}. **${c.metric}** — delta ${c.delta}`);
  c.values.forEach((v) => {
    parts.push(`   - ${v.value} ${v.unit}${v.entity ? ` (${v.entity})` : ''} from ${provenanceLabel(v.provenance)}`);
  });
  if (c.reconciliationQuestion) parts.push(`   Ask: ${c.reconciliationQuestion}`);
  return parts.join('\n');
}

function formatRecomputation(r: Recomputation, index: number): string {
  const mark = r.withinTolerance ? '✓' : '✗';
  const parts: string[] = [];
  parts.push(
    `${index + 1}. ${mark} **${r.metric}** — computed ${r.computed} ${r.unit}${r.stated !== undefined ? `, stated ${r.stated}` : ', not stated in the document'}`,
  );
  r.inputs.forEach((input) => {
    parts.push(`   - ${input.key} = ${input.value} from ${provenanceLabel(input.provenance)}`);
  });
  return parts.join('\n');
}

/** Conflicts, recomputations and the review flag. */
export function formatAnalyzeResult(result: AnalyzeResult): string {
  const parts: string[] = [];
  const review = result.review ?? { needs_review: false, reasons: [] };

  parts.push(
    `**Review:** ${review.needs_review ? '⚠ needs review' : '✓ no review needed'}`,
  );
  (review.reasons ?? []).forEach((reason) => parts.push(`- ${reason}`));

  parts.push(`\n## Conflicts (${result.conflicts?.length ?? 0})\n`);
  if (result.conflicts?.length) {
    result.conflicts.forEach((c, i) => parts.push(formatConflict(c, i)));
  } else {
    parts.push('No cross-document conflicts detected.');
  }

  parts.push(`\n## Recomputations (${result.recomputations?.length ?? 0})\n`);
  if (result.recomputations?.length) {
    result.recomputations.forEach((r, i) => parts.push(formatRecomputation(r, i)));
  } else {
    parts.push('No derivable metrics to recompute from these figures.');
  }

  return parts.join('\n');
}

/** Document-in analysis: the extracted figures plus the numeric analysis. */
export function formatDocumentAnalysis(result: DocumentAnalysisResponse): string {
  const parts: string[] = [];
  parts.push(`# Document Analysis\n`);
  if (result.category) {
    parts.push(
      `**Category:** ${result.category}${result.covers?.length ? ` | **Covers:** ${result.covers.join(', ')}` : ''}\n`,
    );
  }
  parts.push(formatAnalyzeResult(result));
  parts.push(`\n## Figures (${result.figures?.length ?? 0})\n`);
  if (result.figures?.length) {
    result.figures.forEach((f, i) => parts.push(formatFigureLine(f, i)));
  } else {
    parts.push('No figures extracted from this document.');
  }
  return parts.join('\n');
}

export function formatFigures(figures: ExtractedFigure[]): string {
  const parts: string[] = [];
  parts.push(`# Extracted Figures (${figures.length})\n`);
  if (!figures.length) {
    parts.push('No known metrics found in this document.');
    return parts.join('\n');
  }
  const modelReads = figures.filter((f) => f.provenance?.method === 'model').length;
  if (modelReads) {
    parts.push(
      `${modelReads} of ${figures.length} were read by a vision model — those are capped at needs_review, never verified.\n`,
    );
  }
  figures.forEach((f, i) => parts.push(formatFigureLine(f, i)));
  return parts.join('\n');
}

export function formatClassify(result: ClassifyResult): string {
  const parts: string[] = [];
  parts.push(`# Document Classification\n`);
  parts.push(`**Category:** ${result.category || '(uncategorised)'}`);
  parts.push(`**Covers:** ${result.covers?.length ? result.covers.join(', ') : '(none detected)'}`);
  return parts.join('\n');
}

export function formatGaps(category: string, result: GapsResponse): string {
  const items = result.items ?? [];
  const present = items.filter((i) => i.present).length;
  const parts: string[] = [];
  parts.push(`# Expected Documents: ${category}\n`);
  parts.push(`${present}/${items.length} present\n`);
  items.forEach((item) => {
    parts.push(`- ${item.present ? '✓' : '✗'} ${item.name}`);
  });
  parts.push(`\nAdvisory only — a missing item does not block anything.`);
  return parts.join('\n');
}

export function formatExtractedDoc(doc: ExtractedDoc): string {
  const parts: string[] = [];
  parts.push(`# Extracted Document\n`);
  parts.push(`**Format:** ${doc.format}`);
  parts.push(`**Units:** ${doc.units?.length ?? 0} page(s)/sheet(s)`);
  if (doc.sheets?.length) {
    parts.push(`**Sheets:** ${doc.sheets.map((s) => s.name).join(', ')}`);
  }
  parts.push(`\n---\n`);
  parts.push(truncate(doc.markdown ?? ''));
  return parts.join('\n');
}

export function formatAccuracyReport(report: AccuracyReport): string {
  const t = report.totals;
  const parts: string[] = [];
  parts.push(`# Numeric Accuracy Report\n`);
  parts.push(`**Gate:** ${report.pass ? '✓ passing' : '✗ failing'}`);
  if (!t) return parts.join('\n');
  parts.push(`**Corpus:** ${t.deals} deal(s), ${t.figures} figure(s)\n`);
  parts.push(`## Conflict detection`);
  parts.push(`- Expected: ${t.conflicts.expected}`);
  parts.push(`- Found: ${t.conflicts.found} | Flagged: ${t.conflicts.flagged}`);
  parts.push(`- False positives: ${t.conflicts.falsePositives}`);
  parts.push(`- Detection rate: ${t.conflicts.detectionRate}`);
  parts.push(`- Precision: ${t.conflicts.precision}`);
  parts.push(`\n## Recompute`);
  parts.push(`- Checked: ${t.recompute.checked} | Correct: ${t.recompute.correct}`);
  return parts.join('\n');
}

/* ---------------------------------------------------------- context graph (v2) */

export function formatResolvedAnswer(result: ResolvedAnswerResponse): string {
  const { answer, evidence } = result;
  const parts: string[] = [];
  parts.push(`# Answer Revision\n`);
  parts.push(`**Revision:** ${answer.revisionId}`);
  parts.push(`**Content hash:** ${answer.contentHash}`);
  parts.push(`**Input packet:** ${answer.inputPacketId} (${answer.inputPacketContentHash})`);
  parts.push(`**Output packet:** ${answer.outputPacketId}`);
  if (answer.text) {
    parts.push(`\n## Text\n`);
    parts.push(truncate(answer.text));
  }
  const refs = result.presentation?.numbered_refs;
  if (refs?.length) {
    parts.push(`\n## Presentation refs\n`);
    refs.forEach((item) => {
      parts.push(
        `${item.n}. ${item.ref.sourceVersionId} / ${item.ref.sourceUnitId} / ${item.ref.anchorId}`,
      );
    });
  }
  if (evidence.packet.gaps?.length) {
    parts.push(`\n## Gaps\n`);
    evidence.packet.gaps.forEach((g) => parts.push(`- ${g}`));
  }
  if (result.freshness) {
    parts.push(`\n## Freshness\n`);
    parts.push(`**Coverage:** ${result.freshness.coverage}`);
    if (result.freshness.observation) parts.push(`**Observation:** ${result.freshness.observation}`);
    (result.freshness.reasons ?? []).forEach((r) => parts.push(`- ${r}`));
  }
  return parts.join('\n');
}

export function formatResolvedPacket(result: ResolvedPacketResponse): string {
  const { packet } = result;
  const parts: string[] = [];
  parts.push(`# Evidence Packet\n`);
  parts.push(`**Packet ID:** ${packet.id}`);
  parts.push(`**Content hash:** ${packet.contentHash}`);
  if (packet.engineVersion) parts.push(`**Engine:** ${packet.engineVersion}`);
  if (packet.stopReason) parts.push(`**Stop reason:** ${packet.stopReason}`);
  const refs = result.presentation?.numbered_refs ?? [];
  parts.push(`\n## Presentation refs (${refs.length})\n`);
  if (refs.length) {
    refs.forEach((item) => {
      parts.push(
        `${item.n}. ${item.ref.sourceVersionId} / ${item.ref.sourceUnitId} / ${item.ref.anchorId}`,
      );
    });
  } else {
    parts.push('No presentation refs.');
  }
  if (packet.gaps?.length) {
    parts.push(`\n## Gaps\n`);
    packet.gaps.forEach((g) => parts.push(`- ${g}`));
  }
  return parts.join('\n');
}

export function formatContextQuery(result: ContextQueryResponse): string {
  const parts: string[] = [];
  parts.push(`# Context Query\n`);
  parts.push(`**Status:** ${result.status}`);
  parts.push(`**Operator:** ${result.operatorClass}`);
  if (result.refuseReason) parts.push(`**Refuse reason:** ${result.refuseReason}`);
  parts.push(`**Engine:** ${result.engine}`);

  if (result.status === 'refuse' || result.refs.length === 0) {
    parts.push(`\nNo matching refs under current authorization (successful no-match).`);
  } else {
    parts.push(`\n## Refs (${result.refs.length})\n`);
    result.refs.forEach((ref, i) => {
      parts.push(
        `${i + 1}. [${ref.kind}] ${ref.sourceVersionId} / ${ref.nodeId}: "${truncate(ref.snippet, 200)}"`,
      );
    });
  }

  if (result.gaps.length) {
    parts.push(`\n## Gaps\n`);
    result.gaps.forEach((g) => parts.push(`- ${g}`));
  }
  if (result.queryPlan.truncated) {
    parts.push(`\nQuery plan was truncated.`);
  }
  return parts.join('\n');
}

export function formatCompareAssertions(result: CompareAssertionsResponse): string {
  const parts: string[] = [];
  parts.push(`# Assertion Comparison\n`);
  parts.push(`**Result:** ${result.result}`);
  if (result.result === 'unknown') {
    parts.push(`Unknown is not a contradiction — at least one scope field is missing or unknown.`);
  }
  parts.push(`\n**Left:** ${JSON.stringify(result.left)}`);
  parts.push(`**Right:** ${JSON.stringify(result.right)}`);
  return parts.join('\n');
}

export function formatChangeImpact(result: ChangeImpactResponse): string {
  const f = result.freshness;
  const parts: string[] = [];
  parts.push(`# Change Impact\n`);
  parts.push(`**Answer revision:** ${result.answer_revision_id}`);
  parts.push(`**Coverage:** ${f.coverage}`);
  if (f.observation) parts.push(`**Observation:** ${f.observation}`);
  parts.push(`**Affected claims:** ${f.claimRevisionIds.length}`);
  f.claimRevisionIds.forEach((id) => parts.push(`- ${id}`));
  if (f.unresolvedSourceVersionIds.length) {
    parts.push(`\n**Unresolved sources:**`);
    f.unresolvedSourceVersionIds.forEach((id) => parts.push(`- ${id}`));
  }
  if (f.reasons.length) {
    parts.push(`\n**Reasons:**`);
    f.reasons.forEach((r) => parts.push(`- ${r}`));
  }
  return parts.join('\n');
}

export function formatCreatePacket(result: CreateEvidencePacketResponse): string {
  const parts: string[] = [];
  parts.push(`# Evidence Packet Created\n`);
  parts.push(`**Packet ID:** ${result.packet_id}`);
  if (result.content_hash) parts.push(`**Content hash:** ${result.content_hash}`);
  if (result.operation_id) parts.push(`**Operation:** ${result.operation_id}`);
  if (result.gaps?.length) {
    parts.push(`\n## Gaps\n`);
    result.gaps.forEach((g) => parts.push(`- ${g}`));
  }
  return parts.join('\n');
}

export function formatAssessSupport(result: AssessSupportResponse): string {
  const parts: string[] = [];
  parts.push(`# Support Assessment\n`);
  parts.push(`**Assessment ID:** ${result.assessmentId}`);
  parts.push(`**Evidence group:** ${result.evidenceGroupRevisionId}`);
  const support =
    typeof result.judgment?.support === 'string'
      ? result.judgment.support
      : 'unknown';
  const binding =
    typeof result.judgment?.binding === 'string'
      ? result.judgment.binding
      : 'unknown';
  parts.push(`**Support:** ${support}`);
  parts.push(`**Binding:** ${binding}`);
  if (result.explanation) parts.push(`\n${result.explanation}`);
  return parts.join('\n');
}

export function formatAssessMeaning(result: AssessMeaningResponse): string {
  const parts: string[] = [];
  parts.push(`# Meaning Assessment\n`);
  parts.push(`**Meaning:** ${result.meaning}`);
  parts.push(`**Authority:** ${result.authority}`);
  parts.push(`**False-claim support:** ${result.falseClaimSupport}`);
  return parts.join('\n');
}

export function formatFindContradictions(result: FindContradictionsResponse): string {
  return `# Contradictions\n\n**Count:** ${result.count}\n**Pairs:** ${result.pairs.length}`;
}

export function formatFormalEligibility(result: FormalEligibilityResponse): string {
  return `# Formal Eligibility\n\n**Eligible:** ${result.eligible ? 'yes' : 'no'}\n**Scaling ok:** ${result.scaling_ok ? 'yes' : 'no'}`;
}

export function formatFormalCheck(result: FormalCheckResponse): string {
  const parts = [
    `# Formal Check\n`,
    `**Status:** ${result.status}`,
    `**Toolchain:** ${result.toolchainVersion}`,
    `**Checker digest:** ${result.checkerDigest}`,
    `**Policy revision:** ${result.checkerPolicyRevision}`,
  ];
  if (result.mode) parts.push(`**Mode:** ${result.mode}`);
  if (result.reason) parts.push(`**Reason:** ${result.reason}`);
  return parts.join('\n');
}

export function formatCreateClaimRelation(result: CreateClaimRelationResponse): string {
  return `# Claim Relation\n\n**Id:** ${result.relation.id}\n**Predicate:** ${result.relation.predicate}\n**Args:** ${result.relation.argumentIds.join(', ')}`;
}

export function formatListClaimRelations(result: ListClaimRelationsResponse): string {
  return `# Claim Relations\n\n**Count:** ${result.relations.length}\n**Recognised:** ${result.recognised.join(', ')}`;
}

export function formatCreateMetricDefinition(
  result: CreateMetricDefinitionResponse,
): string {
  return `# Metric Definition\n\n**Revision:** ${result.revisionId}\n**Hash:** ${result.contentHash}`;
}

export function formatListMetricDefinitions(
  result: ListMetricDefinitionsResponse,
): string {
  return `# Metric Definitions\n\n**Count:** ${result.definitions.length}`;
}

export function formatCreateResearchRun(result: CreateResearchRunResponse): string {
  const parts = [
    `# Research Run\n`,
    `**Id:** ${result.run.id}`,
    `**Revision:** ${result.run.checkpointRevision}`,
    `**Phase:** ${result.run.phase}`,
  ];
  if (typeof result.opened_root === 'boolean') {
    parts.push(`**Opened root:** ${result.opened_root ? 'yes' : 'no'}`);
  }
  return parts.join('\n');
}

export function formatGetResearchRun(result: GetResearchRunResponse): string {
  return formatCreateResearchRun(result);
}

export function formatCheckpointResearchRun(
  result: CheckpointResearchRunResponse,
): string {
  return `# Research Checkpoint\n\n**Id:** ${result.run.id}\n**Revision:** ${result.run.checkpointRevision}\n**Phase:** ${result.run.phase}`;
}

export function formatResolveSeeds(result: ResolveSeedsResponse): string {
  const parts = [
    `# Resolve Seeds\n`,
    `**Count:** ${result.candidates.length}`,
    `**Leading resolver:** ${result.leading_resolver ?? 'none'}`,
  ];
  if (result.index_source) parts.push(`**Index source:** ${result.index_source}`);
  if (typeof result.index_size === 'number') {
    parts.push(`**Index size:** ${result.index_size}`);
  }
  return parts.join('\n');
}

export function formatExpandSeeds(result: ExpandSeedsResponse): string {
  return `# Expand Seeds\n\n**Hops:** ${result.hops}\n**Seeds:** ${result.seeds.join(', ') || '(none)'}`;
}

export function formatLearningJudge(result: LearningJudgeResponse): string {
  return `# Learning Judge\n\n**Action:** ${result.action}`;
}

export function formatLearningApply(result: LearningApplyResponse): string {
  return `# Learning Apply\n\n**Status:** ${result.status}${result.reason ? `\n**Reason:** ${result.reason}` : ''}`;
}

export function formatLearningPlaceholder(
  result: LearningPlaceholderResponse,
): string {
  return `# Learning Placeholder\n\n**Authoritative:** ${result.authoritative ? 'yes' : 'no'}\n**Status:** ${String((result.checkpoint as { status?: string }).status ?? 'unknown')}`;
}

export function formatFormatCertify(result: FormatCertifyResponse): string {
  return `# Format Certify\n\n**Kind:** ${result.kind}\n**Ok:** ${result.ok ? 'yes' : 'no'}${result.reason ? `\n**Reason:** ${result.reason}` : ''}`;
}

export function formatReserveResearchBudget(
  result: ReserveResearchBudgetResponse,
): string {
  return `# Research Budget Reserve\n\n**Operation:** ${result.operationId}\n**Replay:** ${result.replay ? 'yes' : 'no'}`;
}

export function formatOpenOperationRoot(result: OpenOperationRootResponse): string {
  const id =
    typeof result.operation.id === 'string' ? result.operation.id : '(unknown)';
  const kind =
    typeof result.operation.kind === 'string' ? result.operation.kind : '(unknown)';
  return `# Open Operation Root\n\n**Id:** ${id}\n**Kind:** ${kind}`;
}

export function formatReserveOperation(result: ReserveOperationResponse): string {
  return `# Operation Reserve\n\n**Operation:** ${result.operation.id}\n**Replay:** ${result.replay ? 'yes' : 'no'}`;
}

export function formatGetOperation(result: GetOperationResponse): string {
  const id =
    typeof result.operation.id === 'string' ? result.operation.id : '(unknown)';
  const kind =
    typeof result.operation.kind === 'string' ? result.operation.kind : '(unknown)';
  return `# Operation\n\n**Id:** ${id}\n**Kind:** ${kind}`;
}

export function formatGetOperationAvailability(
  result: GetOperationAvailabilityResponse,
): string {
  const a = result.availability;
  return `# Operation Availability\n\n**Max credits:** ${a.maxCredits}\n**Settled:** ${a.settledCredits}\n**Outstanding credits:** ${a.outstandingCredits}\n**Outstanding tokens:** ${a.outstandingTokens}`;
}

export function formatSettleOperation(result: SettleOperationResponse): string {
  const id =
    typeof result.operation.id === 'string' ? result.operation.id : '(unknown)';
  const state =
    typeof result.operation.state === 'string' ? result.operation.state : '(unknown)';
  return `# Settle Operation\n\n**Id:** ${id}\n**State:** ${state}`;
}

export function formatReleaseOperation(result: ReleaseOperationResponse): string {
  const id =
    typeof result.operation.id === 'string' ? result.operation.id : '(unknown)';
  const state =
    typeof result.operation.state === 'string' ? result.operation.state : '(unknown)';
  return `# Release Operation\n\n**Id:** ${id}\n**State:** ${state}`;
}

export function formatRecordOperationAttempt(
  result: RecordOperationAttemptResponse,
): string {
  const id =
    typeof result.attempt.id === 'string' ? result.attempt.id : '(unknown)';
  const provider =
    typeof result.attempt.provider === 'string'
      ? result.attempt.provider
      : '(unknown)';
  return `# Record Operation Attempt\n\n**Id:** ${id}\n**Provider:** ${provider}`;
}

export function formatResolveOperationAttempt(
  result: ResolveOperationAttemptResponse,
): string {
  const id =
    typeof result.attempt.id === 'string' ? result.attempt.id : '(unknown)';
  const state =
    typeof result.attempt.state === 'string' ? result.attempt.state : '(unknown)';
  return `# Resolve Operation Attempt\n\n**Id:** ${id}\n**State:** ${state}`;
}

export function formatLinkOperationConsumer(
  result: LinkOperationConsumerResponse,
): string {
  const id =
    typeof result.consumer.id === 'string' ? result.consumer.id : '(unknown)';
  const kind =
    typeof result.consumer.consumerKind === 'string'
      ? result.consumer.consumerKind
      : '(unknown)';
  return `# Link Operation Consumer\n\n**Id:** ${id}\n**Kind:** ${kind}`;
}

export function formatGetConsumerUsage(result: GetConsumerUsageResponse): string {
  return `# Consumer Usage\n\n**Operations:** ${result.usage.operationIds.length}\n**Known credits:** ${result.usage.knownCredits ?? 'unknown'}\n**Completeness:** ${result.usage.completeness}`;
}

export function formatGetProviderCost(result: GetProviderCostResponse): string {
  return `# Provider Cost\n\n**Attempts:** ${result.cost.attemptIds.length}\n**Known cost:** ${result.cost.knownCost ?? 'unknown'}\n**Currency:** ${result.cost.currency ?? 'none'}\n**Completeness:** ${result.cost.completeness}\n**Unknown attempts:** ${result.cost.unknownAttemptIds.length}`;
}

export function formatProofsApplies(result: ProofsAppliesResponse): string {
  return `# Proofs Applies\n\n**Applies:** ${result.applies ? 'yes' : 'no'}`;
}

export function formatFormalResolutionState(
  result: FormalResolutionStateResponse,
): string {
  return `# Formal Resolution State\n\n**State:** ${result.state}`;
}

export function formatFormalRevenueBridge(
  result: FormalRevenueBridgeResponse,
): string {
  return `# Formal Revenue Bridge\n\n**Status:** ${result.status}${result.sum ? `\n**Sum:** ${result.sum}` : ''}${result.reason ? `\n**Reason:** ${result.reason}` : ''}`;
}

export function formatClaimStructureTier(result: ClaimStructureTierResponse): string {
  return `# Claim Structure Tier\n\n**Tier:** ${result.tier}`;
}

export function formatClaimStructureResolveDefinition(
  result: ClaimStructureResolveDefinitionResponse,
): string {
  return `# Claim Structure Resolve Definition\n\n**Kind:** ${result.kind}`;
}

export function formatFormalizeClaimRelation(
  result: FormalizeClaimRelationResponse,
): string {
  const parts = [
    `# Formalize Claim Relation\n`,
    `**Formalized:** ${result.formalized ? 'yes' : 'no'}`,
    `**Recognised:** ${result.recognised.join(', ') || '(none)'}`,
  ];
  if (result.relation) {
    parts.push(`**Predicate:** ${result.relation.predicate}`);
    parts.push(`**Args:** ${result.relation.argumentIds.join(', ')}`);
  }
  return parts.join('\n');
}

export function formatEvalCatalog(result: EvalCatalogResponse): string {
  const parts: string[] = [];
  parts.push(`# Evaluation Catalog\n`);
  parts.push(
    `**Private gold denied:** ${result.private_gold_denied ? 'yes' : 'no'}`,
  );
  parts.push(`**Suites:** ${result.suites.length}\n`);
  result.suites.forEach((suite, i) => {
    parts.push(
      `${i + 1}. **${suite.id}** — ${suite.caseCount} case(s); surfaces: ${suite.surfaceIds.join(', ') || '(none)'}`,
    );
  });
  return parts.join('\n');
}

export function formatCertifyPrivateUpload(
  result: CertifyPrivateUploadResponse,
): string {
  const lines = [
    `# Private Upload Certify`,
    ``,
    `**Ok:** ${result.ok ? 'yes' : 'no'}`,
  ];
  if (result.mode) lines.push(`**Mode:** ${result.mode}`);
  if (result.reason) lines.push(`**Reason:** ${result.reason}`);
  return lines.join('\n');
}

export function formatCertifyRetrieveFlag(
  result: CertifyRetrieveFlagResponse,
): string {
  return [
    `# Retrieve Flag Certify`,
    ``,
    `**Ok:** ${result.ok ? 'yes' : 'no'}`,
    `**Enabled:** ${result.enabled ? 'yes' : 'no'}`,
    `**Default off:** ${result.default_off ? 'yes' : 'no'}`,
  ].join('\n');
}
