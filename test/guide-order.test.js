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

test('engine18 guidance preserves retained17 and scopes forward execution', () => {
  const guide = renderWebciteGuide({ workflow: 'numeric' });
  const note = guide.split('\n').find(line => line.includes('implementing selected-source-automatic/18'));
  assert.ok(note);
  assert.match(note, /read-only requests may reuse an intact engine17 result without rewriting its payload or usage/);
  assert.match(note, /exact engine17 manifest pin remains authoritative even when engine18 exists/);
  assert.match(note, /hosts should read retained results first and execute only missing or specifically affected work/);
  assert.match(note, /does not assert a production rollout/);
});

test('engine19 guidance preserves source uncertainty and historical results', () => {
  const guide = renderWebciteGuide({ workflow: 'numeric' });
  const note = guide.split('\n').find(line => line.includes('implementing selected-source-automatic/19'));
  assert.ok(note);
  assert.match(note, /including when a model proposes a label/);
  assert.match(note, /Unsupported readings remain retained observations or unavailable values/);
  assert.match(note, /New execution uses engine19/);
  assert.match(note, /reuse intact engine18 and engine17 results without rewriting payloads or usage/);
  assert.match(note, /exact historical manifest pins remain authoritative/);
  assert.match(note, /prefer engine19, then engine18, then engine17/);
  assert.match(note, /changed candidate input requires its own cache identity/);
  assert.match(note, /Clients must admit engine19 before deployment/);
  assert.match(note, /development rollout only/);
});


test('folder guide separates hinted core and ordinary budgets without promising complete coverage', () => {
  const guide = renderWebciteGuide({ workflow: 'folders' });
  assert.match(guide, /hinted units and their mandatory core context have a separate 32,000-character allowance/);
  assert.match(guide, /ordinary retrieval has an incremental 32,000-character allowance after that core/);
  assert.match(guide, /at most 64,000 retained-text characters in total/);
  assert.match(guide, /Without evidence references, retained text remains bounded by 32,000 characters/);
  assert.match(guide, /16 anchors per retained navigation query, or 16 anchors when no navigation queries are present/);
  assert.match(guide, /physical-unit budget remains bounded by 48 plus three times the reference count/);
  assert.match(guide, /each passage contributes at most 2,000 UTF-16 characters/);
  assert.match(guide, /do not guarantee exhaustive source or topic coverage/);
  assert.match(guide, /100 MiB \(104,857,600 bytes\) aggregate stored-inventory allowance/);
  assert.doesNotMatch(guide, /The retained-text budget is 32,000 characters and the physical-unit budget/);
  assert.doesNotMatch(guide, /ordinary retrieval, which retains its separate 16-anchor limit/);
});
