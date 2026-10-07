#!/usr/bin/env bash
# Locks down the default branch with a repository ruleset. Idempotent: updates the ruleset if it exists.
# Needs the gh CLI, logged in as a repo admin. Usage: scripts/protect-main.sh [owner/repo]
set -euo pipefail

REPO="${1:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"
NAME="main"
ACTIONS_APP_ID=15368 # GitHub Actions: only check runs from Actions satisfy the rule, not a status anyone can post

# Job names from .github/workflows/ci.yml. Rename a job there and this list must follow.
read -r -d '' RULESET <<JSON || true
{
  "name": "$NAME",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "Types, lint, tests, build", "integration_id": $ACTIONS_APP_ID },
          { "context": "Accessibility (axe, WCAG 2.2 AA)", "integration_id": $ACTIONS_APP_ID },
          { "context": "Sign-in flows (mocked Supabase, axe)", "integration_id": $ACTIONS_APP_ID }
        ]
      }
    }
  ]
}
JSON

ID="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$NAME\" and .target == \"branch\") | .id" | head -n1)"
if [[ -n "$ID" ]]; then
  echo "$RULESET" | gh api --method PUT "repos/$REPO/rulesets/$ID" --input - --jq '"Updated ruleset \(.name) (#\(.id)): \(.enforcement)"'
else
  echo "$RULESET" | gh api --method POST "repos/$REPO/rulesets" --input - --jq '"Created ruleset \(.name) (#\(.id)): \(.enforcement)"'
fi
