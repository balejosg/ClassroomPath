#!/usr/bin/env bash

set -euo pipefail

BRANCH_NAME="${1:-}"
BASE_BRANCH="${2:-main}"

if [ -z "$BRANCH_NAME" ]; then
  echo "Usage: $0 <branch-name> [base-branch]" >&2
  exit 1
fi

ROOT_DIR="$(git rev-parse --show-toplevel)"
WORKTREES_DIR="$ROOT_DIR/.worktrees"

# Allow branch names like feature/foo but keep a stable on-disk path.
SANITIZED_BRANCH_NAME="${BRANCH_NAME//\//-}"
WORKTREE_PATH="$WORKTREES_DIR/$SANITIZED_BRANCH_NAME"

mkdir -p "$WORKTREES_DIR"

if ! git check-ignore -q "$WORKTREES_DIR"; then
  echo "ERROR: $WORKTREES_DIR is not gitignored." >&2
  echo "Add '.worktrees/' to .gitignore and retry." >&2
  exit 1
fi

git fetch origin "$BASE_BRANCH" >/dev/null 2>&1 || true

echo "Creating worktree: $WORKTREE_PATH"
git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" "$BASE_BRANCH"

cd "$WORKTREE_PATH"

echo "Initializing submodules..."
git submodule update --init --recursive

echo "Installing dependencies (ClassroomPath + OpenPath)..."
npm run install:all

echo ""
echo "Worktree ready: $WORKTREE_PATH"
