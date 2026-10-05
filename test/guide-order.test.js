const test = require('node:test');
const assert = require('node:assert/strict');
const { renderWebciteGuide, resolveGuideWorkflow, WEBCITE_GUIDE_TOOL } = require('../dist/guide.js');

const NAMED = ['quick_verify', 'document_quote', 'document_review', 'source_trace', 'numeric'];
const words = (text) => text.split(/\s+/).filter(Boolean).length;
const BILLING_INTERNALS = [
  /Paid-plan renewal uses valid billing-period start and end dates/,
  /billed \$0\.04 for each settled credit/,
  /Dodo subscription price snapshots/,
  /per-minute request limit of the validated key/,
  /Internal agent checkpoints bind the owner and thread together/,
  /Account usage lists and totals no longer repeat the sub-prompt rows/,
  /token-usage projections serialize for the same authenticated owner/,
];

test('named workflows start with their steps and keep billing internals behind a pointer', () => {
  for (const workflow of NAMED) {
    const guide = renderWebciteGuide({ workflow });
    const lines = guide.split('\n');
    const heading = lines.indexOf(`## Workflow: ${workflow}`);
    const firstStep = lines.findIndex((line) => /^1\. /.test(line));
    assert.ok(heading > 0 && firstStep === heading + 1, `${workflow}: step 1 follows its heading`);
    assert.ok(words(lines.slice(0, firstStep).join(' ')) <= 150, `${workflow}: steps begin within 150 words`);
    assert.match(guide, /Free plan: \*\*100 credits\/month\*\*/);
    assert.ok(guide.indexOf('## Reference for this workflow') > firstStep, `${workflow}: reference follows steps`);
    assert.match(guide, /`\{ "workflow": "billing" \}`/);
    for (const internal of BILLING_INTERNALS) assert.doesNotMatch(guide, internal, `${workflow}: ${internal}`);
  }
});

test('billing workflow keeps every moved account and accounting sentence reachable', () => {
  const billing = renderWebciteGuide({ workflow: 'billing' });
  for (const internal of BILLING_INTERNALS) assert.match(billing, internal);
  assert.match(billing, /Email OTP login and resend-code requests return HTTP 503/);
  assert.match(billing, /A provider attempt is admitted only while its owned operation is reserved/);
  assert.match(billing, /WEBCITE_API_URL=https:\/\/api\.webcite\.co\/durable/);
  assert.match(billing, /Accounting preserves known saved conversion values/);
  assert.equal(resolveGuideWorkflow('billing'), 'billing');
  assert.ok(WEBCITE_GUIDE_TOOL.inputSchema.properties.workflow.enum.includes('billing'));
  assert.match(renderWebciteGuide({}), /`billing`/);
});

test('document review keeps its credit cost line directly after the numbered steps', () => {
  const guide = renderWebciteGuide({ workflow: 'document_review' });
  const credits = guide.indexOf('Credits: optional extraction costs 1; document review charges per claim.');
  assert.ok(credits > guide.indexOf('6. To apply the current evidence policy'));
  assert.ok(credits < guide.indexOf('### Extraction and evidence notes'));
  assert.match(guide, /never zero\. credit_usage describes this HTTP request; review_usage describes accumulated operation-ledger charges, not polling costs\. Balance and saved-review readback cost 0\./);
});
