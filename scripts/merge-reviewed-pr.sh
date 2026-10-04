#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pr=${1:?PR number required}
reviewed=${2:?Reviewed full head SHA required}
[[ "$pr" =~ ^[0-9]+$ && "$reviewed" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected PR number and reviewed full SHA' >&2; exit 1; }
read -r base head state draft < <(gh pr view "$pr" --json baseRefOid,headRefOid,state,isDraft --jq '[.baseRefOid,.headRefOid,.state,(.isDraft|tostring)]|join(" ")')
[[ "$head" == "$reviewed" && "$state" == OPEN && "$draft" == false ]] || { echo 'PR is not the reviewed open ready head' >&2; exit 1; }
# An APPROVE verdict for this exact head must be in the shared review ledger. The gate is a
# guardrail for cooperating agents: every path around it needs a reason and is logged there.
default_gate=$HOME/.agents/bin/review-gate
review_gate=${REVIEW_GATE:-$default_gate}
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
log_gate_bypass() {
  local dir=${REVIEW_LEDGER_DIR:-$HOME/.agent-coordination/review-ledger}
  mkdir -p "$dir"
  python3 -c 'import json, sys, datetime
keys = ("repo", "pr", "head", "reason", "by", "cause")
record = {"ts": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "record": "gate-bypass"}
record.update(zip(keys, sys.argv[1:]))
record["pr"] = int(record["pr"])
print(json.dumps(record))' "$repo" "$pr" "$reviewed" "$REVIEW_GATE_BYPASS" "${USER:-unknown}" "$1" >> "$dir/${repo/\//__}.jsonl"
}
if [[ "$review_gate" != "$default_gate" ]]; then
  [[ -n "${REVIEW_GATE_BYPASS:-}" ]] || { echo "REVIEW_GATE override replaces the review gate; set REVIEW_GATE_BYPASS=<reason> to use it" >&2; exit 1; }
  echo "WARNING: REVIEW_GATE override $review_gate in place of $default_gate; bypass logged: $REVIEW_GATE_BYPASS" >&2
  log_gate_bypass gate-override
  if [[ -x "$review_gate" ]]; then "$review_gate" "$repo" "$pr" "$reviewed"; fi
elif [[ -x "$review_gate" ]]; then
  "$review_gate" "$repo" "$pr" "$reviewed"
elif [[ -n "${REVIEW_GATE_BYPASS:-}" ]]; then
  echo "review-gate missing at $review_gate; bypassed: $REVIEW_GATE_BYPASS (logged to the review ledger)" >&2
  log_gate_bypass gate-binary-missing
else
  echo "review-gate missing at $review_gate; refusing to merge without a review verdict check" >&2
  exit 1
fi
git fetch origin "$base" "$head"
npm run check:guide -- --base "$base" --head "$head"
gh api --silent --method POST "repos/{owner}/{repo}/statuses/$head" \
  -f state=success -f context=webcite-guide-current -f description="Guide checked against base ${base:0:12}"
gh pr merge "$pr" --merge --match-head-commit "$reviewed"
