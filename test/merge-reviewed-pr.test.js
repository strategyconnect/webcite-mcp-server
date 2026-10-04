const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Runs the real wrapper with stub gh, git and npm; only the review gate decides
// whether the success status is posted and the head-pinned merge is reached.
const SCRIPT = path.join(__dirname, '..', 'scripts', 'merge-reviewed-pr.sh');
const REPO = 'strategyconnect/webcite-mcp-server';
const SHA = 'c'.repeat(40);
const realGate = path.join(os.homedir(), '.agents/bin/review-gate');

function run({ gate, ledger, env = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-merge-wrapper-'));
  const log = path.join(dir, 'calls');
  fs.writeFileSync(path.join(dir, 'gh'), `#!/bin/sh
case "$1 $2" in
  "pr view") echo "${'b'.repeat(40)} ${SHA} OPEN false" ;;
  "repo view") echo "${REPO}" ;;
  *) printf '%s\\n' "$*" >> "${log}" ;;
esac
`, { mode: 0o700 });
  for (const name of ['git', 'npm']) fs.writeFileSync(path.join(dir, name), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const ledgerDir = path.join(dir, 'ledger');
  fs.mkdirSync(ledgerDir);
  if (ledger) fs.writeFileSync(path.join(ledgerDir, REPO.replace('/', '__') + '.jsonl'), ledger.map(r => JSON.stringify(r)).join('\n') + '\n');
  const childEnv = { ...process.env, PATH: `${dir}:${process.env.PATH}`, REVIEW_LEDGER_DIR: ledgerDir, REVIEW_GATE: gate, ...env };
  if (!('REVIEW_GATE_BYPASS' in env)) delete childEnv.REVIEW_GATE_BYPASS;
  const result = spawnSync('/bin/bash', [SCRIPT, '42', SHA], { encoding: 'utf8', env: childEnv });
  return { result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

const verdict = (v, extra = {}) => ({ record: 'verdict', repo: REPO, pr: 42, head: SHA, verdict: v, tier: 'T0', p0_open: 0, p1_open: 0, reviewer: 'test', ...extra });

test('no verdict for the head refuses before the status post and merge', { skip: !fs.existsSync(realGate) }, () => {
  const { result, calls } = run({ gate: realGate, ledger: [verdict('APPROVE', { head: 'd'.repeat(40) })] });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /no review verdict/);
  assert.equal(calls, '');
});

test('changes requested on the exact head refuses', { skip: !fs.existsSync(realGate) }, () => {
  const { result, calls } = run({ gate: realGate, ledger: [verdict('CHANGES_REQUESTED', { p1_open: 1 })] });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(calls, '');
});

test('an APPROVE verdict posts the guide status and merges the pinned head', { skip: !fs.existsSync(realGate) }, () => {
  const { result, calls } = run({ gate: realGate, ledger: [verdict('APPROVE')] });
  assert.equal(result.status, 0, result.stderr);
  assert.match(calls, /^api --silent --method POST repos\/\{owner\}\/\{repo\}\/statuses\//m);
  assert.match(calls, new RegExp(`^pr merge 42 --merge --match-head-commit ${SHA}$`, 'm'));
});

test('a missing review gate fails closed unless a bypass reason is given', () => {
  const missing = path.join(os.tmpdir(), 'no-such-review-gate');
  const refused = run({ gate: missing });
  assert.equal(refused.result.status, 1);
  assert.match(refused.result.stderr, /review-gate missing/);
  assert.equal(refused.calls, '');
  const bypassed = run({ gate: missing, env: { REVIEW_GATE_BYPASS: 'gate host unavailable' } });
  assert.equal(bypassed.result.status, 0, bypassed.result.stderr);
  assert.match(bypassed.calls, /pr merge 42/);
});
