#!/usr/bin/env bash

set -euo pipefail

WORKTREE_NAME="${1:-}"

DEFAULT_BASE_REF="origin/main"
if ! git rev-parse --verify --quiet "$DEFAULT_BASE_REF" >/dev/null; then
  DEFAULT_BASE_REF="main"
fi

BASE_REF="${2:-$DEFAULT_BASE_REF}"

if [ -z "$WORKTREE_NAME" ]; then
  echo "Usage: $0 <worktree-name> [base-ref]" >&2
  echo "This script creates a detached worktree from main-compatible history." >&2
  exit 1
fi

ROOT_DIR="$(git rev-parse --show-toplevel)"
WORKTREES_DIR="$ROOT_DIR/.worktrees"

# Allow labels like clean/main but keep a stable on-disk path.
SANITIZED_WORKTREE_NAME="${WORKTREE_NAME//\//-}"
WORKTREE_PATH="$WORKTREES_DIR/$SANITIZED_WORKTREE_NAME"

mkdir -p "$WORKTREES_DIR"

if ! git check-ignore -q "$WORKTREES_DIR"; then
  echo "ERROR: $WORKTREES_DIR is not gitignored." >&2
  echo "Add '.worktrees/' to .gitignore and retry." >&2
  exit 1
fi

git fetch origin main >/dev/null 2>&1 || true

case "$BASE_REF" in
  main|origin/main)
    ;;
  *)
    echo "ERROR: Trunk-based policy only allows detached worktrees from 'main' or 'origin/main'." >&2
    exit 1
    ;;
esac

if ! git rev-parse --verify --quiet "$BASE_REF" >/dev/null; then
  echo "ERROR: Base ref '$BASE_REF' does not exist." >&2
  exit 1
fi

echo "Creating detached trunk worktree: $WORKTREE_PATH"
git worktree add --detach "$WORKTREE_PATH" "$BASE_REF"

cd "$WORKTREE_PATH"

echo "Initializing submodules..."
git submodule update --init --recursive

echo "Installing dependencies (ClassroomPath + OpenPath)..."
npm run install:all

echo ""
echo "Worktree ready: $WORKTREE_PATH"
