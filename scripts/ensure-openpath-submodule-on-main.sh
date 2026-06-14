#!/usr/bin/env bash
# ensure-openpath-submodule-on-main.sh
#
# Intent: Allow the release-orchestration verify-clean-repos step to succeed when
# the upstream/openpath submodule is in detached HEAD state but already points at
# the same commit as origin/main.
#
# Background: git submodule update leaves the submodule in detached HEAD. The
# verify-clean-repos step asserts that upstream/openpath is on the local branch
# "main". This script bridges the gap by repointing the local "main" branch ref to
# the current HEAD SHA and checking it out, but ONLY when:
#   1. The submodule working tree and index are clean (no local modifications).
#   2. HEAD already equals origin/main (i.e. the gitlink commit is correct).
#
# If either condition fails, the script exits 0 without touching anything, letting
# the existing verify-clean-repos asserts report the correct error.
#
# Idempotent: running twice in succession is a no-op the second time because the
# second run finds the branch already checked out (symbolic-ref HEAD == main) and
# HEAD already equals origin/main.
#
# Invoked by: scripts/lib/release-orchestration.mjs (verify-clean-repos step).
# Usage: bash scripts/ensure-openpath-submodule-on-main.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

SUBMODULE="upstream/openpath"
LABEL="ensure-openpath-submodule-on-main"

# Fetch so origin/main is up to date.
git -C "$SUBMODULE" fetch origin main --quiet

head="$(git -C "$SUBMODULE" rev-parse HEAD)"
origin="$(git -C "$SUBMODULE" rev-parse origin/main)"

# Determine whether the submodule is already on the main branch.
current_branch="$(git -C "$SUBMODULE" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [ "$current_branch" = "main" ]; then
  echo "$LABEL: already on branch main — nothing to do"
  exit 0
fi

# Only proceed if HEAD matches origin/main (gitlink is correct).
if [ "$head" != "$origin" ]; then
  echo "$LABEL: HEAD ($head) != origin/main ($origin) — leaving as-is for verify-clean-repos to report"
  exit 0
fi

# Only proceed if working tree and index are clean.
if ! git -C "$SUBMODULE" diff --quiet || ! git -C "$SUBMODULE" diff --cached --quiet; then
  echo "$LABEL: submodule has local modifications — leaving as-is for verify-clean-repos to report"
  exit 0
fi

# Safe to repoint local main and check it out.
git -C "$SUBMODULE" branch -f main "$origin"
git -C "$SUBMODULE" checkout main --quiet
echo "$LABEL: repointed local main to gitlink SHA and checked it out"
