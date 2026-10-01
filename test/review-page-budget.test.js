const test = require('node:test');
const assert = require('node:assert/strict');
const { handlers } = require('../dist/handlers.js');

for (const count of [16, 57, 100]) {
  for (const sources of [1, 4, 12]) {
    test(`bounded review traversal retains ${count} claims with ${sources} citations each`, async () => {
      const claims = Array.from({ length: count }, (_, i) => ({
        id: `claim-${i}`, claim: `Claim ${i} requires an independently checked factual assertion.`,
        result: 'unverified', citation_id: `citation-${i}`,
        citations: Array.from({ length: sources }, (_, j) => ({
          url: `https://example.org/source/${i}/${j}`, snippet: 'retained evidence '.repeat(200),
        })),
      }));
      const client = { getDocumentReview: async (id, offset, limit) => ({
        review_id: id, status: 'complete', prompt: 'Review all claims', thread_id: 'stable', asset_ids: ['asset'],
        total_claims: count, completed_claims: count, pending_claims: 0,
        claims: claims.slice(offset, offset + limit),
        next_offset: offset + limit < count ? offset + limit : null,
      }) };
      let offset = 0, calls = 0; const seen = [];
      do {
        const output = await handlers.get_document_review({ review_id: 'review', offset, limit: 50 }, client);
        assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 20_000);
        const page = output.structuredContent;
        assert.ok(page.claims.length > 0);
        for (const row of page.claims) {
          const urls = row.citation_urls ?? row.citations.map(c => c.url);
          assert.deepEqual(urls, claims[seen.length].citations.map(c => c.url));
          seen.push(row.id);
        }
        assert.ok(page.next_offset == null || page.next_offset > offset);
        offset = page.next_offset; calls++;
      } while (offset != null);
      assert.deepEqual(seen, claims.map(c => c.id));
      assert.ok(calls < Math.ceil(count / 3), `excessive ${calls} calls`);
    });
  }
}

test('unicode and oversized citation URLs never advance an unread claim', async () => {
  const page = { review_id: 'review', status: 'complete', prompt: 'Review', thread_id: 'stable', asset_ids: [],
    total_claims: 1, completed_claims: 1, pending_claims: 0,
    claims: [{ id: 'large', claim: 'A source contains a material factual assertion.', result: 'unverified',
      citations: [{ url: 'https://example.org/' + '界'.repeat(10_000), snippet: 'evidence' }] }] };
  const output = await handlers.get_document_review({ review_id: 'review' }, { getDocumentReview: async () => page });
  assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 20_000);
  assert.equal(output.structuredContent.next_offset, null);
  assert.equal(output.structuredContent.blocked_offset, 0);
  assert.equal(output.isError, true);
  assert.equal(output.structuredContent.full_evidence_saved, true);
  assert.match(output.text, /Webcite API for full citation objects/);
});

test('base64 rejects malformed canonical input before backend work', async () => {
  for (const file_base64 of ['YQ=', 'YQ===', 'Y Q==', 'YR==', '====', 'YQ==AAAA']) {
    let calls = 0;
    await assert.rejects(() => handlers.upload_file({ filename: 'note.txt', file_base64 },
      { uploadBytes: async () => { calls++; } }));
    assert.equal(calls, 0);
  }
});

test('the exact 20MB decoded upload boundary passes and one extra byte refuses before backend', async () => {
  let calls = 0;
  const client = { uploadBytes: async (bytes, filename) => {
    calls++; assert.equal(bytes.length, 20_000_000);
    return { asset_id: 'owned', filename, file_size: bytes.length };
  } };
  const encodedLength = 26_666_668;
  await handlers.upload_file({ filename: 'boundary.txt', file_base64: 'A'.repeat(encodedLength - 1) + '=' }, client);
  await assert.rejects(() => handlers.upload_file({ filename: 'boundary.txt', file_base64: 'A'.repeat(encodedLength) }, client));
  assert.equal(calls, 1);
});

