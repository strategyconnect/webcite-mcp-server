#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pr=${1:?PR number required}
reviewed=${2:?Reviewed full head SHA required}
[[ "$pr" =~ ^[0-9]+$ && "$reviewed" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected PR number and reviewed full SHA' >&2; exit 1; }
read -r base head state draft < <(gh pr view "$pr" --json baseRefOid,headRefOid,state,isDraft --jq '[.baseRefOid,.headRefOid,.state,(.isDraft|tostring)]|join(" ")')
[[ "$head" == "$reviewed" && "$state" == OPEN && "$draft" == false ]] || { echo 'PR is not the reviewed open ready head' >&2; exit 1; }
# An APPROVE verdict for this exact head must be in the shared review ledger.
review_gate=${REVIEW_GATE:-$HOME/.agents/bin/review-gate}
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
if [[ -x "$review_gate" ]]; then
  "$review_gate" "$repo" "$pr" "$reviewed"
elif [[ -n "${REVIEW_GATE_BYPASS:-}" ]]; then
  echo "review-gate missing at $review_gate; bypassed: $REVIEW_GATE_BYPASS" >&2
else
  echo "review-gate missing at $review_gate; refusing to merge without a review verdict check" >&2
  exit 1
fi
git fetch origin "$base" "$head"
npm run check:guide -- --base "$base" --head "$head"
gh api --silent --method POST "repos/{owner}/{repo}/statuses/$head" \
  -f state=success -f context=webcite-guide-current -f description="Guide checked against base ${base:0:12}"
gh pr merge "$pr" --merge --match-head-commit "$reviewed"
