# SDK delivery

Use `scripts/merge-reviewed-pr.sh <PR number> <reviewed full head SHA>` for merges. Do not call `gh pr merge` directly. The wrapper verifies the live PR head, checks the guide against the explicit base/head contracts, posts `webcite-guide-current` success only after that check, and pins the merge to the reviewed commit. This is a repository delivery rule, not an unavoidable GitHub branch protection gate.
