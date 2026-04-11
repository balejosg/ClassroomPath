#!/usr/bin/env bash
# release-risk.sh - Shared release promotion risk helpers
# shellcheck shell=bash

release_risk_target_sha() {
  if [ -n "${TARGET_SHA:-}" ]; then
    printf '%s\n' "$TARGET_SHA"
    return 0
  fi

  if [ -n "${GITHUB_SHA:-}" ]; then
    printf '%s\n' "$GITHUB_SHA"
    return 0
  fi

  git rev-parse HEAD
}

resolve_release_risk_base_ref() {
  local production_state_path="${PRODUCTION_RELEASE_STATE_PATH:-./production-release-state.env}"
  local current_ref_name="${GITHUB_REF_NAME:-}"
  local previous_tag=""

  RELEASE_RISK_BASE_REF="${PRODUCTION_CURRENT_APP_SHA:-}"
  RELEASE_RISK_BASE_SOURCE="production-state"

  if [ -z "$RELEASE_RISK_BASE_REF" ] && [ -f "$production_state_path" ]; then
    load_release_state_env "$production_state_path"
    RELEASE_RISK_BASE_REF="${APP_SHA:-}"
  fi

  if [ -n "$RELEASE_RISK_BASE_REF" ]; then
    return 0
  fi

  git fetch --tags --force >/dev/null 2>&1 || true
  previous_tag="$(git tag --sort=-creatordate | grep '^v' | grep -vx "${current_ref_name}" | head -n 1 || true)"

  if [ -n "$previous_tag" ]; then
    RELEASE_RISK_BASE_REF="$previous_tag"
    RELEASE_RISK_BASE_SOURCE="previous-tag"
    return 0
  fi

  RELEASE_RISK_BASE_REF=""
  RELEASE_RISK_BASE_SOURCE="target-only"
}

list_release_risk_changed_files() {
  local base_ref="$1"
  local target_ref="$2"

  if [ -n "$base_ref" ]; then
    git diff --name-only "${base_ref}...${target_ref}"
    return 0
  fi

  git show --pretty='' --name-only "$target_ref"
}

release_risk_is_high() {
  local changed_files="${1:-}"

  if printf '%s\n' "$changed_files" | grep -Eq '^(upstream/openpath$|upstream/openpath/windows/|upstream/openpath/linux/|upstream/openpath/firefox-extension/|upstream/openpath/api/src/|upstream/openpath/api/package\.json$|upstream/openpath/api/tests/token-delivery\.test\.ts$|docker/Dockerfile\.api$)'; then
    return 0
  fi

  return 1
}

emit_release_risk_outputs() {
  local github_output_path="${1:-${GITHUB_OUTPUT:-}}"
  local high_risk="$2"

  if [ -z "$github_output_path" ]; then
    return 0
  fi

  {
    printf 'high_risk=%s\n' "$high_risk"
    printf 'base_ref=%s\n' "${RELEASE_RISK_BASE_REF:-}"
    printf 'base_source=%s\n' "${RELEASE_RISK_BASE_SOURCE:-unknown}"
  } >> "$github_output_path"
}
