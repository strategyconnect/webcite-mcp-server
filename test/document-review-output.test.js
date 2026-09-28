const test = require('node:test');
const assert = require('node:assert/strict');
const { formatExtractedDoc, formatFigures } = require('../dist/formatters.js');

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
