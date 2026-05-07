#!/usr/bin/env bash

set -euo pipefail

BASE_SHA="${1:-}"
HEAD_SHA="${2:-}"

mark_all_changed() {
  gateway_changed=true
  migrations_changed=true
  openpath_api_changed=true
  openpath_linux_agent_required=true
  spa_changed=true
  verifier_changed=true
}

gateway_changed=false
migrations_changed=false
openpath_api_changed=false
spa_changed=false
verifier_changed=false
openpath_linux_agent_required=false

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
    if
      [ -n "$openpath_base_sha" ] &&
        [ -n "$openpath_head_sha" ] &&
        git -C upstream/openpath rev-parse --is-inside-work-tree >/dev/null 2>&1
    then
      openpath_changed_files="$(git -C upstream/openpath diff --name-only "$openpath_base_sha" "$openpath_head_sha" || true)"
    fi

    if [ -z "$openpath_changed_files" ]; then
      echo 'Unable to derive OpenPath gitlink diff; rebuilding every release-candidate image family.' >&2
      openpath_changed_files='__unknown_openpath_gitlink_change__'
    fi
  fi

  echo "Changed files:"
  if [ -n "$changed_files" ]; then
    echo "$changed_files"
  else
    echo "(none)"
  fi

  cleanup_files=()
  cleanup() {
    if [ "${#cleanup_files[@]}" -gt 0 ]; then
      rm -f "${cleanup_files[@]}"
    fi
  }

  changed_files_file="$(mktemp)"
  openpath_changed_files_file="$(mktemp)"
  cleanup_files+=("$changed_files_file" "$openpath_changed_files_file")
  trap cleanup EXIT
  printf '%s\n' "$changed_files" > "$changed_files_file"
  printf '%s\n' "$openpath_changed_files" > "$openpath_changed_files_file"

  package_json_args=()
  if printf '%s\n' "$changed_files" | grep -qx 'package.json'; then
    package_json_before_file="$(mktemp)"
    package_json_after_file="$(mktemp)"
    cleanup_files+=("$package_json_before_file" "$package_json_after_file")
    if
      git show "$BASE_SHA:package.json" > "$package_json_before_file" 2>/dev/null &&
        git show "$HEAD_SHA:package.json" > "$package_json_after_file" 2>/dev/null
    then
      package_json_args=(
        --package-json-before "$package_json_before_file"
        --package-json-after "$package_json_after_file"
      )
    else
      echo 'Unable to derive package.json semantic diff; treating it as a runtime release-candidate change.' >&2
    fi
  fi

  eval "$(
    node scripts/lib/release-candidate-components.mjs classify \
      --changed-file-list "$changed_files_file" \
      --openpath-changed-file-list "$openpath_changed_files_file" \
      "${package_json_args[@]}"
  )"
fi

echo "gateway_changed=$gateway_changed" >> "$GITHUB_OUTPUT"
echo "migrations_changed=$migrations_changed" >> "$GITHUB_OUTPUT"
echo "openpath_firefox_assets_changed=${openpath_firefox_assets_changed:-false}" >> "$GITHUB_OUTPUT"
echo "openpath_api_changed=$openpath_api_changed" >> "$GITHUB_OUTPUT"
echo "openpath_linux_agent_required=${openpath_linux_agent_required:-false}" >> "$GITHUB_OUTPUT"
echo "spa_changed=$spa_changed" >> "$GITHUB_OUTPUT"
echo "verifier_changed=$verifier_changed" >> "$GITHUB_OUTPUT"
echo "manifest_only=${manifest_only:-false}" >> "$GITHUB_OUTPUT"
