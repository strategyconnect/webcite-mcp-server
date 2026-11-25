#!/usr/bin/env node
/**
 * Offline tool-selection eval for the Webcite MCP catalogue.
 *
 *   node eval/tool-selection/run.cjs                 score the built catalogue (npm run build first)
 *   node eval/tool-selection/run.cjs --snapshot      score the committed snapshots instead
 *   node eval/tool-selection/run.cjs --write-snapshot  rewrite the snapshots from the build
 *   node eval/tool-selection/run.cjs --json out.json write the full result
 *   node eval/tool-selection/run.cjs --picker-cmd "<command>"  model mode (off by default)
 *
 * The default selector is deterministic: BM25 over each tool's name, title,
 * description and argument names and descriptions, the fields Claude's tool
 * search matches. It needs no network and no model. Model mode pipes one prompt
 * per case to a command you supply (for example your own agent CLI) and reads
 * the tool name it prints; it runs only when --picker-cmd is passed.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const DIR = __dirname;
const PROFILES = ['public', 'core'];
const CASES = JSON.parse(readFileSync(join(DIR, 'cases.json'), 'utf8')).cases;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1] ?? '';
}
const has = (name) => process.argv.includes(name);

function buildCatalogue(profile) {
  const { filterToolsByProfile, SERVER_INSTRUCTIONS } = require(join(DIR, '../../dist/profiles.js'));
  const { ALL_TOOLS } = require(join(DIR, '../../dist/tools.js'));
  const { SERVER_VERSION } = require(join(DIR, '../../dist/version.js'));
  return {
    profile,
    server_version: SERVER_VERSION,
    instructions: SERVER_INSTRUCTIONS,
    tools: filterToolsByProfile(ALL_TOOLS, profile).map((t) => ({
      name: t.name, title: t.title, description: t.description, annotations: t.annotations,
      ...(t._meta ? { _meta: t._meta } : {}), inputSchema: t.inputSchema,
    })),
  };
}

const snapshotPath = (profile) => join(DIR, `catalogue.${profile}.json`);
const loadCatalogue = (profile) =>
  has('--snapshot') ? JSON.parse(readFileSync(snapshotPath(profile), 'utf8')) : buildCatalogue(profile);

// ---- deterministic selector: BM25 over tool text ----
const tokenize = (s) => String(s).toLowerCase().replace(/_/g, ' ').match(/[a-z0-9]+/g) ?? [];

function toolText(tool) {
  const props = tool.inputSchema?.properties ?? {};
  const args = Object.entries(props).map(([k, v]) => `${k} ${v?.description ?? ''}`).join(' ');
  return `${tool.name} ${tool.name} ${tool.title ?? ''} ${tool.description} ${args}`;
}

function bm25Ranker(tools, k1 = 1.2, b = 0.75) {
  const docs = tools.map((t) => tokenize(toolText(t)));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length;
  const df = new Map();
  for (const d of docs) for (const w of new Set(d)) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = (w) => Math.log(1 + (docs.length - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
  return (query) => {
    const q = [...new Set(tokenize(query))];
    return tools
      .map((t, i) => {
        const tf = new Map();
        for (const w of docs[i]) tf.set(w, (tf.get(w) ?? 0) + 1);
        const score = q.reduce((s, w) => {
          const f = tf.get(w) ?? 0;
          return s + (f ? idf(w) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * docs[i].length) / avg))) : 0);
        }, 0);
        return { name: t.name, score: Math.round(score * 1000) / 1000 };
      })
      .sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  };
}

// ---- optional model selector (never runs unless --picker-cmd is given) ----
function modelPrompt(catalogue, request) {
  const list = catalogue.tools.map((t) => `- ${t.name}: ${t.description.split(/(?<=[.!?])\s/)[0]}`).join('\n');
  return `You are an AI agent connected to the Webcite MCP server.\n\nServer instructions:\n${catalogue.instructions}\n\nTools:\n${list}\n\nUser request: ${request}\n\nReply with only the name of the first tool you would call, or NONE if no tool is needed.`;
}

function modelPick(cmd, catalogue, request) {
  const out = execFileSync('/bin/sh', ['-c', cmd], { input: modelPrompt(catalogue, request), encoding: 'utf8', timeout: 300000 });
  const names = new Set(catalogue.tools.map((t) => t.name));
  const token = (out.match(/[A-Za-z_]+/g) ?? []).find((w) => names.has(w) || w === 'NONE');
  return token && token !== 'NONE' ? token : null;
}

// ---- scoring ----
const correct = (c, pick) => (c.expected.length === 0 ? pick === null : [...c.expected, ...c.acceptable].includes(pick));

function scoreProfile(catalogue, pickerCmd) {
  const rank = bm25Ranker(catalogue.tools);
  const names = new Set(catalogue.tools.map((t) => t.name));
  const rows = CASES.map((c) => {
    const ranked = rank(c.request);
    const lexicalTop = ranked[0].score > 0 ? ranked[0].name : null;
    const okSet = [...c.expected, ...c.acceptable];
    const row = {
      id: c.id, job: c.job, expected: c.expected,
      expected_in_profile: c.expected.length === 0 || c.expected.some((n) => names.has(n)),
      lexical_top1: lexicalTop,
      lexical_top1_correct: c.expected.length > 0 && okSet.includes(lexicalTop),
      lexical_top5_hit: c.expected.length > 0 && ranked.slice(0, 5).some((r) => okSet.includes(r.name)),
      lexical_top5: ranked.slice(0, 5),
    };
    if (pickerCmd) {
      row.model_pick = modelPick(pickerCmd, catalogue, c.request);
      row.model_correct = correct(c, row.model_pick);
    }
    return row;
  });
  const positives = rows.filter((r) => r.expected.length > 0);
  const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
  const byJob = {};
  for (const r of positives) {
    byJob[r.job] ??= { cases: 0, top1: 0, top5: 0 };
    byJob[r.job].cases += 1;
    byJob[r.job].top1 += r.lexical_top1_correct ? 1 : 0;
    byJob[r.job].top5 += r.lexical_top5_hit ? 1 : 0;
  }
  const summary = {
    profile: catalogue.profile, server_version: catalogue.server_version, tools: catalogue.tools.length,
    positive_cases: positives.length, negative_cases: rows.length - positives.length,
    expected_tool_in_profile: positives.filter((r) => r.expected_in_profile).length,
    lexical_top1_accuracy_pct: pct(positives.filter((r) => r.lexical_top1_correct).length, positives.length),
    lexical_top5_recall_pct: pct(positives.filter((r) => r.lexical_top5_hit).length, positives.length),
    by_job: byJob,
    ...(pickerCmd ? { model_accuracy_pct: pct(rows.filter((r) => r.model_correct).length, rows.length) } : {}),
  };
  return { summary, rows };
}

// ---- server instructions opening, against the criteria in the AEO research (C3) ----
const JOB_TOOLS = [
  ['parse', ['extract_document']], ['verify', ['verify_claim']], ['quotes', ['verify_batch']],
  ['review', ['review_document']], ['figures', ['extract_figures', 'analyze_conflicts']], ['search', ['search_sources']],
];

function scoreInstructions(publicCat, coreCat) {
  const text = publicCat.instructions;
  const first600 = text.slice(0, 600);
  const paragraph = text.split('\n\n')[0];
  const named = [...new Set(paragraph.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];
  const inPublic = new Set(publicCat.tools.map((t) => t.name));
  const inCore = new Set(coreCat.tools.map((t) => t.name));
  const caveatAt = text.indexOf('Compact fields omitted');
  const allJobs = (span) => JOB_TOOLS.every(([, tools]) => tools.every((t) => span.includes(t)));
  const checks = [
    ['Opens by saying what Webcite does (first sentence)', /^Webcite (reads|parses|verifies)/.test(text)],
    ['Each of the six jobs names its tool in the opening paragraph', allJobs(paragraph)],
    ['Each of the six jobs names its tool within the first 600 characters (the research target)', allJobs(first600)],
    ['Points to webcite_guide in the opening paragraph', paragraph.includes('webcite_guide')],
    ['Every tool named in the opening paragraph is served by the default profile', named.every((n) => inPublic.has(n))],
    ['Every tool named in the opening paragraph is served by the core profile', named.every((n) => inCore.has(n))],
    ['Reporting caveats come after the job list', caveatAt === -1 || caveatAt > paragraph.length],
    ['The job list fits inside the 2,048-character limit of Claude Code before v2.1.296', allJobs(text.slice(0, 2048))],
    ['Whole instructions fit inside the current 4,096-character limit (Claude Code truncates beyond it)', text.length <= 4096],
  ];
  return {
    length: text.length, opening_paragraph_chars: paragraph.length, tools_named_in_opening: named,
    checks: checks.map(([criterion, pass]) => ({ criterion, pass })),
    passed: checks.filter(([, p]) => p).length, total: checks.length,
  };
}

function main() {
  if (has('--write-snapshot')) {
    for (const p of PROFILES) writeFileSync(snapshotPath(p), `${JSON.stringify(buildCatalogue(p), null, 2)}\n`);
    console.log(`wrote ${PROFILES.map(snapshotPath).join(', ')}`);
    return;
  }
  const pickerCmd = arg('--picker-cmd');
  const cats = Object.fromEntries(PROFILES.map((p) => [p, loadCatalogue(p)]));
  const result = {
    source: has('--snapshot') ? 'snapshot' : 'build',
    selector: pickerCmd ? `bm25 + model via ${JSON.stringify(pickerCmd)}` : 'bm25 (deterministic, offline)',
    profiles: Object.fromEntries(PROFILES.map((p) => [p, scoreProfile(cats[p], pickerCmd)])),
    instructions: scoreInstructions(cats.public, cats.core),
  };
  const out = arg('--json');
  if (out) writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  for (const p of PROFILES) console.log(JSON.stringify(result.profiles[p].summary));
  console.log(JSON.stringify({ instructions: `${result.instructions.passed}/${result.instructions.total}`, failed: result.instructions.checks.filter((c) => !c.pass).map((c) => c.criterion) }));
  return result;
}

module.exports = { bm25Ranker, scoreProfile, scoreInstructions, modelPrompt, buildCatalogue, CASES };
if (require.main === module) main();
