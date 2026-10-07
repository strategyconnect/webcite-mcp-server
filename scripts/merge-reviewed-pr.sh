#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pr=${1:?PR number required}
reviewed=${2:?Reviewed full head SHA required}
dry_run=0
for arg in "${@:3}"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done
[[ "$pr" =~ ^[0-9]+$ && "$reviewed" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected PR number and reviewed full SHA' >&2; exit 1; }
read -r base head state draft < <(gh pr view "$pr" --json baseRefOid,headRefOid,state,isDraft --jq '[.baseRefOid,.headRefOid,.state,(.isDraft|tostring)]|join(" ")')
[[ "$head" == "$reviewed" && "$state" == OPEN && "$draft" == false ]] || { echo 'PR is not the reviewed open ready head' >&2; exit 1; }
git fetch origin "$base" "$head"
npm run check:guide -- --base "$base" --head "$head"
if (( dry_run )); then echo "dry-run: would merge PR #$pr --merge --match-head-commit $reviewed"; exit 0; fi
gh api --silent --method POST "repos/{owner}/{repo}/statuses/$head" \
  -f state=success -f context=webcite-guide-current -f description="Guide checked against base ${base:0:12}"
gh pr merge "$pr" --merge --match-head-commit "$reviewed"
