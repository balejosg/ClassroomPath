#!/usr/bin/env bash
# Canonical recovery-authority operation shared by pre-tag readiness and deploy.yml.
# shellcheck shell=bash

PRODUCTION_RECOVERY_PREFLIGHT_CONTRACT_VERSION=1

production_recovery_prepare_and_verify() {
  local recovery_sha="${1:-${PRODUCTION_RECOVERY_SHA:-}}"
  local candidate_sha="${2:-${CANDIDATE_SHA:-}}"
  local source_root="${3:-${PRODUCTION_RECOVERY_SOURCE_ROOT:-}}"
  local artifact_path="${4:-${PRODUCTION_RECOVERY_ARTIFACT_PATH:-}}"
  local evidence_path="${5:-${PRODUCTION_RECOVERY_EVIDENCE_PATH:-}}"
  local authority_script=""

  if [[ ! "$recovery_sha" =~ ^[0-9a-f]{40}$ ]]; then
    printf '[ERROR] PRODUCTION_RECOVERY_SHA must be a full lowercase 40-character Git SHA\n' >&2
    return 1
  fi
  if [[ ! "$candidate_sha" =~ ^[0-9a-f]{40}$ ]]; then
    printf '[ERROR] CANDIDATE_SHA must be a full lowercase 40-character Git SHA\n' >&2
    return 1
  fi
  if [ "$recovery_sha" = "$candidate_sha" ]; then
    printf '[ERROR] PRODUCTION_RECOVERY_SHA must differ from CANDIDATE_SHA\n' >&2
    return 1
  fi
  if [ -z "$source_root" ] || [ ! -d "$source_root" ]; then
    printf '[ERROR] Recovery source checkout is unavailable\n' >&2
    return 1
  fi

  authority_script="$source_root/scripts/production-recovery-authority.sh"
  if [ ! -x "$authority_script" ] && [ ! -f "$authority_script" ]; then
    printf '[ERROR] Recovery authority script is unavailable\n' >&2
    return 1
  fi

  artifact_path="${artifact_path:-$(mktemp "${TMPDIR:-/tmp}/production-recovery.XXXXXX.tgz")}"
  evidence_path="${evidence_path:-$(mktemp "${TMPDIR:-/tmp}/production-recovery.XXXXXX.env")}"
  mkdir -p "$(dirname "$artifact_path")" "$(dirname "$evidence_path")"

  bash "$authority_script" validate \
    --recovery-sha "$recovery_sha" \
    --candidate-sha "$candidate_sha" \
    --source-root "$source_root" >/dev/null
  bash "$authority_script" package \
    --recovery-sha "$recovery_sha" \
    --candidate-sha "$candidate_sha" \
    --source-root "$source_root" \
    --output "$artifact_path" \
    --evidence "$evidence_path" >/dev/null
  bash "$authority_script" preflight \
    --recovery-sha "$recovery_sha" \
    --artifact "$artifact_path" \
    --evidence "$evidence_path" >/dev/null

  test -s "$artifact_path"
  test -s "$evidence_path"
  grep -Fqx "PRODUCTION_RECOVERY_SHA=$recovery_sha" "$evidence_path"
  grep -Fqx "PRODUCTION_RECOVERY_SOURCE_SHA=$recovery_sha" "$evidence_path"
  grep -Fqx 'PREFLIGHT=passed' "$evidence_path"

  PRODUCTION_RECOVERY_SHA="$recovery_sha"
  PRODUCTION_RECOVERY_SOURCE_SHA="$recovery_sha"
  PRODUCTION_RECOVERY_ARTIFACT_PATH="$artifact_path"
  PRODUCTION_RECOVERY_EVIDENCE_PATH="$evidence_path"
  PRODUCTION_RECOVERY_ARTIFACT_SHA256="$(sha256sum "$artifact_path" | awk '{print $1; exit}')"
  PRODUCTION_RECOVERY_EXECUTOR_SHA256="$(tar -xOf "$artifact_path" production-recovery-executor.sh | sha256sum | awk '{print $1; exit}')"
  export PRODUCTION_RECOVERY_SHA PRODUCTION_RECOVERY_SOURCE_SHA
  export PRODUCTION_RECOVERY_ARTIFACT_PATH PRODUCTION_RECOVERY_EVIDENCE_PATH
  export PRODUCTION_RECOVERY_ARTIFACT_SHA256 PRODUCTION_RECOVERY_EXECUTOR_SHA256
}

production_recovery_preflight_supports_contract() {
  local helper_path="${1:-}"
  [ -f "$helper_path" ] || return 1
  grep -Fq 'production_recovery_prepare_and_verify()' "$helper_path" &&
    grep -Fq 'PRODUCTION_RECOVERY_PREFLIGHT_CONTRACT_VERSION=1' "$helper_path"
}
