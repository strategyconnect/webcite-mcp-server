const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { filterToolsByProfile } = require('../dist/profiles.js');
const { ALL_TOOLS } = require('../dist/tools.js');
const evalRun = require('../eval/tool-selection/run.cjs');

const DIR = join(__dirname, '..', 'eval', 'tool-selection');
const read = (f) => JSON.parse(readFileSync(join(DIR, f), 'utf8'));

test('committed catalogue snapshots match the build, so a catalogue change regenerates them deliberately', () => {
  for (const profile of ['public', 'core']) {
    assert.deepEqual(read(`catalogue.${profile}.json`), JSON.parse(JSON.stringify(evalRun.buildCatalogue(profile))), profile);
  }
});

test('every expected and acceptable tool in the cases is a public tool', () => {
  const names = new Set(filterToolsByProfile(ALL_TOOLS, 'public').map((t) => t.name));
  for (const c of evalRun.CASES) {
    for (const n of [...c.expected, ...c.acceptable]) assert.ok(names.has(n), `${c.id}: ${n}`);
  }
  assert.ok(evalRun.CASES.filter((c) => c.expected.length > 0).length >= 40);
  assert.ok(evalRun.CASES.some((c) => c.expected.length === 0));
});

test('the offline scorer is deterministic and reproduces the recorded baseline', () => {
  const baseline = read('baseline.json');
  for (const profile of ['public', 'core']) {
    const cat = read(`catalogue.${profile}.json`);
    const a = evalRun.scoreProfile(cat);
    assert.deepEqual(evalRun.scoreProfile(cat), a);
    assert.deepEqual(a.summary, baseline.profiles[profile].summary, profile);
  }
  assert.deepEqual(evalRun.scoreInstructions(read('catalogue.public.json'), read('catalogue.core.json')), baseline.instructions);
});

test('model mode reads the tool a picker command prints, and NONE as no tool (stub command, no model)', () => {
  const cat = read('catalogue.public.json');
  const pick = (reply) => evalRun.scoreProfile({ ...cat }, `cat >/dev/null; echo '${reply}'`).rows;
  const verify = pick('I would call verify_claim first.');
  assert.equal(verify.find((r) => r.id === 'verify-01').model_correct, true);
  assert.equal(verify.find((r) => r.id === 'none-01').model_correct, false);
  const none = pick('NONE');
  assert.equal(none.find((r) => r.id === 'none-01').model_correct, true);
  assert.match(evalRun.modelPrompt(cat, 'x'), /Reply with only the name of the first tool/);
});
