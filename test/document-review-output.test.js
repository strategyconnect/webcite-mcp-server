const test = require('node:test');
const assert = require('node:assert/strict');
const { formatExtractedDoc, formatFigures, formatSourcePreview } = require('../dist/formatters.js');

test('a cited link at the end of a moderate slide stays visible', () => {
  const markdown = 'x'.repeat(8500) + ' https://example.org/cited-source';
  assert.match(formatExtractedDoc({ format: 'pptx', markdown, units: [] }), /https:\/\/example.org\/cited-source/);
  assert.match(formatSourcePreview({ kind: 'page', asset_id: 'asset', page: 1,
    text: markdown, deep_link: '', binding: { grounded: false, method: 'unbound' } }),
    /https:\/\/example.org\/cited-source/);
});

test('links beyond the text cap stay visible without claiming full coverage', () => {
  const markdown = 'x'.repeat(17_000) + '\nhttps://example.org/late-source) and https://example.org/late-source';
  const extracted = formatExtractedDoc({ format: 'pptx', markdown, units: [] });
  const preview = formatSourcePreview({ kind: 'page', asset_id: 'asset', page: 1,
    text: markdown, deep_link: '', binding: { grounded: false, method: 'unbound' } });
  for (const display of [extracted, preview]) {
    assert.match(display, /Links beyond the display limit \(1\/1\)/);
    assert.match(display, /https:\/\/example.org\/late-source/);
    assert.doesNotMatch(display, /https:\/\/example.org\/late-source\)/);
    assert.match(display, /display is incomplete|not a complete review/i);
  }
  assert.doesNotMatch(formatExtractedDoc({ format: 'txt', markdown: 'short', units: [] }), /Links beyond/);
  const web = formatSourcePreview({ kind: 'web', url: 'https://example.org/source', title: 'Source',
    text: markdown, deep_link: '', binding: { grounded: false, method: 'unbound' } });
  assert.match(web, /inspect the original URL/);
  assert.doesNotMatch(web, /extract_pages with the asset_id/);
});

test('an unreadable document stays visibly unreadable in Claude output', () => {
  const text = formatExtractedDoc({
    format: 'png',
    markdown: '',
    units: [],
    state: 'error',
    reason: 'ocr_unavailable',
  });
  assert.match(text, /Read status:\*\* error/);
  assert.match(text, /ocr_unavailable/);
  assert.match(text, /Do not treat this as a complete review/);
});

test('zero recognized figures does not become a no-numbers claim', () => {
  const text = formatFigures({ figures: [], state: 'complete' });
  assert.match(text, /No recognized metrics/);
  assert.match(text, /does not mean the document has no numbers/);
});

test('partial image figure coverage stays visible in Claude output', () => {
  const text = formatFigures({
    figures: [], state: 'complete',
    coverage: { status: 'partial', reason: 'OCR lost table columns' },
  });
  assert.match(text, /Numeric coverage:\*\* partial/);
  assert.match(text, /OCR lost table columns/);
});
