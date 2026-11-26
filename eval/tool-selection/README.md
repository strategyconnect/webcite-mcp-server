# Tool-selection eval

The instrument for any change to tool names, descriptions, profiles or the server instructions. Run it before and after the change and compare.

## Files

- `cases.json`: 48 realistic user requests. 40 map to the first Webcite tool a well-routed agent should call (`expected`, plus `acceptable` alternatives), across six jobs: parse, verify, quotes, review, figures and search. 8 negatives should call no Webcite tool.
- `catalogue.public.json`, `catalogue.core.json`: the `tools/list` catalogue and server instructions of the default (`public`) and `core` profiles, as built.
- `baseline.json`: the recorded result for the committed catalogue.
- `run.cjs`: the runner and scorer.

## Run

```bash
npm run build
node eval/tool-selection/run.cjs                  # score the current build
node eval/tool-selection/run.cjs --snapshot       # score the committed snapshots
node eval/tool-selection/run.cjs --json out.json  # write every row
node eval/tool-selection/run.cjs --write-snapshot # after a deliberate catalogue change
```

`npm test` fails when the snapshots differ from the build or the scorer no longer reproduces `baseline.json`, so a catalogue change regenerates both on purpose:

```bash
node eval/tool-selection/run.cjs --write-snapshot
node eval/tool-selection/run.cjs --snapshot --json eval/tool-selection/baseline.json
```

## What is scored

**Offline, deterministic (default).** BM25 over each tool's name, title, description and argument names and descriptions, the fields Claude's tool search matches. Reported per profile: top-1 accuracy (the highest-ranked tool is expected or acceptable) and top-5 recall (one of the first five is), overall and per job, and how many expected tools the profile serves. It needs no network, key or model, and the same catalogue always gives the same numbers. It is a proxy for how findable each tool is by its words, not a measurement of a model's choice; negatives are listed but not scored in this mode.

**Model mode (off by default).** `--picker-cmd "<command>"` sends one prompt per case on stdin (server instructions, each tool's name and first sentence, the request) and reads the tool name or `NONE` the command prints. Use it with an agent subscription you already have, for example a CLI that reads a prompt from stdin. It is never run unless the flag is given, and nothing in the repository runs it. Negatives are scored in this mode (correct when the reply is `NONE`). Each run makes one call per case and per profile (96 calls), billed to whatever the command uses.

**Server instructions.** Checked against the criteria in the AEO research: the first sentence says what Webcite does; each of the six jobs names its tool in the opening paragraph and within the first 600 characters; `webcite_guide` is named; every tool named in the opening is served by the default and `core` profiles; the reporting caveats come after the job list; the job list fits Claude Code's former 2,048-character limit; the whole text fits the current 4,096-character limit.

## Baseline (1.9.69, offline)

| Profile | Tools | Expected tool served | Top-1 | Top-5 |
| --- | --- | --- | --- | --- |
| public (default) | 34 | 40 of 40 | 85.0% | 100.0% |
| core | 16 | 33 of 40 | 85.0% | 95.0% |

1.9.68 scored 82.5% top-1 and 100.0% top-5 on `public`, and 85.0% and 95.0% on `core`. 1.9.69 adds the ID chain, units and error results to the descriptions of the source and review tools; no case scores worse than in 1.9.68. 1.9.67 scored 70.0% and 90.0% on `public`, and 57.5% and 90.0% on `core`.

Server instructions: 8 of 9 criteria pass. The whole text is 4,086 characters, inside the 4,096-character limit. The opening paragraph is 712 characters, so `analyze_conflicts`, `search_sources` and `webcite_guide` still fall after character 600.