test('compact pages independently consume every claim, gap, rejection and disposition', async () => {
  const claims = Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, claim: `Fact ${i} ${'界'.repeat(800)}`,
    result: 'unverified', citations: [{ url: `https://example.org/${i}`, snippet: 'x'.repeat(8000) }] }));
  const gaps = Array.from({ length: 7 }, (_, i) => ({ asset_id: 'asset', start: i, end: i + 1, preview: `gap${i}` }));
  const rejected = Array.from({ length: 8 }, (_, i) => ({ claim: `rejected${i}`, reason: 'not grounded' }));
  const dispositions = Array.from({ length: 9 }, (_, i) => ({ asset_id: 'asset', start: i * 8, end: i * 8 + 8,
    source_quote: `heading${i}`, origin: 'model_extraction', reason: 'heading' }));
  const lists = [claims, gaps, rejected, dispositions];
  const cursorNames = ['next_offset', 'next_gap_offset', 'next_rejected_offset', 'next_disposition_offset'];
  const rowNames = ['claims', 'uncovered_source_spans', 'rejected_claims', 'nonclaim_dispositions'];
  const seen = lists.map(() => []); let offsets = [0, 0, 0, 0];
  const client = { getDocumentReview: async (id, ...args) => {
    const result = { review_id: id, status: 'partial_coverage', prompt: 'Review', thread_id: 'stable', asset_ids: ['asset'],
      total_claims: 16, completed_claims: 16, pending_claims: 0, failed_claims: 0,
      uncovered_source_span_count: 7, rejected_claim_count: 8, nonclaim_disposition_count: 9 };
    lists.forEach((list, i) => {
      const offset = args[i * 2], limit = args[i * 2 + 1];
      result[rowNames[i]] = list.slice(offset, offset + limit);
      result[cursorNames[i]] = offset + limit < list.length ? offset + limit : null;
    }); return result;
  } };
  for (let calls = 0; calls < 20; calls++) {
    const output = await handlers.get_document_review({ review_id: 'review', offset: offsets[0], limit: 50,
      gap_offset: offsets[1], gap_limit: 20, rejected_offset: offsets[2], rejected_limit: 20,
      disposition_offset: offsets[3], disposition_limit: 20 }, client);
    assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 20_000);
    const page = output.structuredContent;
    lists.forEach((list, i) => {
      const rows = page[rowNames[i]];
      seen[i].push(...rows.map(row => row.id ?? row.preview ?? row.claim ?? row.source_quote));
      assert.ok(page[cursorNames[i]] == null || page[cursorNames[i]] > offsets[i]);
    });
    if (cursorNames.every(name => page[name] == null)) break;
    offsets = cursorNames.map((name, i) => page[name] ?? lists[i].length);
  }
  lists.forEach((list, i) => assert.deepEqual(seen[i], list.map(row => row.id ?? row.preview ?? row.claim ?? row.source_quote)));
});

test('large side lists narrow independently and retain settlement-pending labels', async () => {
  const page = { review_id: 'review', status: 'failed', prompt: 'Review', thread_id: 'stable', asset_ids: [],
    total_claims: 1, completed_claims: 0, pending_claims: 1, failed_claims: 0,
    extraction_complete: false, extraction_cursor: 3, chunk_count: 9, source_read_complete: true,
    claims: [{ id: 'saved', claim: 'An assertion awaits settlement.', result_state: 'result_saved', result: 'verified',
      citations: [{ url: 'https://example.org/source', snippet: 'x'.repeat(40_000) }] }],
    uncovered_source_span_count: 3, next_gap_offset: null,
    uncovered_source_spans: Array.from({ length: 3 }, (_, i) => ({ asset_id: 'asset', start: i, end: i + 1,
      preview: '界'.repeat(1100) })),
  };
  const output = await handlers.get_document_review({ review_id: 'review' }, { getDocumentReview: async () => page });
  assert.notEqual(output.isError, true);
  assert.ok(Buffer.byteLength(JSON.stringify(output)) <= 20_000);
  assert.equal(output.structuredContent.claims.length, 1);
  assert.ok(output.structuredContent.uncovered_source_spans.length >= 1 && output.structuredContent.uncovered_source_spans.length < 3);
  assert.equal(output.structuredContent.next_gap_offset, output.structuredContent.uncovered_source_spans.length);
  assert.match(output.text, /saved, settlement pending: verified/);
  assert.equal(output.structuredContent.extraction_complete, false);
  assert.equal(output.structuredContent.extraction_cursor, 3);
  assert.equal(output.structuredContent.source_read_complete, true);
});
