#!/usr/bin/env bash

set -euo pipefail

BASE_SHA="${1:-}"
HEAD_SHA="${2:-}"

mark_all_changed() {
  gateway_changed=true
  migrations_changed=true
  openpath_api_changed=true
  spa_changed=true
  verifier_changed=true
}

gateway_changed=false
migrations_changed=false
openpath_api_changed=false
spa_changed=false
verifier_changed=false

if [ -z "$BASE_SHA" ] || [ "$BASE_SHA" = "0000000000000000000000000000000000000000" ] || [ -z "$HEAD_SHA" ]; then
  mark_all_changed
else
  changed_files="$(git diff --name-only "$BASE_SHA" "$HEAD_SHA" || true)"
  if [ -z "$changed_files" ]; then
    changed_files="$(git show --pretty='' --name-only "$HEAD_SHA")"
  fi

  openpath_changed_files=""
  if printf '%s\n' "$changed_files" | grep -qx 'upstream/openpath'; then
    openpath_base_sha="$(git rev-parse "$BASE_SHA:upstream/openpath" 2>/dev/null || true)"
    openpath_head_sha="$(git rev-parse "$HEAD_SHA:upstream/openpath" 2>/dev/null || true)"
    if [ -n "$openpath_base_sha" ] && [ -n "$openpath_head_sha" ] && [ -d upstream/openpath/.git ]; then
      openpath_changed_files="$(git -C upstream/openpath diff --name-only "$openpath_base_sha" "$openpath_head_sha" || true)"
    fi
  fi

  echo "Changed files:"
  if [ -n "$changed_files" ]; then
    echo "$changed_files"
  else
    echo "(none)"
  fi

  changed_files_file="$(mktemp)"
  openpath_changed_files_file="$(mktemp)"
  trap 'rm -f "$changed_files_file" "$openpath_changed_files_file"' EXIT
  printf '%s\n' "$changed_files" > "$changed_files_file"
  printf '%s\n' "$openpath_changed_files" > "$openpath_changed_files_file"

  eval "$(
    node scripts/lib/release-candidate-components.mjs classify \
      --changed-file-list "$changed_files_file" \
      --openpath-changed-file-list "$openpath_changed_files_file"
  )"
fi

echo "gateway_changed=$gateway_changed" >> "$GITHUB_OUTPUT"
echo "migrations_changed=$migrations_changed" >> "$GITHUB_OUTPUT"
echo "openpath_api_changed=$openpath_api_changed" >> "$GITHUB_OUTPUT"
echo "spa_changed=$spa_changed" >> "$GITHUB_OUTPUT"
echo "verifier_changed=$verifier_changed" >> "$GITHUB_OUTPUT"
