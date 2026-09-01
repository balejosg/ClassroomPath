#!/usr/bin/env bash
# production-recovery-authority.sh - Explicit lifecycle for approved recovery R

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCTION_RECOVERY_SUPPORTED_CONTRACT_VERSION=1
PRODUCTION_RECOVERY_SUPPORTED_SOURCE_VERSION=1

usage() {
  cat >&2 <<'USAGE'
Usage:
  production-recovery-authority.sh validate --recovery-sha SHA --source-root DIR [--candidate-sha SHA]
  production-recovery-authority.sh package --recovery-sha SHA --source-root DIR --output TGZ --evidence ENV [--candidate-sha SHA]
  production-recovery-authority.sh preflight --recovery-sha SHA --artifact TGZ --evidence ENV
USAGE
}

authority_error() {
  printf '[ERROR] %s\n' "$*" >&2
}

require_full_sha() {
  local label="$1"
  local value="${2:-}"

  if [[ ! "$value" =~ ^[0-9a-f]{40}$ ]]; then
    authority_error "$label must be a full lowercase Git SHA-1 (40 hexadecimal characters)"
    return 1
  fi
}

option_value() {
  local option="$1"
  shift
  local value=""

  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$option" ]; then
      [ "$#" -ge 2 ] || return 1
      printf '%s\n' "$2"
      return 0
    fi
    shift
  done
  return 1
}

validate_authority_inputs() {
  local recovery_sha="$1"
  local candidate_sha="${2:-}"
  local source_root="$3"
  local source_sha=""

  require_full_sha PRODUCTION_RECOVERY_SHA "$recovery_sha" || return 1
  if [ -n "$candidate_sha" ]; then
    require_full_sha CANDIDATE_SHA "$candidate_sha" || return 1
    if [ "$recovery_sha" = "$candidate_sha" ]; then
      authority_error 'PRODUCTION_RECOVERY_SHA must not equal CANDIDATE_SHA'
      return 1
    fi
  fi
  if [ -z "$source_root" ] || [ ! -d "$source_root" ]; then
    authority_error "Recovery source checkout is unavailable: $source_root"
    return 1
  fi
  source_sha="$(git -C "$source_root" rev-parse --verify HEAD^{commit} 2>/dev/null || true)"
  if [ "$source_sha" != "$recovery_sha" ]; then
    authority_error "Recovery source checkout does not resolve to PRODUCTION_RECOVERY_SHA"
    return 1
  fi
  printf '%s\n' "$source_sha"
}

