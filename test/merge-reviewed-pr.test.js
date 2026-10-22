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

function run({ gate, ledger, env = {}, stubGate = false, home } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-merge-wrapper-'));
  const log = path.join(dir, 'calls');
  const argv = path.join(dir, 'gate-argv');
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
  const ledgerFile = path.join(ledgerDir, REPO.replace('/', '__') + '.jsonl');
  if (ledger) fs.writeFileSync(ledgerFile, ledger.map(r => JSON.stringify(r)).join('\n') + '\n');
  const childEnv = { ...process.env, PATH: `${dir}:${process.env.PATH}`, REVIEW_LEDGER_DIR: ledgerDir, ...env };
  delete childEnv.REVIEW_GATE;
  if (gate) childEnv.REVIEW_GATE = gate;
  if (!('REVIEW_GATE_BYPASS' in env)) delete childEnv.REVIEW_GATE_BYPASS;
  if (home) childEnv.HOME = home;
  if (stubGate) {
    // A self-contained gate at the default path: it records its argv and exits as told.
    const stubHome = path.join(dir, 'home');
    fs.mkdirSync(path.join(stubHome, '.agents/bin'), { recursive: true });
    fs.writeFileSync(path.join(stubHome, '.agents/bin/review-gate'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${argv}"\nexit "\${STUB_GATE_EXIT:-0}"\n`, { mode: 0o755 });
    childEnv.HOME = stubHome;
  }
  const result = spawnSync('/bin/bash', [SCRIPT, '42', SHA], { encoding: 'utf8', env: childEnv });
  const bypasses = fs.existsSync(ledgerFile)
    ? fs.readFileSync(ledgerFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.record === 'gate-bypass')
    : [];
  return { result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', argv: fs.existsSync(argv) ? fs.readFileSync(argv, 'utf8') : null, bypasses };
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

test('a missing review gate fails closed unless a bypass reason is given, and the bypass is logged', () => {
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-merge-home-'));
  const refused = run({ home: emptyHome });
  assert.equal(refused.result.status, 1);
  assert.match(refused.result.stderr, /review-gate missing/);
  assert.equal(refused.calls, '');
  const bypassed = run({ home: emptyHome, env: { REVIEW_GATE_BYPASS: 'gate host unavailable' } });
  assert.equal(bypassed.result.status, 0, bypassed.result.stderr);
  assert.match(bypassed.calls, /pr merge 42/);
  assert.equal(bypassed.bypasses.length, 1);
  assert.deepEqual(
    { cause: bypassed.bypasses[0].cause, repo: bypassed.bypasses[0].repo, pr: bypassed.bypasses[0].pr, head: bypassed.bypasses[0].head, reason: bypassed.bypasses[0].reason },
    { cause: 'gate-binary-missing', repo: REPO, pr: 42, head: SHA, reason: 'gate host unavailable' },
  );
});

test('the gate at the default path gets the exact repo, PR and full SHA, and its refusal stops the status and merge', () => {
  const refused = run({ stubGate: true, env: { STUB_GATE_EXIT: '1' } });
  assert.equal(refused.result.status, 1, refused.result.stderr);
  assert.equal(refused.argv, `${REPO}\n42\n${SHA}\n`);
  assert.equal(refused.calls, '');
  const passed = run({ stubGate: true, env: { STUB_GATE_EXIT: '0' } });
  assert.equal(passed.result.status, 0, passed.result.stderr);
  assert.match(passed.calls, /pr merge 42/);
  assert.deepEqual(passed.bypasses, []);
});

test('a REVIEW_GATE override without a bypass reason is refused before the status and merge', () => {
  const { result, calls, bypasses } = run({ gate: '/usr/bin/true' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /REVIEW_GATE override/);
  assert.equal(calls, '');
  assert.deepEqual(bypasses, []);
});

test('a REVIEW_GATE override with a bypass reason runs the override and logs a gate-override record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-merge-override-'));
  const override = path.join(dir, 'override-gate');
  fs.writeFileSync(override, '#!/bin/sh\nexit "${STUB_GATE_EXIT:-0}"\n', { mode: 0o755 });
  const refused = run({ gate: override, env: { STUB_GATE_EXIT: '1', REVIEW_GATE_BYPASS: 'testing an alternate gate' } });
  assert.equal(refused.result.status, 1, 'the override gate still decides');
  assert.equal(refused.calls, '');
  const passed = run({ gate: override, env: { STUB_GATE_EXIT: '0', REVIEW_GATE_BYPASS: 'testing an alternate gate' } });
  assert.equal(passed.result.status, 0, passed.result.stderr);
  assert.match(passed.result.stderr, /REVIEW_GATE override/);
  assert.equal(passed.bypasses.length, 1);
  assert.equal(passed.bypasses[0].cause, 'gate-override');
  assert.equal(passed.bypasses[0].head, SHA);
});
