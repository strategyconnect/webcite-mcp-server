/**
 * Human-readable formatting of WebCite API responses for MCP tool output.
 */

import type {
  AccuracyReport,
  AnalyzeResult,
  BatchResultItem,
  Citation,
  ClaimGroup,
  ClassifyResult,
  Conflict,
  DocumentAnalysisResponse,
  ExtractedDoc,
  ExtractedFigure,
  FigureProvenance,
  GapsResponse,
  Recomputation,
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