read_contract_value() {
  local contract_file="$1"
  local field="$2"

  awk -F= -v expected_field="$field" '
    $1 == expected_field {
      value = $2
      sub(/[[:space:]]+#.*$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      print value
      found = 1
      exit
    }
    END {
      if (!found) exit 1
    }
  ' "$contract_file"
}

package_exact_recovery() {
  local recovery_sha="$1"
  local candidate_sha="${2:-}"
  local source_root="$3"
  local output_path="$4"
  local evidence_path="$5"
  local source_sha=""
  local contract_file="$source_root/scripts/lib/production-recovery-contract.sh"
  local contract_version=""
  local source_version=""
  local artifact_sha256=""
  local executor_sha256=""
  local metadata=""

  source_sha="$(validate_authority_inputs "$recovery_sha" "$candidate_sha" "$source_root")" || return 1
  if [ ! -f "$contract_file" ]; then
    authority_error "Recovery contract is missing: $contract_file"
    return 1
  fi
  contract_version="$(read_contract_value "$contract_file" PRODUCTION_RECOVERY_CONTRACT_VERSION || true)"
  source_version="$(read_contract_value "$contract_file" PRODUCTION_RECOVERY_SOURCE_VERSION || true)"
  if [ "$contract_version" != "$PRODUCTION_RECOVERY_SUPPORTED_CONTRACT_VERSION" ] ||
    [ "$source_version" != "$PRODUCTION_RECOVERY_SUPPORTED_SOURCE_VERSION" ]; then
    authority_error 'Recovery contract/version is incompatible with this authority executor'
    return 1
  fi
  mkdir -p "$(dirname "$output_path")" "$(dirname "$evidence_path")"
  if ! (
    cd "$source_root"
    PRODUCTION_RECOVERY_SHA="$recovery_sha" \
      bash scripts/package-production-recovery-bundle.sh "$output_path"
  ) >/dev/null; then
    authority_error 'Unable to package the exact recovery source'
    return 1
  fi
  artifact_sha256="$(sha256sum "$output_path" | awk '{ print $1; exit }')"
  executor_sha256="$(tar -xOf "$output_path" production-recovery-executor.sh | sha256sum | awk '{ print $1; exit }')"
  metadata="$(tar -xOf "$output_path" lib/recovery-authority.env)"
  if ! printf '%s\n' "$metadata" | grep -Fqx "PRODUCTION_RECOVERY_SOURCE_SHA=$recovery_sha"; then
    authority_error 'Packaged recovery source SHA does not match PRODUCTION_RECOVERY_SHA'
    return 1
  fi
  if ! printf '%s\n' "$metadata" | grep -Fqx "PRODUCTION_RECOVERY_CONTRACT_VERSION=$contract_version"; then
    authority_error 'Packaged recovery contract version is inconsistent'
    return 1
  fi
  if ! printf '%s\n' "$metadata" | grep -Fqx "PRODUCTION_RECOVERY_SOURCE_VERSION=$source_version"; then
    authority_error 'Packaged recovery source version is inconsistent'
    return 1
  fi
  {
    printf 'PRODUCTION_RECOVERY_SHA=%s\n' "$recovery_sha"
    printf 'PRODUCTION_RECOVERY_SOURCE_SHA=%s\n' "$source_sha"
    printf 'PRODUCTION_RECOVERY_CONTRACT_VERSION=%s\n' "$contract_version"
    printf 'PRODUCTION_RECOVERY_SOURCE_VERSION=%s\n' "$source_version"
    printf 'PRODUCTION_RECOVERY_ARTIFACT_SHA256=%s\n' "$artifact_sha256"
    printf 'PRODUCTION_RECOVERY_EXECUTOR_SHA256=%s\n' "$executor_sha256"
  } > "$evidence_path"
}

preflight_exact_recovery() {
  local recovery_sha="$1"
  local artifact_path="$2"
  local evidence_path="$3"
  local artifact_sha256=""
  local executor_sha256=""
  local source_sha=""
  local contract_version=""
  local source_version=""
  local temp_dir=""
  local bundle_root=""
  local recorded_artifact_sha256=""
  local recorded_executor_sha256=""
  local recorded_recovery_sha=""
  local recorded_source_sha=""
  local recorded_contract_version=""
  local recorded_source_version=""

  require_full_sha PRODUCTION_RECOVERY_SHA "$recovery_sha" || return 1
  [ -f "$artifact_path" ] || {
    authority_error "Recovery artifact is unavailable: $artifact_path"
    return 1
  }
  artifact_sha256="$(sha256sum "$artifact_path" | awk '{ print $1; exit }')"
  executor_sha256="$(tar -xOf "$artifact_path" production-recovery-executor.sh | sha256sum | awk '{ print $1; exit }')" || {
    authority_error 'Recovery artifact does not contain its exact executor'
    return 1
  }
  temp_dir="$(mktemp -d)"
  bundle_root="$temp_dir/bundle"
  mkdir -p "$bundle_root"
  if ! tar -xzf "$artifact_path" -C "$bundle_root" --no-same-owner --no-same-permissions; then
    rm -rf "$temp_dir"
    authority_error 'Unable to extract the exact recovery artifact for preflight'
    return 1
  fi
  if [ ! -f "$evidence_path" ]; then
    rm -rf "$temp_dir"
    authority_error "Recovery authority evidence is unavailable: $evidence_path"
    return 1
  fi
  recorded_recovery_sha="$(read_contract_value "$evidence_path" PRODUCTION_RECOVERY_SHA || true)"
  recorded_source_sha="$(read_contract_value "$evidence_path" PRODUCTION_RECOVERY_SOURCE_SHA || true)"
  recorded_contract_version="$(read_contract_value "$evidence_path" PRODUCTION_RECOVERY_CONTRACT_VERSION || true)"
  recorded_source_version="$(read_contract_value "$evidence_path" PRODUCTION_RECOVERY_SOURCE_VERSION || true)"
  recorded_artifact_sha256="$(read_contract_value "$evidence_path" PRODUCTION_RECOVERY_ARTIFACT_SHA256 || true)"
  recorded_executor_sha256="$(read_contract_value "$evidence_path" PRODUCTION_RECOVERY_EXECUTOR_SHA256 || true)"
  if [ "$recorded_recovery_sha" != "$recovery_sha" ] ||
    [ "$recorded_source_sha" != "$recovery_sha" ] ||
    [ "$recorded_contract_version" != "$PRODUCTION_RECOVERY_SUPPORTED_CONTRACT_VERSION" ] ||
    [ "$recorded_source_version" != "$PRODUCTION_RECOVERY_SUPPORTED_SOURCE_VERSION" ] ||
    [ "$recorded_artifact_sha256" != "$artifact_sha256" ]; then
    rm -rf "$temp_dir"
    authority_error 'Recovery artifact identity evidence is missing or inconsistent'
    return 1
  fi
  if [ "$recorded_executor_sha256" != "$executor_sha256" ]; then
    rm -rf "$temp_dir"
    authority_error 'Recovery executor bytes do not match the recorded executor SHA-256'
    return 1
  fi
  source_sha="$(read_contract_value "$bundle_root/lib/recovery-authority.env" PRODUCTION_RECOVERY_SOURCE_SHA || true)"
  contract_version="$(read_contract_value "$bundle_root/lib/recovery-authority.env" PRODUCTION_RECOVERY_CONTRACT_VERSION || true)"
  source_version="$(read_contract_value "$bundle_root/lib/recovery-authority.env" PRODUCTION_RECOVERY_SOURCE_VERSION || true)"
  if [ "$source_sha" != "$recovery_sha" ] ||
    [ "$contract_version" != "1" ] ||
    [ "$source_version" != "1" ]; then
    rm -rf "$temp_dir"
    authority_error 'Recovery artifact authority metadata is incompatible or inconsistent'
    return 1
  fi
  if ! (
    CLASSROOMPATH_DEPLOY_ROOT="$temp_dir/deploy-root" \
    APP_DIR="$temp_dir/candidate" \
    PRODUCTION_RECOVERY_SHA="$recovery_sha" \
    PRODUCTION_RECOVERY_SOURCE_SHA="$recovery_sha" \
    PRODUCTION_RECOVERY_CONTRACT_VERSION="$contract_version" \
    PRODUCTION_RECOVERY_SOURCE_VERSION="$source_version" \
    PRODUCTION_RECOVERY_EXECUTOR_SHA256="$executor_sha256" \
      bash "$bundle_root/production-recovery-executor.sh" --authority-preflight-only
  ); then
    rm -rf "$temp_dir"
    authority_error 'Exact recovery executor preflight failed'
    return 1
  fi
  printf 'PRODUCTION_RECOVERY_ARTIFACT_SHA256=%s\n' "$artifact_sha256" >> "$evidence_path"
  printf 'PRODUCTION_RECOVERY_EXECUTOR_SHA256=%s\n' "$executor_sha256" >> "$evidence_path"
  printf 'PREFLIGHT=passed\n' >> "$evidence_path"
  rm -rf "$temp_dir"
}

command="${1:-}"
[ -n "$command" ] || { usage; exit 2; }
shift

recovery_sha="$(option_value --recovery-sha "$@" || true)"
candidate_sha="$(option_value --candidate-sha "$@" || true)"
source_root="$(option_value --source-root "$@" || true)"

case "$command" in
  validate)
    [ -n "$source_root" ] || { usage; exit 2; }
    validate_authority_inputs "$recovery_sha" "$candidate_sha" "$source_root" >/dev/null
    ;;
  package)
    output_path="$(option_value --output "$@" || true)"
    evidence_path="$(option_value --evidence "$@" || true)"
    if [ -z "$source_root" ] || [ -z "$output_path" ] || [ -z "$evidence_path" ]; then
      usage
      exit 2
    fi
    package_exact_recovery \
      "$recovery_sha" "$candidate_sha" "$source_root" "$output_path" "$evidence_path"
    ;;
  preflight)
    artifact_path="$(option_value --artifact "$@" || true)"
    evidence_path="$(option_value --evidence "$@" || true)"
    if [ -z "$artifact_path" ] || [ -z "$evidence_path" ]; then
      usage
      exit 2
    fi
    preflight_exact_recovery "$recovery_sha" "$artifact_path" "$evidence_path"
    ;;
  *)
    usage
    exit 2
    ;;
esac
