export function citationReaderCoverage(citations: unknown, offset = 0) {
  if (!Array.isArray(citations)) return [];
  return citations.map((citation: unknown, index: number) => {
    const evidence = citation && typeof citation === 'object'
      ? (citation as Record<string, unknown>).evidence : undefined;
    const item = evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? evidence as Record<string, unknown> : {};
    const entries = Array.isArray(item.readerLimitations) ? item.readerLimitations : [];
    const details = entries.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()));
    const shown = details.length > 3 ? [...details.slice(0, 2), details[details.length - 1]] : details;
    return {
      citation_index: offset + index + 1,
      coverage: item.readerCoverage === 'partial' ? 'partial' as const : 'unknown' as const,
      ...(shown.length ? { limitations: shown.map(detail => detail.slice(0, 120)) } : {}),
      ...(entries.length > shown.length ? { omitted_limitation_count: entries.length - shown.length } : {}),
      ...(shown.some(detail => detail.length > 120) ? { limitations_truncated: true } : {}),
    };
  });
}

export function formatPublisherReaderCoverage(rows: ReturnType<typeof citationReaderCoverage>): string {
  const partial = rows.filter(row => row.coverage === 'partial').length;
  const unknown = rows.length - partial;
  const heading = `Publisher reader coverage: ${partial ? 'partial' : 'unknown'}; ${partial} partial, ${unknown} unknown citations${rows.length ? '' : ' (no citation reader metadata)'}.`;
  const details = rows.flatMap(row => (row.limitations ?? []).map(detail => `citation ${row.citation_index}: ${detail}`));
  const omitted = rows.reduce((count, row) => count + (row.omitted_limitation_count ?? 0), 0) + Math.max(0, details.length - 3);
  return `${heading}${details.length ? ` Known limitations: ${details.slice(0, 3).join('; ')}.` : ''}${omitted ? ` ${omitted} additional limitation entries not displayed.` : ''}${rows.some(row => row.limitations_truncated) ? ' Limitation text shortened.' : ''} Excerpt evidence does not establish complete publisher coverage.`;
}
