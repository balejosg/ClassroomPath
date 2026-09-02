#!/usr/bin/env bash
# staging-equivalent-harness.sh - repository-owned, fail-closed K harness
#
# The host-side path is Bash/POSIX/Docker only. Release-bundle and state
# JavaScript are invoked through an immutable verifier image. This file is
# also safe to source from shell contract tests.

K_HARNESS_SCRIPT_PATH="${BASH_SOURCE[0]:-}"
if [ -n "$K_HARNESS_SCRIPT_PATH" ]; then
  K_HARNESS_DIR="$(cd "$(dirname "$K_HARNESS_SCRIPT_PATH")" && pwd)"
else
  K_HARNESS_DIR="$(pwd)"
fi

K_HARNESS_CONTRACT_VERSION=1
K_HARNESS_SCHEMA_VERSION=1
K_HARNESS_COMPOSE_PROJECT=classroompath-production
K_HARNESS_ENVIRONMENT=staging-equivalent
# Contract defaults are intentionally literal and auditable:
# K_ENVIRONMENT=staging-equivalent
# K_COMPOSE_PROJECT=classroompath-production
K_HARNESS_MAX_RECORD_BYTES=16384
K_HARNESS_MAX_EVIDENCE_BYTES=1048576
K_RUNTIME_PROJECTION_KEYS=(
  RELEASE_ID
  IMAGE_SOURCE
  APP_SHA
  OPENPATH_SHA
  OPENPATH_CONTRACT_SHA256
  CLASSROOMPATH_GATEWAY_IMAGE
  CLASSROOMPATH_MIGRATIONS_IMAGE
  OPENPATH_FIREFOX_ASSETS_IMAGE
  OPENPATH_API_IMAGE
  OPENPATH_VERSION
  OPENPATH_LINUX_AGENT_VERSION
  OPENPATH_LINUX_AGENT_APT_SUITE
  CLASSROOMPATH_SPA_IMAGE
  CLASSROOMPATH_VERIFIER_IMAGE
  OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION
  OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT
  OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG
  OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256
  RC_RUN_ID
)
K_RUNTIME_PROJECTION_VALUE_RE='^[A-Za-z0-9_@%+=:,./-]+$'

k_error() {
  printf '[staging-equivalent] ERROR: %s\n' "$*"
  return 1
}

k_info() {
  printf '[staging-equivalent] %s\n' "$*"
}

k_usage() {
  cat <<'EOF'
Usage:
  scripts/staging-equivalent-harness.sh validate-environment --config FILE
  scripts/staging-equivalent-harness.sh validate-host-path [--path PATH]
  scripts/staging-equivalent-harness.sh validate-attestation --config FILE --snapshot FILE [--baseline FILE]
  scripts/staging-equivalent-harness.sh attest-p --config FILE
  scripts/staging-equivalent-harness.sh prepare-recovery --config FILE
  scripts/staging-equivalent-harness.sh validate-recovery --config FILE [--output FILE]
  scripts/staging-equivalent-harness.sh validate-migration --config FILE --repo DIR --from SHA --to SHA --output FILE
  scripts/staging-equivalent-harness.sh validate-transition --state FILE
  scripts/staging-equivalent-harness.sh evidence --config FILE --records FILE --output-dir DIR
  scripts/staging-equivalent-harness.sh provision --config FILE --confirm-staging-equivalent
  scripts/staging-equivalent-harness.sh fault-leg --config FILE --confirm-staging-equivalent
  scripts/staging-equivalent-harness.sh success-leg --config FILE --confirm-staging-equivalent
  scripts/staging-equivalent-harness.sh rollback --config FILE --confirm-staging-equivalent

Mutating commands require a durable staging-equivalent identity marker and the
explicit confirmation flag. They never read GitHub PRODUCTION_RECOVERY_SHA.
The exact recovery identity is supplied as K_RECOVERY_* config values.
The recovery bundle contract is the same production-recovery-authority contract,
but its authority is supplied locally for staging-equivalent only.
EOF
}

k_require_external_output_path() {
  local name="$1"
  local path="${!name:-}"
  local parent=""
  local parent_real=""
  local deploy_root_real=""
  local candidate_real=""

  k_validate_configured_path "$name" || return 1
  parent="$(dirname "$path")"
  [ -d "$parent" ] || {
    k_error "$name parent directory does not exist: $parent"
    return 1
  }
  parent_real="$(k_canonical_dir "$parent")" || return 1
  deploy_root_real="$(k_canonical_dir "$K_DEPLOY_ROOT")" || return 1
  candidate_real="$parent_real/$(basename "$path")"
  if k_is_under "$candidate_real" "$deploy_root_real"; then
    k_error "$name must be outside the fenced deploy root"
    return 1
  fi
  if [ -e "$path" ] && [ ! -f "$path" ]; then
    k_error "$name exists but is not a regular file"
    return 1
  fi
  return 0
}

k_json_escape() {
  local value="${1:-}"

  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\t'/\\t}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

k_hash_file() {
  sha256sum "$1" | awk '{ print $1; exit }'
}

k_hash_text() {
  printf '%s' "$1" | sha256sum | awk '{ print $1; exit }'
}

k_generate_transaction_id() {
  printf '%s' "$(date -u +%s%N)-$$-${RANDOM:-0}" | sha256sum | awk '{ print $1; exit }'
}

k_require_transaction_id() {
  local transaction_id="${1:-}"

  [[ "$transaction_id" =~ ^[0-9a-f]{64}$ ]] || {
    k_error 'Deployment transaction ID must be a full lowercase 64-character SHA-256 value'
    return 1
  }
}

k_hash_filesystem_device() {
  local path="$1"
  local device=""

  device="$(df -P "$path" | awk 'NR == 2 { print $1; exit }')" || return 1
  [ -n "$device" ] || return 1
  k_hash_text "$device"
}

k_require_sha40() {
  local label="$1"
  local value="${2:-}"

  if [[ ! "$value" =~ ^[0-9a-f]{40}$ ]]; then
    k_error "$label must be a full lowercase 40-character Git SHA"
    return 1
  fi
}

k_require_sha64() {
  local label="$1"
  local value="${2:-}"

  if [[ ! "$value" =~ ^[0-9a-f]{64}$ ]]; then
    k_error "$label must be a lowercase 64-character SHA-256"
    return 1
  fi
}

k_contains_secret_shape() {
  local value="${1:-}"

  value="${value^^}"
  [[ "$value" =~ (PASSWORD|TOKEN|SECRET|PRIVATE[[:space:]]+KEY|AUTHORIZATION|BEGIN[[:space:]]+PRIVATE|DATABASE_URL|API_KEY) ]]
}

k_require_immutable_image() {
  local label="$1"
  local value="${2:-}"

  if [[ ! "$value" =~ @sha256:[0-9a-f]{64}$ ]]; then
    k_error "$label must be pinned by an immutable digest"
    return 1
  fi
}

k_read_file_value() {
  local file="$1"
  local key="$2"
  local value=""

  [ -f "$file" ] || return 1
  value="$(awk -F= -v expected_key="$key" '
    $1 == expected_key {
      print substr($0, index($0, "=") + 1)
      count++
    }
    END {
      if (count != 1) exit 1
    }
  ' "$file")" || return 1
  printf '%s\n' "$value"
}

k_read_required_file_value() {
  local file="$1"
  local key="$2"
  local value=""

  value="$(k_read_file_value "$file" "$key")" || {
    k_error "Missing or duplicated $key in $file"
    return 1
  }
  [ -n "$value" ] || {
    k_error "$key in $file must not be empty"
    return 1
  }
  printf '%s\n' "$value"
}

k_read_consistent_file_value() {
  local file="$1"
  local key="$2"

  awk -F= -v expected_key="$key" '
    $1 == expected_key {
      value = substr($0, index($0, "=") + 1)
      if (!found) {
        expected = value
        found = 1
      } else if (value != expected) {
        inconsistent = 1
      }
    }
    END {
      if (!found || inconsistent) exit 1
      print expected
    }
  ' "$file"
}

k_is_under() {
  local child="$1"
  local parent="$2"

  case "$child" in
    "$parent"|"$parent"/*) return 0 ;;
    *) return 1 ;;
  esac
}

k_canonical_dir() {
  (cd "$1" 2>/dev/null && pwd -P)
}

k_canonical_file() {
  local path="$1"
  local parent=""

  [ -f "$path" ] || return 1
  [ ! -L "$path" ] || return 1
  parent="$(k_canonical_dir "$(dirname "$path")")" || return 1
  printf '%s/%s\n' "$parent" "${path##*/}"
}

k_load_config() {
  local config_file="$1"
  local line=""
  local key=""
  local value=""
  local -A seen=()

  [ -f "$config_file" ] || {
    k_error "Harness config does not exist: $config_file"
    return 1
  }
  K_CONFIG_FILE="$config_file"
  K_CONFIG_KEYS=()
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    [[ "$line" == \#* ]] && continue
    [[ "$line" == K_*=* ]] || {
      k_error 'Harness config contains an invalid or unsafe line'
      return 1
    }
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^K_[A-Z0-9_]+$ ]] || {
      k_error "Harness config key is invalid: $key"
      return 1
    }
    case "$key" in
      K_RUNTIME_SECRETS_FILE)
        # This is a path to a private operator-managed file. Its contents are
        # never parsed into evidence or sourced by the harness.
        ;;
      K_HARNESS_*|K_CONFIG_FILE|K_CONFIRM_STAGING_EQUIVALENT|K_*_OPTION|K_EFFECTIVE_HOST_PATH|K_SNAPSHOT_TEMP|K_RUNTIME_PROJECTION_KEYS|K_HOST_NODE_NPM_UNAVAILABLE|K_HOST_NODE_OBSERVED|K_HOST_NPM_OBSERVED|K_DOCKER_DAEMON_ID_OBSERVED|K_GATEWAY_DOWNLOAD_DEVICE_SHA256_OBSERVED|K_TRANSACTION_ID|K_PROVISION_ATTEMPT_*|K_PROVISION_RESOURCES_ABSENT_BEFORE|K_SAFETY_OUTCOME|K_EVIDENCE_OUTCOME|K_EVIDENCE_FAILURE_REASON|K_FORWARD_*|K_RECOVERY_ATTEMPTED|K_RECOVERY_RESULT|K_RECOVERY_REQUIRED_AFTER_FORWARD|K_MANUAL_ROLLBACK*)
        k_error "Harness config attempts to override an internal variable: $key"
        return 1
        ;;
      K_*TOKEN*|K_*PASSWORD*|K_*SECRET*|K_*PRIVATE*|K_*AUTHORIZATION*)
        k_error "Secret-bearing config keys are forbidden: $key"
        return 1
        ;;
    esac
    [ -z "${seen[$key]+present}" ] || {
      k_error "Harness config contains a duplicate key: $key"
      return 1
    }
    seen["$key"]=1
    printf -v "$key" '%s' "$value"
    K_CONFIG_KEYS+=("$key")
  done < "$config_file"
}

k_validate_external_file() {
  local file="$1"
  local label="$2"
  local file_real=""
  local deploy_root_real=""

  [ -f "$file" ] && [ ! -L "$file" ] || {
    k_error "$label must be a non-symlink regular file"
    return 1
  }
  file_real="$(k_canonical_file "$file")" || return 1
  deploy_root_real="$(k_canonical_dir "$K_DEPLOY_ROOT")" || return 1
  if k_is_under "$file_real" "$deploy_root_real"; then
    k_error "$label must be outside the fenced deploy root"
    return 1
  fi
  return 0
}

k_validate_external_directory() {
  local directory="$1"
  local label="$2"
  local directory_real=""
  local deploy_root_real=""

  [ -d "$directory" ] && [ ! -L "$directory" ] || {
    k_error "$label must be a non-symlink directory"
    return 1
  }
  directory_real="$(k_canonical_dir "$directory")" || return 1
  deploy_root_real="$(k_canonical_dir "$K_DEPLOY_ROOT")" || return 1
  if k_is_under "$directory_real" "$deploy_root_real"; then
    k_error "$label must be outside the fenced deploy root"
    return 1
  fi
  return 0
}

k_validate_environment() {
  local deploy_root="${K_DEPLOY_ROOT:-}"
  local deploy_root_real=""
  local identity_real=""
  local host_id_real=""
  local config_real=""
  local actual_hash=""
  local marker_value=""

  [ "${K_ENVIRONMENT:-}" = "$K_HARNESS_ENVIRONMENT" ] || {
    k_error 'K_ENVIRONMENT must be exactly staging-equivalent'
    return 1
  }
  [[ "${K_ENVIRONMENT_ID:-}" =~ ^[A-Za-z0-9._-]+$ ]] || {
    k_error 'K_ENVIRONMENT_ID must be an explicit opaque environment identity'
    return 1
  }
  [ "${K_COMPOSE_PROJECT:-}" = "$K_HARNESS_COMPOSE_PROJECT" ] || {
    k_error 'K_COMPOSE_PROJECT must be classroompath-production on the isolated host'
    return 1
  }
  [ "${K_PRODUCTION_TARGET:-}" = false ] || {
    k_error 'K_PRODUCTION_TARGET must be false'
    return 1
  }
  [ "${K_RUNTIME_ENVIRONMENT:-}" = "$K_HARNESS_ENVIRONMENT" ] || {
    k_error 'K_RUNTIME_ENVIRONMENT must identify staging-equivalent'
    return 1
  }
  [ "${K_NORMAL_STAGING_ALLOWED:-}" = false ] || {
    k_error 'K_NORMAL_STAGING_ALLOWED must be false; the normal staging host is disqualified'
    return 1
  }
  [ "${K_RECOVERY_AUTHORITY_SCOPE:-}" = local-staging-equivalent ] || {
    k_error 'K_RECOVERY_AUTHORITY_SCOPE must be local-staging-equivalent'
    return 1
  }
  [[ "${K_DATABASE_IDENTITY:-}" =~ ^[A-Za-z0-9._:-]+$ ]] || {
    k_error 'K_DATABASE_IDENTITY must be an explicit non-secret isolated database identity'
    return 1
  }
  [ "${K_DATABASE_SCOPE:-}" = staging-equivalent ] || {
    k_error 'K_DATABASE_SCOPE must be staging-equivalent'
    return 1
  }
  [ "${K_CREDENTIALS_SCOPE:-}" = staging-equivalent ] || {
    k_error 'K_CREDENTIALS_SCOPE must be staging-equivalent'
    return 1
  }
  k_require_sha64 K_DATABASE_ENDPOINT_SHA256 "${K_DATABASE_ENDPOINT_SHA256:-}" || return 1
  [ "${K_GATEWAY_DOWNLOAD_HOST_ROOT:-}" = /srv/classroompath/downloads ] || {
    k_error 'K_GATEWAY_DOWNLOAD_HOST_ROOT must preserve the production bind-mount path'
    return 1
  }
  case "${K_CONTAINER_PLATFORM:-}" in
    linux/amd64|linux/arm64) ;;
    *) k_error 'K_CONTAINER_PLATFORM must be explicitly linux/amd64 or linux/arm64'; return 1 ;;
  esac
  [[ "${K_DOCKER_DAEMON_ID:-}" =~ ^[A-Za-z0-9._:-]+$ ]] || {
    k_error 'K_DOCKER_DAEMON_ID must identify the isolated Docker daemon explicitly'
    return 1
  }
  k_require_sha64 K_GATEWAY_DOWNLOAD_DEVICE_SHA256 "${K_GATEWAY_DOWNLOAD_DEVICE_SHA256:-}" || return 1
  [[ "${K_BASE_URL:-}" =~ ^https?://[^[:space:]]+$ ]] || {
    k_error 'K_BASE_URL must be an explicit test URL'
    return 1
  }
  k_require_sha64 K_BASE_URL_SHA256 "${K_BASE_URL_SHA256:-}" || return 1
  [ "$(k_hash_text "$K_BASE_URL")" = "$K_BASE_URL_SHA256" ] || {
    k_error 'K_BASE_URL identity hash does not match the requested environment'
    return 1
  }
  [[ "${K_NETWORK_PREFLIGHT_URL:-}" =~ ^https?://[^[:space:]]+$ ]] || {
    k_error 'K_NETWORK_PREFLIGHT_URL must be an explicit registry/network test URL'
    return 1
  }
  [[ "$deploy_root" = /* ]] || {
    k_error 'K_DEPLOY_ROOT must be an absolute path'
    return 1
  }
  [ -d "$deploy_root" ] || {
    k_error "K_DEPLOY_ROOT does not exist: $deploy_root"
    return 1
  }
  deploy_root_real="$(k_canonical_dir "$deploy_root")" || {
    k_error 'K_DEPLOY_ROOT cannot be canonicalized'
    return 1
  }
  [ "$deploy_root_real" != / ] || {
    k_error 'K_DEPLOY_ROOT must not be filesystem root'
    return 1
  }
  k_require_sha64 K_DEPLOY_ROOT_SHA256 "${K_DEPLOY_ROOT_SHA256:-}" || return 1
  actual_hash="$(k_hash_text "$deploy_root_real")"
  [ "$actual_hash" = "$K_DEPLOY_ROOT_SHA256" ] || {
    k_error 'K_DEPLOY_ROOT identity hash does not match this host'
    return 1
  }

  identity_real="$(k_canonical_file "${K_IDENTITY_FILE:-}")" || {
    k_error 'K_IDENTITY_FILE must be a non-symlink regular file'
    return 1
  }
  host_id_real="$(k_canonical_file "${K_HOST_ID_FILE:-}")" || {
    k_error 'K_HOST_ID_FILE must be a non-symlink regular file'
    return 1
  }
  [ "${K_HOST_ID_KIND:-}" = system-machine-id ] || {
    k_error 'K_HOST_ID_KIND must be system-machine-id'
    return 1
  }
  case "$host_id_real" in
    /etc/machine-id|/var/lib/dbus/machine-id)
      ;;
    *)
      k_error 'K_HOST_ID_FILE must be the host machine-id path'
      return 1
      ;;
  esac
  config_real="$(k_canonical_file "${K_CONFIG_FILE:-}")" || {
    k_error 'Harness config must be a non-symlink regular file'
    return 1
  }
  if k_is_under "$identity_real" "$deploy_root_real" ||
    k_is_under "$host_id_real" "$deploy_root_real" ||
    k_is_under "$config_real" "$deploy_root_real"; then
    k_error 'Identity/config files must be outside the deploy root'
    return 1
  fi

  k_require_sha64 K_IDENTITY_FILE_SHA256 "${K_IDENTITY_FILE_SHA256:-}" || return 1
  actual_hash="$(k_hash_file "$identity_real")"
  [ "$actual_hash" = "$K_IDENTITY_FILE_SHA256" ] || {
    k_error 'Durable environment identity file hash does not match this host'
    return 1
  }
  k_validate_snapshot_no_secrets "$identity_real" || return 1
  k_require_sha64 K_HOST_ID_SHA256 "${K_HOST_ID_SHA256:-}" || return 1
  actual_hash="$(k_hash_file "$host_id_real")"
  [ "$actual_hash" = "$K_HOST_ID_SHA256" ] || {
    k_error 'Host identity hash does not match this host'
    return 1
  }

  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_VERSION)" || return 1
  [ "$marker_value" = 1 ] || { k_error 'Unsupported environment marker version'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_ID)" || return 1
  [ "$marker_value" = "$K_ENVIRONMENT_ID" ] || { k_error 'Environment marker ID mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_PRODUCTION_TARGET)" || return 1
  [ "$marker_value" = false ] || { k_error 'Environment marker identifies production'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_HOST_ID_SHA256)" || return 1
  [ "$marker_value" = "$K_HOST_ID_SHA256" ] || { k_error 'Environment marker host mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_DEPLOY_ROOT_SHA256)" || return 1
  [ "$marker_value" = "$K_DEPLOY_ROOT_SHA256" ] || { k_error 'Environment marker root mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_COMPOSE_PROJECT)" || return 1
  [ "$marker_value" = "$K_COMPOSE_PROJECT" ] || { k_error 'Environment marker Compose project mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_NORMAL_STAGING_ALLOWED)" || return 1
  [ "$marker_value" = false ] || { k_error 'Environment marker permits the normal staging host'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_RECOVERY_AUTHORITY_SCOPE)" || return 1
  [ "$marker_value" = "$K_RECOVERY_AUTHORITY_SCOPE" ] || { k_error 'Environment marker recovery scope mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_DATABASE_IDENTITY)" || return 1
  [ "$marker_value" = "$K_DATABASE_IDENTITY" ] || { k_error 'Environment marker database identity mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_DATABASE_ENDPOINT_SHA256)" || return 1
  [ "$marker_value" = "$K_DATABASE_ENDPOINT_SHA256" ] || { k_error 'Environment marker database endpoint mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_DATABASE_SCOPE)" || return 1
  [ "$marker_value" = "$K_DATABASE_SCOPE" ] || { k_error 'Environment marker database scope mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_CREDENTIALS_SCOPE)" || return 1
  [ "$marker_value" = "$K_CREDENTIALS_SCOPE" ] || { k_error 'Environment marker credentials scope mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_DOCKER_DAEMON_ID)" || return 1
  [ "$marker_value" = "$K_DOCKER_DAEMON_ID" ] || { k_error 'Environment marker Docker daemon mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_GATEWAY_DOWNLOAD_DEVICE_SHA256)" || return 1
  [ "$marker_value" = "$K_GATEWAY_DOWNLOAD_DEVICE_SHA256" ] || { k_error 'Environment marker filesystem identity mismatch'; return 1; }
  marker_value="$(k_read_required_file_value "$identity_real" STAGING_EQUIVALENT_BASE_URL_SHA256)" || return 1
  [ "$marker_value" = "$K_BASE_URL_SHA256" ] || { k_error 'Environment marker URL mismatch'; return 1; }
  k_info 'staging-equivalent fence passed; production authority is not consulted'
}

k_source_host_contract() {
  local helper="$K_HARNESS_DIR/lib/production-host-contract.sh"

  [ -f "$helper" ] || { k_error "Host contract helper is missing: $helper"; return 1; }
  # shellcheck source=lib/production-host-contract.sh
  source "$helper"
}

k_validate_effective_host_path() {
  local effective_path="${1:-${PATH:-}}"
  local command_name=""

  [ -n "$effective_path" ] || { k_error 'Effective host PATH is empty'; return 1; }
  if PATH="$effective_path" command -v node >/dev/null 2>&1; then
    k_error 'node is available in the effective host PATH'
    return 1
  fi
  if PATH="$effective_path" command -v npm >/dev/null 2>&1; then
    k_error 'npm is available in the effective host PATH'
    return 1
  fi
  if declare -p PRODUCTION_HOST_REQUIRED_COMMANDS >/dev/null 2>&1; then
    for command_name in "${PRODUCTION_HOST_REQUIRED_COMMANDS[@]}"; do
      PATH="$effective_path" command -v "$command_name" >/dev/null 2>&1 || {
        k_error "Required host command is unavailable in the effective PATH: $command_name"
        return 1
      }
    done
  fi
  return 0
}

k_build_effective_host_path() {
  local allowlist_dir=""
  local command_name=""
  local command_path=""

  k_source_host_contract || return 1
  allowlist_dir="$(mktemp -d "${TMPDIR:-/tmp}/classroompath-k-host-path.XXXXXX")" || return 1
  for command_name in "${PRODUCTION_HOST_REQUIRED_COMMANDS[@]}"; do
    command_path="$(command -v "$command_name" || true)"
    [ -n "$command_path" ] || {
      rm -rf "$allowlist_dir"
      k_error "Cannot construct host allow-list; command is unavailable: $command_name"
      return 1
    }
    ln -s "$command_path" "$allowlist_dir/$command_name" || {
      rm -rf "$allowlist_dir"
      return 1
    }
  done
  if ! k_validate_effective_host_path "$allowlist_dir"; then
    rm -rf "$allowlist_dir"
    return 1
  fi
  printf '%s\n' "$allowlist_dir"
}

k_validate_host_contract() {
  local report_path="${K_EVIDENCE_DIR:-$K_DEPLOY_ROOT/k-evidence}/host-contract.json"
  local isolation_report="${K_EVIDENCE_DIR:-$K_DEPLOY_ROOT/k-evidence}/host-isolation.env"
  local effective_path=""
  local actual_daemon_id=""
  local actual_device_sha256=""
  local host_node_observed=absent
  local host_npm_observed=absent
  local operator_path="${PATH:-}"

  mkdir -p "$(dirname "$report_path")"
  if PATH="$operator_path" command -v node >/dev/null 2>&1; then host_node_observed=present; fi
  if PATH="$operator_path" command -v npm >/dev/null 2>&1; then host_npm_observed=present; fi
  k_validate_configured_path K_GATEWAY_DOWNLOAD_HOST_ROOT || return 1
  [ -d "$K_GATEWAY_DOWNLOAD_HOST_ROOT" ] || {
    k_error "Production gateway bind-mount root is missing: $K_GATEWAY_DOWNLOAD_HOST_ROOT"
    return 1
  }
  [ ! -L "$K_GATEWAY_DOWNLOAD_HOST_ROOT" ] || {
    k_error 'Production gateway bind-mount root must not be a symlink'
    return 1
  }
  effective_path="$(k_build_effective_host_path)" || return 1
  K_EFFECTIVE_HOST_PATH="$effective_path"
  if ! PRODUCTION_HOST_NETWORK_URL="$K_NETWORK_PREFLIGHT_URL" \
    PATH="$effective_path" production_host_contract_validate \
    "$K_DEPLOY_ROOT" "${K_DISK_THRESHOLD_PERCENT:-80}" "$report_path"; then
    rm -rf "$effective_path"
    return 1
  fi
  if PATH="$effective_path" command -v node >/dev/null 2>&1 ||
    PATH="$effective_path" command -v npm >/dev/null 2>&1; then
    rm -rf "$effective_path"
    k_error 'Host Node/npm exclusion was not proven'
    return 1
  fi
  actual_daemon_id="$(PATH="$effective_path" docker info --format '{{.ID}}' 2>/dev/null | tr -d '\r\n')" || {
    rm -rf "$effective_path"
    k_error 'Unable to identify the Docker daemon used by the staging-equivalent host'
    return 1
  }
  [ "$actual_daemon_id" = "$K_DOCKER_DAEMON_ID" ] || {
    rm -rf "$effective_path"
    k_error 'Docker daemon identity does not match the durable staging-equivalent fence'
    return 1
  }
  actual_device_sha256="$(PATH="$effective_path" k_hash_filesystem_device "$K_GATEWAY_DOWNLOAD_HOST_ROOT")" || {
    rm -rf "$effective_path"
    k_error 'Unable to identify the filesystem backing the production bind-mount root'
    return 1
  }
  [ "$actual_device_sha256" = "$K_GATEWAY_DOWNLOAD_DEVICE_SHA256" ] || {
    rm -rf "$effective_path"
    k_error 'Gateway bind-mount filesystem identity does not match the durable fence'
    return 1
  }
  umask 077
  {
    printf 'STAGING_EQUIVALENT_DOCKER_DAEMON_ID=%s\n' "$actual_daemon_id"
    printf 'STAGING_EQUIVALENT_GATEWAY_DOWNLOAD_DEVICE_SHA256=%s\n' "$actual_device_sha256"
    printf 'STAGING_EQUIVALENT_COMPOSE_PROJECT=%s\n' "$K_COMPOSE_PROJECT"
    printf 'HOST_NODE_OBSERVED=%s\n' "$host_node_observed"
    printf 'HOST_NPM_OBSERVED=%s\n' "$host_npm_observed"
    printf 'EFFECTIVE_HOST_NODE=unavailable\n'
    printf 'EFFECTIVE_HOST_NPM=unavailable\n'
    printf 'STAGING_EQUIVALENT_HOST_NODE_NPM_UNAVAILABLE=true\n'
  } > "$isolation_report"
  chmod 600 "$isolation_report"
  K_HOST_NODE_NPM_UNAVAILABLE=true
  K_HOST_NODE_OBSERVED="$host_node_observed"
  K_HOST_NPM_OBSERVED="$host_npm_observed"
  K_DOCKER_DAEMON_ID_OBSERVED="$actual_daemon_id"
  K_GATEWAY_DOWNLOAD_DEVICE_SHA256_OBSERVED="$actual_device_sha256"
  PATH="$effective_path"
  export K_EFFECTIVE_HOST_PATH K_HOST_NODE_NPM_UNAVAILABLE PATH
  export K_HOST_NODE_OBSERVED K_HOST_NPM_OBSERVED
  export K_DOCKER_DAEMON_ID_OBSERVED K_GATEWAY_DOWNLOAD_DEVICE_SHA256_OBSERVED
}

k_require_clean_worktree() {
  local app_dir="${K_APP_DIR:-}"
  local status=""

  [ -e "$app_dir/.git" ] && [ ! -L "$app_dir/.git" ] || {
    k_error "Application checkout is missing or has a symlinked .git: $app_dir"
    return 1
  }
  if [ -e "$app_dir/config/.env.bak-billingfix-20260623" ]; then
    k_error 'Protected config/.env.bak-billingfix-20260623 is present; refusing to touch this worktree'
    return 1
  fi
  status="$(git -C "$app_dir" status --porcelain=v1 --untracked-files=all)"
  [ -z "$status" ] || {
    k_error 'Application checkout is not clean; refusing to let git clean remove operator files'
    printf '%s\n' "$status" >&2
    return 1
  }
}

k_validate_app_path() {
  local app_dir="$1"
  local deploy_root_real=""
  local app_dir_real=""

  [ -n "$app_dir" ] || { k_error 'Application checkout path is required'; return 1; }
  [[ "$app_dir" = /* ]] || { k_error 'Application checkout path must be absolute'; return 1; }
  deploy_root_real="$(k_canonical_dir "$K_DEPLOY_ROOT")" || return 1
  if [ -e "$app_dir" ]; then
    app_dir_real="$(k_canonical_dir "$app_dir")" || return 1
  else
    app_dir_real="$(k_canonical_dir "$(dirname "$app_dir")")/${app_dir##*/}"
  fi
  k_is_under "$app_dir_real" "$deploy_root_real" || {
    k_error 'Application checkout must remain below the fenced deploy root'
    return 1
  }
  [ "$app_dir_real" != "$deploy_root_real" ] || {
    k_error 'Application checkout must not be the deploy root itself'
    return 1
  }
}

k_checkout_exact_release() {
  local app_dir="$1"
  local release_sha="$2"
  local source_url="${3:-${K_REPOSITORY_URL:-}}"
  local actual_sha=""
  local expected_openpath="${4:-}"

  k_require_sha40 release_sha "$release_sha" || return 1
  k_validate_app_path "$app_dir" || return 1
  if [ -e "$app_dir" ]; then
    [ -e "$app_dir/.git" ] || {
      k_error "Existing application path is not a Git checkout: $app_dir"
      return 1
    }
    K_APP_DIR="$app_dir"
    k_require_clean_worktree || return 1
  else
    [ -n "$source_url" ] || {
      k_error 'K_REPOSITORY_URL is required to create the exact release checkout'
      return 1
    }
    mkdir -p "$(dirname "$app_dir")"
    git clone --no-tags --no-checkout "$source_url" "$app_dir" || return 1
  fi
  git -C "$app_dir" fetch --no-tags origin "$release_sha" || {
    k_error "Exact release object is unavailable from origin: $release_sha"
    return 1
  }
  git -C "$app_dir" cat-file -e "$release_sha^{commit}" || {
    k_error "Exact release commit is not present after fetch: $release_sha"
    return 1
  }
  git -C "$app_dir" checkout --detach "$release_sha" || return 1
  git -C "$app_dir" submodule sync --recursive || return 1
  git -C "$app_dir" submodule update --init --recursive --force || return 1
  actual_sha="$(git -C "$app_dir" rev-parse HEAD)" || return 1
  [ "$actual_sha" = "$release_sha" ] || {
    k_error 'Checkout identity differs from the requested exact SHA'
    return 1
  }
  if [ -n "$expected_openpath" ]; then
    k_require_sha40 expected_openpath "$expected_openpath" || return 1
    actual_sha="$(git -C "$app_dir" rev-parse HEAD:upstream/openpath)" || return 1
    [ "$actual_sha" = "$expected_openpath" ] || {
      k_error 'Checked-out OpenPath gitlink differs from the Release Bundle'
      return 1
    }
  fi
  K_APP_DIR="$app_dir"
  export K_APP_DIR
  k_require_clean_worktree
}

k_set_topology_expectations() {
  local app_dir="${K_APP_DIR:-}"
  local firefox_root="${K_FIREFOX_RELEASE_HOST_ROOT:-}"
  local gateway_download_root="${K_GATEWAY_DOWNLOAD_HOST_ROOT:-}"

  k_validate_configured_path K_GATEWAY_DOWNLOAD_HOST_ROOT || return 1
  [ "$gateway_download_root" = /srv/classroompath/downloads ] || {
    k_error 'K_GATEWAY_DOWNLOAD_HOST_ROOT must preserve the production bind-mount path'
    return 1
  }
  [ -d "$gateway_download_root" ] || {
    k_error "Production gateway bind-mount root is missing: $gateway_download_root"
    return 1
  }
  [ ! -L "$gateway_download_root" ] || {
    k_error 'Production gateway bind-mount root must not be a symlink'
    return 1
  }
  k_validate_configured_path K_FIREFOX_RELEASE_HOST_ROOT || return 1
  k_validate_configured_path K_DEPLOY_ROOT || return 1
  [ -n "$app_dir" ] || { k_error 'K_APP_DIR is required for topology expectations'; return 1; }
  [ -n "$firefox_root" ] || return 1

  K_EXPECTED_NETWORKS="${K_COMPOSE_PROJECT}_openpath_default"
  K_EXPECTED_API_DATA_VOLUME="${K_COMPOSE_PROJECT}_api-data"
  K_EXPECTED_TEMPLATES_VOLUME="${K_COMPOSE_PROJECT}_windows_offline_installer_templates"
  K_EXPECTED_ARTIFACTS_VOLUME="${K_COMPOSE_PROJECT}_windows_offline_installer_artifacts"
  K_EXPECTED_GATEWAY_NAME=classroompath-gateway
  K_EXPECTED_API_NAME=classroompath-api
  K_EXPECTED_SPA_NAME=classroompath-spa
  K_EXPECTED_PROVISION_NAME=classroompath-openpath-windows-offline-installer-provision
  K_EXPECTED_GATEWAY_DOWNLOAD_MOUNT="$gateway_download_root|/app/react-spa/dist/downloads|ro"
  K_EXPECTED_API_MOUNT="$K_EXPECTED_API_DATA_VOLUME|/app/data|rw"
  K_EXPECTED_PROVISION_TEMPLATES_MOUNT="$K_EXPECTED_TEMPLATES_VOLUME|/app/var/windows-offline-installer/templates|rw"
  K_EXPECTED_API_TEMPLATES_MOUNT="$K_EXPECTED_TEMPLATES_VOLUME|/app/var/windows-offline-installer/templates|ro"
  K_EXPECTED_API_ARTIFACTS_MOUNT="$K_EXPECTED_ARTIFACTS_VOLUME|/app/var/windows-offline-installer/artifacts|rw"
  K_EXPECTED_API_FIREFOX_MOUNT="$firefox_root/current|/openpath-firefox-release|ro"
  K_EXPECTED_SPA_MOUNT="$app_dir/docker/spa-nginx.conf|/etc/nginx/conf.d/default.conf|ro"
  export K_EXPECTED_NETWORKS K_EXPECTED_API_DATA_VOLUME K_EXPECTED_TEMPLATES_VOLUME
  export K_EXPECTED_ARTIFACTS_VOLUME K_EXPECTED_GATEWAY_NAME K_EXPECTED_API_NAME
  export K_EXPECTED_SPA_NAME K_EXPECTED_PROVISION_NAME
  export K_EXPECTED_GATEWAY_DOWNLOAD_MOUNT K_EXPECTED_API_MOUNT
  export K_EXPECTED_PROVISION_TEMPLATES_MOUNT K_EXPECTED_API_TEMPLATES_MOUNT
  export K_EXPECTED_API_ARTIFACTS_MOUNT K_EXPECTED_API_FIREFOX_MOUNT K_EXPECTED_SPA_MOUNT
}

k_require_mutation_confirmation() {
  [ "${K_CONFIRM_STAGING_EQUIVALENT:-0}" = 1 ] || {
    k_error 'Mutating commands require --confirm-staging-equivalent'
    return 1
  }
  k_validate_environment
}

k_require_config_value() {
  local name="$1"
  [ -n "${!name:-}" ] || { k_error "$name is required in the harness config"; return 1; }
}

k_compare_snapshot_value() {
  local config_name="$1"
  local snapshot_file="$2"
  local snapshot_name="$3"
  local expected="${!config_name:-}"
  local actual=""

  [ -n "$expected" ] || { k_error "$config_name is required for K0"; return 1; }
  actual="$(k_read_required_file_value "$snapshot_file" "$snapshot_name")" || return 1
  [ "$actual" = "$expected" ] || {
    k_error "K0 mismatch for $snapshot_name: expected=$expected actual=$actual"
    return 1
  }
}

k_require_snapshot_field() {
  k_read_required_file_value "$1" "$2" >/dev/null
}

k_validate_snapshot_no_secrets() {
  local snapshot_file="$1"
  local line=""

  while IFS= read -r line || [ -n "$line" ]; do
    if k_contains_secret_shape "$line"; then
      k_error "Snapshot contains secret-shaped content: $snapshot_file"
      return 1
    fi
    [ "${#line}" -le "$K_HARNESS_MAX_RECORD_BYTES" ] || {
      k_error 'Snapshot field exceeds bounded evidence size'
      return 1
    }
  done < "$snapshot_file"
}

k_validate_attestation() {
  local snapshot_file="$1"
  local baseline_file="${2:-}"
  local service=""
  local image=""
  local expected_image=""
  local image_field=""
  local prefix=""
  local field=""
  local expected_service=""
  local expected_name_var=""
  local volume_prefix=""
  local durable_state_required="${K_ATTESTATION_DURABLE_STATE_REQUIRED:-1}"

  [ -f "$snapshot_file" ] || { k_error "K0 snapshot is missing: $snapshot_file"; return 1; }
  k_validate_snapshot_no_secrets "$snapshot_file" || return 1
  k_validate_topology_config || return 1
  if [ "$durable_state_required" = 1 ]; then
    k_compare_snapshot_value K_EXPECTED_RELEASE_ID "$snapshot_file" STATE_CURRENT_RELEASE_ID || return 1
    k_compare_snapshot_value K_EXPECTED_BUNDLE_SHA256 "$snapshot_file" DURABLE_BUNDLE_SHA256 || return 1
    k_compare_snapshot_value K_EXPECTED_CONTRACT_SHA256 "$snapshot_file" DURABLE_CONTRACT_SHA256 || return 1
    k_compare_snapshot_value K_EXPECTED_RUNTIME_SHA256 "$snapshot_file" DURABLE_RUNTIME_SHA256 || return 1
    k_compare_snapshot_value K_EXPECTED_RC_RUN_ID "$snapshot_file" DURABLE_RC_RUN_ID || return 1
  else
    k_compare_snapshot_value K_EXPECTED_RELEASE_ID "$snapshot_file" LIVE_EXPECTED_RELEASE_ID || return 1
    k_compare_snapshot_value K_EXPECTED_BUNDLE_SHA256 "$snapshot_file" LIVE_EXPECTED_BUNDLE_SHA256 || return 1
    k_compare_snapshot_value K_EXPECTED_CONTRACT_SHA256 "$snapshot_file" LIVE_EXPECTED_CONTRACT_SHA256 || return 1
    k_compare_snapshot_value K_EXPECTED_RC_RUN_ID "$snapshot_file" LIVE_EXPECTED_RC_RUN_ID || return 1
  fi
  k_compare_snapshot_value K_EXPECTED_APP_SHA "$snapshot_file" LIVE_CHECKOUT_SHA || return 1
  k_compare_snapshot_value K_EXPECTED_OPENPATH_SHA "$snapshot_file" LIVE_OPENPATH_GITLINK_SHA || return 1
  k_compare_snapshot_value K_EXPECTED_RUNTIME_PROJECTION_SHA256 "$snapshot_file" LIVE_RUNTIME_PROJECTION_SHA256 || return 1
  k_compare_snapshot_value K_EXPECTED_NETWORKS "$snapshot_file" LIVE_GATEWAY_NETWORKS || return 1
  k_compare_snapshot_value K_EXPECTED_NETWORKS "$snapshot_file" LIVE_API_NETWORKS || return 1
  k_compare_snapshot_value K_EXPECTED_NETWORKS "$snapshot_file" LIVE_SPA_NETWORKS || return 1
  k_compare_snapshot_value K_EXPECTED_NETWORKS "$snapshot_file" LIVE_PROVISION_NETWORKS || return 1
  k_compare_snapshot_value K_EXPECTED_API_DATA_VOLUME "$snapshot_file" LIVE_VOLUME_API_DATA_ID || return 1
  k_compare_snapshot_value K_EXPECTED_TEMPLATES_VOLUME "$snapshot_file" LIVE_VOLUME_TEMPLATES_ID || return 1
  k_compare_snapshot_value K_EXPECTED_ARTIFACTS_VOLUME "$snapshot_file" LIVE_VOLUME_ARTIFACTS_ID || return 1
  k_compare_snapshot_value K_EXPECTED_API_DATA_VOLUME "$snapshot_file" LIVE_VOLUME_API_DATA_NAME || return 1
  k_compare_snapshot_value K_EXPECTED_TEMPLATES_VOLUME "$snapshot_file" LIVE_VOLUME_TEMPLATES_NAME || return 1
  k_compare_snapshot_value K_EXPECTED_ARTIFACTS_VOLUME "$snapshot_file" LIVE_VOLUME_ARTIFACTS_NAME || return 1
  for volume_prefix in API_DATA TEMPLATES ARTIFACTS; do
    k_compare_snapshot_value K_COMPOSE_PROJECT "$snapshot_file" "LIVE_VOLUME_${volume_prefix}_PROJECT" || return 1
  done
  [ "$(k_read_required_file_value "$snapshot_file" LIVE_VOLUME_API_DATA_COMPOSE_KEY)" = api-data ] || return 1
  [ "$(k_read_required_file_value "$snapshot_file" LIVE_VOLUME_TEMPLATES_COMPOSE_KEY)" = windows_offline_installer_templates ] || return 1
  [ "$(k_read_required_file_value "$snapshot_file" LIVE_VOLUME_ARTIFACTS_COMPOSE_KEY)" = windows_offline_installer_artifacts ] || return 1
  for field in LIVE_VOLUME_API_DATA_NAME LIVE_VOLUME_API_DATA_MOUNTPOINT \
    LIVE_VOLUME_TEMPLATES_NAME LIVE_VOLUME_TEMPLATES_MOUNTPOINT \
    LIVE_VOLUME_ARTIFACTS_NAME LIVE_VOLUME_ARTIFACTS_MOUNTPOINT; do
    k_require_snapshot_field "$snapshot_file" "$field" || return 1
  done
  k_compare_snapshot_value K_EXPECTED_GATEWAY_DOWNLOAD_MOUNT "$snapshot_file" LIVE_GATEWAY_MOUNTS || return 1
  k_compare_snapshot_value K_EXPECTED_API_MOUNT "$snapshot_file" LIVE_API_DATA_MOUNT || return 1
  k_compare_snapshot_value K_EXPECTED_PROVISION_TEMPLATES_MOUNT "$snapshot_file" LIVE_PROVISION_TEMPLATES_MOUNT || return 1
  k_compare_snapshot_value K_EXPECTED_API_TEMPLATES_MOUNT "$snapshot_file" LIVE_API_TEMPLATES_MOUNT || return 1
  k_compare_snapshot_value K_EXPECTED_API_ARTIFACTS_MOUNT "$snapshot_file" LIVE_API_ARTIFACTS_MOUNT || return 1
  k_compare_snapshot_value K_EXPECTED_API_FIREFOX_MOUNT "$snapshot_file" LIVE_API_FIREFOX_MOUNT || return 1
  k_compare_snapshot_value K_EXPECTED_SPA_MOUNT "$snapshot_file" LIVE_SPA_MOUNTS || return 1
  [ "$(k_read_required_file_value "$snapshot_file" LIVE_PROJECT)" = "$K_COMPOSE_PROJECT" ] || {
    k_error 'K0 live Docker project is not classroompath-production'
    return 1
  }
  [ "$(k_read_required_file_value "$snapshot_file" HEALTH_HTTP_STATUS)" = 200 ] || {
    k_error 'K0 health endpoint did not return HTTP 200'
    return 1
  }
  [ "$(k_read_required_file_value "$snapshot_file" READY_HTTP_STATUS)" = 200 ] || {
    k_error 'K0 readiness endpoint did not return HTTP 200'
    return 1
  }
  [ "$(k_read_required_file_value "$snapshot_file" READY_JSON_VALID)" = true ] || {
    k_error 'K0 readiness response was not valid JSON'
    return 1
  }
  [ "$(k_read_required_file_value "$snapshot_file" READY)" = true ] || {
    k_error 'K0 readiness JSON did not contain ready=true'
    return 1
  }
  [ "$(k_read_required_file_value "$snapshot_file" WORKTREE_CLEAN)" = true ] || {
    k_error 'K0 checkout is not clean'
    return 1
  }

  # These statuses are part of the production Compose topology, not operator
  # supplied evidence expectations. Keep them fixed so a config file cannot
  # make a stopped runtime look like a valid baseline.
  K_EXPECTED_SERVICE_STATUS_GATEWAY=running
  K_EXPECTED_SERVICE_STATUS_API=running
  K_EXPECTED_SERVICE_STATUS_SPA=running
  K_EXPECTED_SERVICE_STATUS_PROVISION=exited
  export K_EXPECTED_SERVICE_STATUS_GATEWAY K_EXPECTED_SERVICE_STATUS_API
  export K_EXPECTED_SERVICE_STATUS_SPA K_EXPECTED_SERVICE_STATUS_PROVISION

  for service in gateway api spa provision; do
    case "$service" in
      gateway) prefix=GATEWAY; expected_service=gateway; expected_name_var=K_EXPECTED_GATEWAY_NAME; expected_image="$K_EXPECTED_GATEWAY_IMAGE"; image_field=LIVE_GATEWAY_IMAGE ;;
      api) prefix=API; expected_service=api; expected_name_var=K_EXPECTED_API_NAME; expected_image="$K_EXPECTED_API_IMAGE"; image_field=LIVE_API_IMAGE ;;
      spa) prefix=SPA; expected_service=spa; expected_name_var=K_EXPECTED_SPA_NAME; expected_image="$K_EXPECTED_SPA_IMAGE"; image_field=LIVE_SPA_IMAGE ;;
      provision) prefix=PROVISION; expected_service=windows-offline-installer-provision; expected_name_var=K_EXPECTED_PROVISION_NAME; expected_image="$K_EXPECTED_API_IMAGE"; image_field=LIVE_PROVISION_IMAGE ;;
    esac
    k_require_immutable_image "expected $service image" "$expected_image" || return 1
    image="$(k_read_required_file_value "$snapshot_file" "$image_field")" || return 1
    [ "$image" = "$expected_image" ] || { k_error "K0 $service image differs"; return 1; }
    image="$(k_read_required_file_value "$snapshot_file" "LIVE_${prefix}_IMAGE_DIGEST")" || return 1
    [ "$image" = "$expected_image" ] || { k_error "K0 $service RepoDigest differs"; return 1; }
    k_require_snapshot_field "$snapshot_file" "LIVE_${prefix}_ID" || return 1
    k_compare_snapshot_value "$expected_name_var" "$snapshot_file" "LIVE_${prefix}_NAME" || return 1
    [ "$(k_read_required_file_value "$snapshot_file" "LIVE_${prefix}_PROJECT")" = "$K_COMPOSE_PROJECT" ] || {
      k_error "K0 $service container project label differs"
      return 1
    }
    [ "$(k_read_required_file_value "$snapshot_file" "LIVE_${prefix}_SERVICE")" = "$expected_service" ] || {
      k_error "K0 $service container service label differs"
      return 1
    }
    k_compare_snapshot_value "K_EXPECTED_SERVICE_STATUS_$prefix" "$snapshot_file" "LIVE_${prefix}_STATUS" || return 1
  done

  if [ -n "$baseline_file" ]; then
    for field in LIVE_VOLUME_API_DATA_ID LIVE_VOLUME_API_DATA_NAME LIVE_VOLUME_API_DATA_MOUNTPOINT \
      LIVE_VOLUME_API_DATA_PROJECT LIVE_VOLUME_API_DATA_COMPOSE_KEY \
      LIVE_VOLUME_TEMPLATES_ID LIVE_VOLUME_TEMPLATES_NAME LIVE_VOLUME_TEMPLATES_MOUNTPOINT \
      LIVE_VOLUME_TEMPLATES_PROJECT LIVE_VOLUME_TEMPLATES_COMPOSE_KEY \
      LIVE_VOLUME_ARTIFACTS_ID LIVE_VOLUME_ARTIFACTS_NAME LIVE_VOLUME_ARTIFACTS_MOUNTPOINT \
      LIVE_VOLUME_ARTIFACTS_PROJECT LIVE_VOLUME_ARTIFACTS_COMPOSE_KEY \
      LIVE_GATEWAY_MOUNTS LIVE_API_DATA_MOUNT LIVE_PROVISION_TEMPLATES_MOUNT \
      LIVE_API_TEMPLATES_MOUNT LIVE_API_ARTIFACTS_MOUNT LIVE_API_FIREFOX_MOUNT; do
      [ "$(k_read_required_file_value "$snapshot_file" "$field")" = \
        "$(k_read_required_file_value "$baseline_file" "$field")" ] || {
        k_error "K0 persistent topology differs from baseline: $field"
        return 1
      }
    done
  fi
  k_info "K0 attestation passed for release $(k_read_file_value "$snapshot_file" STATE_CURRENT_RELEASE_ID)"
}

k_validate_live_attestation() {
  local previous_requirement="${K_ATTESTATION_DURABLE_STATE_REQUIRED:-1}"
  K_ATTESTATION_DURABLE_STATE_REQUIRED=0
  if k_validate_attestation "$1" "${2:-}"; then
    K_ATTESTATION_DURABLE_STATE_REQUIRED="$previous_requirement"
    export K_ATTESTATION_DURABLE_STATE_REQUIRED
    return 0
  fi
  local status="$?"
  K_ATTESTATION_DURABLE_STATE_REQUIRED="$previous_requirement"
  export K_ATTESTATION_DURABLE_STATE_REQUIRED
  return "$status"
}

k_validate_release_inputs() {
  local prefix="$1"
  local bundle_var="K_${prefix}_BUNDLE_FILE"
  local contract_var="K_${prefix}_CONTRACT_FILE"
  local release_var="K_${prefix}_RELEASE_ID"
  local verifier_var="K_${prefix}_VERIFIER_IMAGE"
  local bundle="${!bundle_var:-}"
  local contract="${!contract_var:-}"
  local release_id="${!release_var:-}"
  local verifier="${!verifier_var:-}"

  k_require_config_value "$bundle_var" || return 1
  k_require_config_value "$contract_var" || return 1
  k_require_config_value "$release_var" || return 1
  k_require_config_value "$verifier_var" || return 1
  k_validate_external_file "$bundle" "$bundle_var" || return 1
  k_validate_external_file "$contract" "$contract_var" || return 1
  k_require_sha64 "$release_var" "$release_id" || return 1
  k_require_immutable_image "$verifier_var" "$verifier" || return 1
}

k_validate_release_identity() {
  local prefix="$1"
  local bundle_var="K_${prefix}_BUNDLE_FILE"
  local contract_var="K_${prefix}_CONTRACT_FILE"
  local release_var="K_${prefix}_RELEASE_ID"
  local bundle_sha_var="K_${prefix}_BUNDLE_SHA256"
  local contract_sha_var="K_${prefix}_CONTRACT_SHA256"
  local app_sha_var="K_${prefix}_APP_SHA"
  local openpath_sha_var="K_${prefix}_OPENPATH_SHA"
  local rc_run_id_var="K_${prefix}_RC_RUN_ID"
  local bundle="${!bundle_var:-}"
  local contract="${!contract_var:-}"
  local release_id="${!release_var:-}"
  local bundle_sha="${!bundle_sha_var:-}"
  local contract_sha="${!contract_sha_var:-}"
  local app_sha="${!app_sha_var:-}"
  local openpath_sha="${!openpath_sha_var:-}"
  local rc_run_id="${!rc_run_id_var:-}"
  local actual_sha=""

  k_validate_release_inputs "$prefix" || return 1
  k_require_config_value "$bundle_sha_var" || return 1
  k_require_config_value "$contract_sha_var" || return 1
  k_require_config_value "$app_sha_var" || return 1
  k_require_config_value "$openpath_sha_var" || return 1
  k_require_config_value "$rc_run_id_var" || return 1
  k_require_sha64 "$bundle_sha_var" "$bundle_sha" || return 1
  k_require_sha64 "$contract_sha_var" "$contract_sha" || return 1
  k_require_sha40 "$app_sha_var" "$app_sha" || return 1
  k_require_sha40 "$openpath_sha_var" "$openpath_sha" || return 1
  [[ "$rc_run_id" =~ ^[0-9]+$ ]] || {
    k_error "$rc_run_id_var must be numeric"
    return 1
  }
  actual_sha="$(k_hash_file "$bundle")" || return 1
  [ "$actual_sha" = "$release_id" ] || {
    k_error "$bundle_var bytes do not hash to its exact releaseId"
    return 1
  }
  [ "$actual_sha" = "$bundle_sha" ] || {
    k_error "$bundle_var hash does not match its recorded identity"
    return 1
  }
  actual_sha="$(k_hash_file "$contract")" || return 1
  [ "$actual_sha" = "$contract_sha" ] || {
    k_error "$contract_var hash does not match its recorded identity"
    return 1
  }
}

k_validate_runtime_projection_file() {
  local runtime_file="$1"
  local require_rc_run_id="${2:-1}"
  local line=""
  local key=""
  local value=""
  local expected_key=""
  local known=0
  local -A seen=()

  [ -s "$runtime_file" ] || {
    k_error "Verifier runtime projection is missing: $runtime_file"
    return 1
  }
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" == *=* ]] || {
      k_error "Runtime projection contains a non-assignment line: $runtime_file"
      return 1
    }
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || {
      k_error "Runtime projection key is invalid: $key"
      return 1
    }
    known=0
    for expected_key in "${K_RUNTIME_PROJECTION_KEYS[@]}"; do
      [ "$key" = "$expected_key" ] && known=1
    done
    [ "$known" -eq 1 ] || {
      k_error "Runtime projection contains an unexpected key: $key"
      return 1
    }
    [ -z "${seen[$key]+present}" ] || {
      k_error "Runtime projection contains a duplicate key: $key"
      return 1
    }
    [[ "$value" =~ $K_RUNTIME_PROJECTION_VALUE_RE ]] || {
      k_error "Runtime projection contains an unsafe value for $key"
      return 1
    }
    seen["$key"]=1
  done < "$runtime_file"
  for expected_key in "${K_RUNTIME_PROJECTION_KEYS[@]}"; do
    if [ "$expected_key" = RC_RUN_ID ] && [ "$require_rc_run_id" = 0 ]; then
      continue
    fi
    [ -n "${seen[$expected_key]+present}" ] || {
      k_error "Runtime projection is missing $expected_key"
      return 1
    }
  done
}

k_hash_runtime_projection_file() {
  local runtime_file="$1"
  local normalized_file="$2"
  local key=""

  k_validate_runtime_projection_file "$runtime_file" || return 1
  : > "$normalized_file"
  for key in "${K_RUNTIME_PROJECTION_KEYS[@]}"; do
    printf '%s=%s\n' "$key" "$(k_read_required_file_value "$runtime_file" "$key")" >> "$normalized_file"
  done
  k_hash_file "$normalized_file"
}

k_validate_runtime_projection() {
  local prefix="$1"
  local runtime_file="$2"
  local field=""
  local expected=""
  local actual=""
  local release_var="K_${prefix}_RELEASE_ID"
  local app_var="K_${prefix}_APP_SHA"
  local openpath_var="K_${prefix}_OPENPATH_SHA"
  local contract_var="K_${prefix}_CONTRACT_SHA256"
  local verifier_var="K_${prefix}_VERIFIER_IMAGE"
  local runtime_hash_var="K_${prefix}_VERIFIER_RUNTIME_SHA256"
  local -a mappings=(
    "RELEASE_ID|$release_var"
    "APP_SHA|$app_var"
    "OPENPATH_SHA|$openpath_var"
    "OPENPATH_CONTRACT_SHA256|$contract_var"
    "RC_RUN_ID|K_${prefix}_RC_RUN_ID"
    "CLASSROOMPATH_GATEWAY_IMAGE|K_${prefix}_GATEWAY_IMAGE"
    "CLASSROOMPATH_MIGRATIONS_IMAGE|K_${prefix}_MIGRATIONS_IMAGE"
    "OPENPATH_FIREFOX_ASSETS_IMAGE|K_${prefix}_FIREFOX_ASSETS_IMAGE"
    "OPENPATH_API_IMAGE|K_${prefix}_OPENPATH_API_IMAGE"
    "CLASSROOMPATH_SPA_IMAGE|K_${prefix}_SPA_IMAGE"
    "CLASSROOMPATH_VERIFIER_IMAGE|$verifier_var"
  )
  local mapping=""
  local expected_name=""

  k_validate_runtime_projection_file "$runtime_file" || return 1
  actual="$(k_read_required_file_value "$runtime_file" IMAGE_SOURCE)" || return 1
  [ "$actual" = release-candidate ] || {
    k_error "$prefix runtime projection is not release-candidate"
    return 1
  }
  for mapping in "${mappings[@]}"; do
    field="${mapping%%|*}"
    expected_name="${mapping#*|}"
    expected="${!expected_name:-}"
    [ -n "$expected" ] || { k_error "$expected_name is required"; return 1; }
    actual="$(k_read_required_file_value "$runtime_file" "$field")" || return 1
    [ "$actual" = "$expected" ] || {
      k_error "$prefix runtime projection differs for $field"
      return 1
    }
  done
  for field in APP_SHA OPENPATH_SHA; do
    k_require_sha40 "$field" "$(k_read_required_file_value "$runtime_file" "$field")" || return 1
  done
  k_require_sha64 OPENPATH_CONTRACT_SHA256 "$(k_read_required_file_value "$runtime_file" OPENPATH_CONTRACT_SHA256)" || return 1
  for field in CLASSROOMPATH_GATEWAY_IMAGE CLASSROOMPATH_MIGRATIONS_IMAGE \
    OPENPATH_FIREFOX_ASSETS_IMAGE OPENPATH_API_IMAGE CLASSROOMPATH_SPA_IMAGE \
    CLASSROOMPATH_VERIFIER_IMAGE; do
    k_require_immutable_image "$field" "$(k_read_required_file_value "$runtime_file" "$field")" || return 1
  done
  if [ -n "${!runtime_hash_var:-}" ]; then
    k_require_sha64 "$runtime_hash_var" "${!runtime_hash_var}" || return 1
    [ "$(k_hash_file "$runtime_file")" = "${!runtime_hash_var}" ] || {
      k_error "$prefix verifier runtime projection hash differs"
      return 1
    }
  fi
}

k_verify_bundle_in_verifier() {
  local prefix="$1"
  local output_dir="$2"
  local bundle_var="K_${prefix}_BUNDLE_FILE"
  local contract_var="K_${prefix}_CONTRACT_FILE"
  local release_var="K_${prefix}_RELEASE_ID"
  local verifier_var="K_${prefix}_VERIFIER_IMAGE"
  local bundle="${!bundle_var:-}"
  local contract="${!contract_var:-}"
  local release_id="${!release_var:-}"
  local verifier="${!verifier_var:-}"
  local effective_path="${K_EFFECTIVE_HOST_PATH:-${PATH:-}}"
  local app_sha_var="K_${prefix}_APP_SHA"
  local rc_run_id_var="K_${prefix}_RC_RUN_ID"

  k_validate_release_identity "$prefix" || return 1
  mkdir -p "$output_dir"
  PATH="$effective_path" docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
    -v "$bundle:/tmp/classroompath-release-bundle.json:ro" \
    -v "$contract:/tmp/openpath-promotion-contract.json:ro" \
    -v "$output_dir:/tmp/classroompath-k-output:rw" \
    "$verifier" /app/scripts/release-bundle.mjs verify \
    --bundle-file /tmp/classroompath-release-bundle.json \
    --contract-file /tmp/openpath-promotion-contract.json \
    --release-id "$release_id" \
    --classroompath-sha "${!app_sha_var}" \
    --output-env /tmp/classroompath-k-output/runtime.env || {
      k_error "Immutable verifier rejected the exact $prefix Release Bundle"
      return 1
    }
  [ -s "$output_dir/runtime.env" ] || { k_error 'Verifier emitted no runtime projection'; return 1; }
  k_validate_runtime_projection_file "$output_dir/runtime.env" 0 || return 1
  printf 'RC_RUN_ID=%s\n' "${!rc_run_id_var:-}" >> "$output_dir/runtime.env"
  k_validate_runtime_projection "$prefix" "$output_dir/runtime.env" || return 1
  printf -v "K_${prefix}_VERIFIER_RUNTIME_FILE" '%s' "$output_dir/runtime.env"
  export "K_${prefix}_VERIFIER_RUNTIME_FILE"
}

k_source_common_helper() {
  local helper="$K_HARNESS_DIR/lib/common.sh"

  [ -f "$helper" ] || { k_error "Shared common helper is missing: $helper"; return 1; }
  # shellcheck source=lib/common.sh
  source "$helper"
}

k_validate_configured_path() {
  local name="$1"
  local path="${!name:-}"

  [ -n "$path" ] || { k_error "$name is required"; return 1; }
  [[ "$path" = /* ]] || { k_error "$name must be absolute"; return 1; }
  [ "$path" != / ] || { k_error "$name must not be filesystem root"; return 1; }
  [ ! -L "$path" ] || { k_error "$name must not be a symlink"; return 1; }
}

k_validate_evidence_path() {
  local path="$1"
  local label="$2"
  local evidence_real=""
  local candidate_real=""

  k_validate_configured_path K_EVIDENCE_DIR || return 1
  [[ "$path" = /* ]] || { k_error "$label must be absolute"; return 1; }
  [ -d "$K_EVIDENCE_DIR" ] || { k_error 'Bounded evidence directory does not exist'; return 1; }
  [ ! -L "$path" ] || { k_error "$label must not be a symlink"; return 1; }
  evidence_real="$(k_canonical_dir "$K_EVIDENCE_DIR")" || return 1
  if [ -d "$path" ]; then
    candidate_real="$(k_canonical_dir "$path")" || return 1
  else
    candidate_real="$(k_canonical_dir "$(dirname "$path")")/${path##*/}" || return 1
  fi
  k_is_under "$candidate_real" "$evidence_real" || {
    k_error "$label must remain inside the bounded evidence directory"
    return 1
  }
}

k_validate_runtime_secrets_path() {
  local app_dir="$1"

  k_validate_configured_path K_RUNTIME_SECRETS_FILE || return 1
  case "$K_RUNTIME_SECRETS_FILE" in
    "$app_dir"|"$app_dir"/*)
      k_error 'Runtime secrets must be outside APP_DIR'
      return 1
      ;;
  esac
  [ "${K_RUNTIME_SECRETS_FILE##*/}" != .env.bak-billingfix-20260623 ] || {
    k_error 'The protected billing backup file is not a runtime secrets source'
    return 1
  }
  k_validate_external_file "$K_RUNTIME_SECRETS_FILE" 'Runtime secrets file'
}

k_runtime_secret_value() {
  local expected_key="$1"
  local line=""
  local key=""
  local value=""
  local count=0

  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    [[ "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || {
      k_error 'Runtime secrets file contains an invalid assignment'
      return 1
    }
    key="${line%%=*}"
    value="${line#*=}"
    [ "$key" = "$expected_key" ] || continue
    count=$((count + 1))
    printf '%s\n' "$value"
  done < "$K_RUNTIME_SECRETS_FILE"
  [ "$count" -eq 1 ] || {
    k_error "Runtime secrets file must contain exactly one $expected_key assignment"
    return 1
  }
}

k_load_runtime_secrets() {
  local app_dir="${K_APP_DIR:-$K_DEPLOY_ROOT/app}"
  local ghcr_username=""
  local ghcr_token=""

  K_APP_DIR="$app_dir"
  export K_APP_DIR
  k_validate_database_endpoint "$app_dir" || return 1
  ghcr_username="$(k_runtime_secret_value GHCR_USERNAME)" || return 1
  ghcr_token="$(k_runtime_secret_value GHCR_TOKEN)" || return 1
  [ -n "$ghcr_username" ] || { k_error 'GHCR_USERNAME is empty in the private runtime secrets file'; return 1; }
  [ -n "$ghcr_token" ] || { k_error 'GHCR_TOKEN is empty in the private runtime secrets file'; return 1; }
  GHCR_USERNAME="$ghcr_username"
  GHCR_TOKEN="$ghcr_token"
  export GHCR_USERNAME GHCR_TOKEN
}

k_validate_database_endpoint() {
  local app_dir="$1"
  local database_url=""

  K_APP_DIR="$app_dir"
  export K_APP_DIR
  k_validate_runtime_secrets_path "$app_dir" || return 1
  database_url="$(k_runtime_secret_value DATABASE_URL)" || return 1
  [ "$(k_hash_text "$database_url")" = "$K_DATABASE_ENDPOINT_SHA256" ] || {
    k_error 'Private runtime DATABASE_URL does not match the fenced staging-equivalent database endpoint'
    return 1
  }
}

k_validate_firefox_release_root() {
  local root="${K_FIREFOX_RELEASE_HOST_ROOT:-}"
  local parent=""
  local root_real=""
  local deploy_root_real=""

  k_validate_configured_path K_FIREFOX_RELEASE_HOST_ROOT || return 1
  parent="$(dirname "$root")"
  deploy_root_real="$(k_canonical_dir "$K_DEPLOY_ROOT")" || return 1
  k_is_under "$parent" "$deploy_root_real" || {
    k_error 'K_FIREFOX_RELEASE_HOST_ROOT parent must be below K_DEPLOY_ROOT'
    return 1
  }
  mkdir -p "$parent"
  root_real="$(k_canonical_dir "$parent")/${root##*/}"
  k_is_under "$root_real" "$deploy_root_real" || {
    k_error 'K_FIREFOX_RELEASE_HOST_ROOT must be below K_DEPLOY_ROOT'
    return 1
  }
  [ "$root_real" != "$deploy_root_real" ] || {
    k_error 'K_FIREFOX_RELEASE_HOST_ROOT must not be K_DEPLOY_ROOT'
    return 1
  }
  mkdir -p "$root"
}

k_source_recovery_artifact_helper() {
  [ -f "$K_HARNESS_DIR/lib/production-recovery-artifact.sh" ] || {
    k_error 'Recovery artifact helper is missing'
    return 1
  }
  # shellcheck source=lib/production-recovery-artifact.sh
  source "$K_HARNESS_DIR/lib/production-recovery-artifact.sh"
}

k_load_runtime_projection() {
  local runtime_file="$1"
  local key=""
  local value=""

  k_validate_runtime_projection_file "$runtime_file" || return 1
  for key in "${K_RUNTIME_PROJECTION_KEYS[@]}"; do
    value="$(k_read_required_file_value "$runtime_file" "$key")" || return 1
    printf -v "$key" '%s' "$value"
    # shellcheck disable=SC2163 # key is a validated runtime variable name.
    export "$key"
  done
  export OPENPATH_FIREFOX_RELEASE_DIR="$K_FIREFOX_RELEASE_HOST_ROOT/current"
  export OPENPATH_FIREFOX_RELEASE_ROOT=/openpath-firefox-release
}

k_apply_runtime_projection() {
  local runtime_file="$1"
  local env_file="$2"
  local key=""
  local value=""

  k_validate_runtime_projection_file "$runtime_file" || return 1
  k_source_common_helper || return 1
  for key in "${K_RUNTIME_PROJECTION_KEYS[@]}"; do
    value="$(k_read_required_file_value "$runtime_file" "$key")" || return 1
    upsert_env_file_var "$env_file" "$key" "$value" || return 1
  done
  upsert_env_file_var "$env_file" OPENPATH_FIREFOX_RELEASE_DIR "$K_FIREFOX_RELEASE_HOST_ROOT/current" || return 1
  upsert_env_file_var "$env_file" OPENPATH_FIREFOX_RELEASE_ROOT /openpath-firefox-release || return 1
  k_load_runtime_projection "$runtime_file"
}

k_set_expected_value() {
  local target="$1"
  local source="$2"
  local value="${!source:-}"

  [ -n "$value" ] || { k_error "$source is required for K0"; return 1; }
  printf -v "$target" '%s' "$value"
  # shellcheck disable=SC2163 # target is a validated harness variable name.
  export "$target"
}

k_set_attestation_expectations() {
  local prefix="$1"
  local release_var="K_${prefix}_RELEASE_ID"
  local bundle_sha_var="K_${prefix}_BUNDLE_SHA256"
  local contract_sha_var="K_${prefix}_CONTRACT_SHA256"
  local app_var="K_${prefix}_APP_SHA"
  local openpath_var="K_${prefix}_OPENPATH_SHA"
  local rc_var="K_${prefix}_RC_RUN_ID"
  local gateway_var="K_${prefix}_GATEWAY_IMAGE"
  local api_var="K_${prefix}_OPENPATH_API_IMAGE"
  local spa_var="K_${prefix}_SPA_IMAGE"
  local verifier_var="K_${prefix}_VERIFIER_IMAGE"
  local verifier_file_var="K_${prefix}_VERIFIER_RUNTIME_FILE"
  local verifier_file="${!verifier_file_var:-}"
  local normalized_file=""
  local runtime_hash=""

  k_set_expected_value K_EXPECTED_RELEASE_ID "$release_var" || return 1
  k_set_expected_value K_EXPECTED_BUNDLE_SHA256 "$bundle_sha_var" || return 1
  k_set_expected_value K_EXPECTED_CONTRACT_SHA256 "$contract_sha_var" || return 1
  k_set_expected_value K_EXPECTED_APP_SHA "$app_var" || return 1
  k_set_expected_value K_EXPECTED_OPENPATH_SHA "$openpath_var" || return 1
  k_set_expected_value K_EXPECTED_RC_RUN_ID "$rc_var" || return 1
  k_set_expected_value K_EXPECTED_GATEWAY_IMAGE "$gateway_var" || return 1
  k_set_expected_value K_EXPECTED_API_IMAGE "$api_var" || return 1
  k_set_expected_value K_EXPECTED_SPA_IMAGE "$spa_var" || return 1
  k_set_expected_value K_EXPECTED_VERIFIER_IMAGE "$verifier_var" || return 1
  if [ -n "$verifier_file" ]; then
    normalized_file="$K_EVIDENCE_DIR/${prefix}-runtime-projection.normalized"
    runtime_hash="$(k_hash_runtime_projection_file "$verifier_file" "$normalized_file")" || return 1
    K_EXPECTED_RUNTIME_PROJECTION_SHA256="$runtime_hash"
    K_EXPECTED_RUNTIME_SHA256="$(k_hash_file "$verifier_file")"
    K_EXPECTED_RUNTIME_PROJECTION_FILE="$verifier_file"
    export K_EXPECTED_RUNTIME_PROJECTION_FILE K_EXPECTED_RUNTIME_PROJECTION_SHA256 K_EXPECTED_RUNTIME_SHA256
  else
    k_error "$verifier_file_var is required; K0 must use the exact verifier projection"
    return 1
  fi
}

k_validate_compose_resolved_images() {
  local prefix="$1"
  local compose_file="$2"
  local env_file="$3"
  local gateway_var="K_${prefix}_GATEWAY_IMAGE"
  local api_var="K_${prefix}_OPENPATH_API_IMAGE"
  local spa_var="K_${prefix}_SPA_IMAGE"
  local expected_gateway="${!gateway_var:-}"
  local expected_api="${!api_var:-}"
  local expected_spa="${!spa_var:-}"
  local images=""
  local image=""
  local gateway_count=0
  local api_count=0
  local spa_count=0
  local count=0

  [ -f "$compose_file" ] || { k_error "Compose file is missing: $compose_file"; return 1; }
  k_require_immutable_image "$gateway_var" "$expected_gateway" || return 1
  k_require_immutable_image "$api_var" "$expected_api" || return 1
  k_require_immutable_image "$spa_var" "$expected_spa" || return 1
  images="$(PATH="$K_EFFECTIVE_HOST_PATH" docker compose --env-file "$env_file" -p "$K_COMPOSE_PROJECT" -f "$compose_file" config --images)" || {
    k_error 'Docker Compose could not resolve the release image pins'
    return 1
  }
  while IFS= read -r image; do
    [ -n "$image" ] || continue
    count=$((count + 1))
    k_require_immutable_image 'resolved Compose image' "$image" || return 1
    case "$image" in
      "$expected_gateway") gateway_count=$((gateway_count + 1)) ;;
      "$expected_api") api_count=$((api_count + 1)) ;;
      "$expected_spa") spa_count=$((spa_count + 1)) ;;
      *) k_error "Compose resolved an image outside the exact $prefix bundle: $image"; return 1 ;;
    esac
  done <<< "$images"
  [ "$count" -eq 4 ] && [ "$gateway_count" -eq 1 ] && [ "$api_count" -eq 2 ] && [ "$spa_count" -eq 1 ] || {
    k_error "Compose image resolution is incomplete or ambiguous: $images"
    return 1
  }
}

k_validate_topology_config() {
  local expected_network="${K_COMPOSE_PROJECT}_openpath_default"

  [ "${K_EXPECTED_NETWORKS:-}" = "$expected_network" ] || {
    k_error 'K_EXPECTED_NETWORKS must be the real Compose production network'
    return 1
  }
  [ "${K_EXPECTED_API_DATA_VOLUME:-}" = "${K_COMPOSE_PROJECT}_api-data" ] || {
    k_error 'K_EXPECTED_API_DATA_VOLUME does not match the production Compose namespace'
    return 1
  }
  [ "${K_EXPECTED_TEMPLATES_VOLUME:-}" = "${K_COMPOSE_PROJECT}_windows_offline_installer_templates" ] || {
    k_error 'K_EXPECTED_TEMPLATES_VOLUME does not match the production Compose namespace'
    return 1
  }
  [ "${K_EXPECTED_ARTIFACTS_VOLUME:-}" = "${K_COMPOSE_PROJECT}_windows_offline_installer_artifacts" ] || {
    k_error 'K_EXPECTED_ARTIFACTS_VOLUME does not match the production Compose namespace'
    return 1
  }
  [ "${K_EXPECTED_GATEWAY_NAME:-}" = classroompath-gateway ] || return 1
  [ "${K_EXPECTED_API_NAME:-}" = classroompath-api ] || return 1
  [ "${K_EXPECTED_SPA_NAME:-}" = classroompath-spa ] || return 1
  [ "${K_EXPECTED_PROVISION_NAME:-}" = classroompath-openpath-windows-offline-installer-provision ] || return 1
  [ "${K_EXPECTED_GATEWAY_DOWNLOAD_MOUNT:-}" = '/srv/classroompath/downloads|/app/react-spa/dist/downloads|ro' ] || {
    k_error 'Gateway bind mount must preserve the production host path'
    return 1
  }
  [ "${K_EXPECTED_API_MOUNT:-}" = "${K_EXPECTED_API_DATA_VOLUME}|/app/data|rw" ] || return 1
  [ "${K_EXPECTED_PROVISION_TEMPLATES_MOUNT:-}" = "${K_EXPECTED_TEMPLATES_VOLUME}|/app/var/windows-offline-installer/templates|rw" ] || return 1
  [ "${K_EXPECTED_API_TEMPLATES_MOUNT:-}" = "${K_EXPECTED_TEMPLATES_VOLUME}|/app/var/windows-offline-installer/templates|ro" ] || return 1
  [ "${K_EXPECTED_API_ARTIFACTS_MOUNT:-}" = "${K_EXPECTED_ARTIFACTS_VOLUME}|/app/var/windows-offline-installer/artifacts|rw" ] || return 1
  [[ "${K_EXPECTED_API_FIREFOX_MOUNT:-}" =~ ^/.+/current\|/openpath-firefox-release\|ro$ ]] || return 1
  [[ "${K_EXPECTED_SPA_MOUNT:-}" =~ ^/.+/spa-nginx\.conf\|/etc/nginx/conf\.d/default\.conf\|ro$ ]] || return 1
}

k_prepare_openpath_assets() {
  local release_runtime_helper="$K_HARNESS_DIR/lib/release-runtime.sh"
  local app_sha="${APP_SHA:-}"

  [ -f "$release_runtime_helper" ] || return 1
  k_source_common_helper || return 1
  # shellcheck source=lib/release-runtime.sh
  source "$release_runtime_helper"
  OPENPATH_FIREFOX_RELEASE_HOST_ROOT="$K_FIREFOX_RELEASE_HOST_ROOT"
  export OPENPATH_FIREFOX_RELEASE_HOST_ROOT
  PATH="$K_EFFECTIVE_HOST_PATH" prepare_openpath_firefox_assets_from_image "$OPENPATH_FIREFOX_ASSETS_IMAGE" "$app_sha"
}

k_preflight_recovery() {
  local artifact="${K_RECOVERY_ARTIFACT_FILE:-}"
  local actual_sha=""
  local executor_sha=""
  local temp_dir=""
  local metadata=""
  local contract_file=""
  local contract_helper_version=""
  local contract_version=""
  local source_version=""

  k_require_config_value K_RECOVERY_CONTRACT_VERSION || return 1
  k_require_config_value K_RECOVERY_SOURCE_VERSION || return 1
  [[ "$K_RECOVERY_CONTRACT_VERSION" =~ ^[0-9]+$ ]] || return 1
  [[ "$K_RECOVERY_SOURCE_VERSION" =~ ^[0-9]+$ ]] || return 1
  k_require_sha40 K_RECOVERY_SHA "${K_RECOVERY_SHA:-}" || return 1
  k_require_sha40 K_RECOVERY_SOURCE_SHA "${K_RECOVERY_SOURCE_SHA:-}" || return 1
  [ "$K_RECOVERY_SHA" = "$K_RECOVERY_SOURCE_SHA" ] || { k_error 'Recovery source SHA must equal R'; return 1; }
  k_require_sha40 K_CANDIDATE_SHA "${K_CANDIDATE_SHA:-}" || return 1
  [ "$K_RECOVERY_SHA" != "$K_CANDIDATE_SHA" ] || { k_error 'Recovery R must differ from candidate C'; return 1; }
  k_validate_external_file "$artifact" 'Recovery artifact' || return 1
  k_require_sha64 K_RECOVERY_ARTIFACT_SHA256 "${K_RECOVERY_ARTIFACT_SHA256:-}" || return 1
  k_require_sha64 K_RECOVERY_EXECUTOR_SHA256 "${K_RECOVERY_EXECUTOR_SHA256:-}" || return 1
  actual_sha="$(k_hash_file "$artifact")"
  [ "$actual_sha" = "$K_RECOVERY_ARTIFACT_SHA256" ] || { k_error 'Recovery artifact hash mismatch'; return 1; }
  k_source_recovery_artifact_helper || return 1
  production_recovery_artifact_archive_has_safe_paths "$artifact" || return 1
  temp_dir="$(mktemp -d)" || return 1
  tar -xzf "$artifact" -C "$temp_dir" --no-same-owner --no-same-permissions || {
    rm -rf "$temp_dir"
    k_error 'Recovery artifact cannot be extracted'
    return 1
  }
  production_recovery_artifact_bundle_is_complete "$temp_dir" || { rm -rf "$temp_dir"; return 1; }
  executor_sha="$(k_hash_file "$temp_dir/production-recovery-executor.sh")"
  [ "$executor_sha" = "$K_RECOVERY_EXECUTOR_SHA256" ] || {
    rm -rf "$temp_dir"
    k_error 'Recovery executor hash mismatch'
    return 1
  }
  [ -x "$temp_dir/production-recovery-executor.sh" ] || {
    rm -rf "$temp_dir"
    k_error 'Recovery executor is not executable inside the exact artifact'
    return 1
  }
  metadata="$temp_dir/lib/recovery-authority.env"
  [ "$(k_read_required_file_value "$metadata" PRODUCTION_RECOVERY_SOURCE_SHA)" = "$K_RECOVERY_SHA" ] || { rm -rf "$temp_dir"; return 1; }
  [ "$(k_read_required_file_value "$metadata" PRODUCTION_RECOVERY_CONTRACT_VERSION)" = "$K_RECOVERY_CONTRACT_VERSION" ] || { rm -rf "$temp_dir"; return 1; }
  [ "$(k_read_required_file_value "$metadata" PRODUCTION_RECOVERY_SOURCE_VERSION)" = "$K_RECOVERY_SOURCE_VERSION" ] || { rm -rf "$temp_dir"; return 1; }
  contract_file="$temp_dir/lib/production-recovery-contract.sh"
  contract_helper_version="$(k_read_required_file_value "$contract_file" PRODUCTION_RECOVERY_CONTRACT_HELPER_CONTRACT_VERSION)" || { rm -rf "$temp_dir"; return 1; }
  contract_version="$(k_read_required_file_value "$contract_file" PRODUCTION_RECOVERY_CONTRACT_VERSION)" || { rm -rf "$temp_dir"; return 1; }
  source_version="$(k_read_required_file_value "$contract_file" PRODUCTION_RECOVERY_SOURCE_VERSION)" || { rm -rf "$temp_dir"; return 1; }
  [ "$contract_helper_version" = 1 ] &&
    [ "$contract_version" = "$K_RECOVERY_CONTRACT_VERSION" ] &&
    [ "$source_version" = "$K_RECOVERY_SOURCE_VERSION" ] || {
      rm -rf "$temp_dir"
      k_error 'Recovery artifact contract metadata is incompatible'
      return 1
    }
  rm -rf "$temp_dir"
  if [ -n "${K_RECOVERY_AUTHORITY_EVIDENCE_FILE:-}" ]; then
    if [ ! -f "$K_RECOVERY_AUTHORITY_EVIDENCE_FILE" ] || [ -L "$K_RECOVERY_AUTHORITY_EVIDENCE_FILE" ]; then
      k_error 'Recovery authority evidence is unavailable or symlinked'
      return 1
    fi
    k_validate_external_file "$K_RECOVERY_AUTHORITY_EVIDENCE_FILE" 'Recovery authority evidence' || return 1
    [ "$(k_read_consistent_file_value "$K_RECOVERY_AUTHORITY_EVIDENCE_FILE" PRODUCTION_RECOVERY_SHA)" = "$K_RECOVERY_SHA" ] || return 1
    [ "$(k_read_consistent_file_value "$K_RECOVERY_AUTHORITY_EVIDENCE_FILE" PRODUCTION_RECOVERY_SOURCE_SHA)" = "$K_RECOVERY_SOURCE_SHA" ] || return 1
    [ "$(k_read_consistent_file_value "$K_RECOVERY_AUTHORITY_EVIDENCE_FILE" PRODUCTION_RECOVERY_ARTIFACT_SHA256)" = "$K_RECOVERY_ARTIFACT_SHA256" ] || return 1
    [ "$(k_read_consistent_file_value "$K_RECOVERY_AUTHORITY_EVIDENCE_FILE" PRODUCTION_RECOVERY_EXECUTOR_SHA256)" = "$K_RECOVERY_EXECUTOR_SHA256" ] || return 1
    grep -Fqx 'PREFLIGHT=passed' "$K_RECOVERY_AUTHORITY_EVIDENCE_FILE" || return 1
  fi
  k_info 'exact independent recovery artifact preflight passed'
}

k_validate_recovery() {
  local output_file="${1:-}"

  k_preflight_recovery || return 1
  k_validate_recovery_transmitted || return 1
  k_validate_recovery_persisted || return 1
  if [ -n "$output_file" ]; then
    k_write_recovery_identity_record "$output_file" || return 1
  fi
  k_info 'recovery identity passed; transmitted and persisted bytes are identical'
}

k_validate_recovery_transmitted() {
  local transmitted="${K_RECOVERY_TRANSMITTED_FILE:-}"

  k_validate_configured_path K_RECOVERY_TRANSMITTED_FILE || return 1
  [ -f "$transmitted" ] || { k_error 'Transmitted recovery artifact copy is missing'; return 1; }
  [ "$(k_hash_file "$transmitted")" = "$K_RECOVERY_ARTIFACT_SHA256" ] || {
    k_error 'Transmitted recovery artifact hash differs from the validated R bytes'
    return 1
  }
}

k_validate_recovery_persisted() {
  local persisted="${K_RECOVERY_PERSISTED_FILE:-}"
  local expected_persisted="${K_DEPLOY_ROOT:-}/recovery/releases/${K_RECOVERY_ARTIFACT_SHA256:-}/production-recovery-bundle.tgz"

  k_validate_configured_path K_RECOVERY_PERSISTED_FILE || return 1
  [ "$persisted" = "$expected_persisted" ] || {
    k_error 'Persisted recovery artifact must use the canonical hash-addressed deploy-root path'
    return 1
  }
  [ -f "$persisted" ] || { k_error 'Persisted recovery artifact copy is missing'; return 1; }
  [ "$(k_hash_file "$persisted")" = "$K_RECOVERY_ARTIFACT_SHA256" ] || {
    k_error 'Persisted recovery artifact hash differs from the validated R bytes'
    return 1
  }
  cmp -- "$K_RECOVERY_TRANSMITTED_FILE" "$persisted" || {
    k_error 'Transmitted and persisted recovery bytes differ'
    return 1
  }
}

k_write_recovery_identity_record() {
  local output_file="$1"

  mkdir -p "$(dirname "$output_file")"
  {
    printf 'RECOVERY_SOURCE_SHA=%s\n' "$K_RECOVERY_SOURCE_SHA"
    printf 'RECOVERY_CONTRACT_VERSION=%s\n' "$K_RECOVERY_CONTRACT_VERSION"
    printf 'RECOVERY_SOURCE_VERSION=%s\n' "$K_RECOVERY_SOURCE_VERSION"
    printf 'RECOVERY_ARTIFACT_SHA256=%s\n' "$K_RECOVERY_ARTIFACT_SHA256"
    printf 'RECOVERY_EXECUTOR_SHA256=%s\n' "$K_RECOVERY_EXECUTOR_SHA256"
    printf 'RECOVERY_TRANSMITTED_SHA256=%s\n' "$(k_hash_file "$K_RECOVERY_TRANSMITTED_FILE")"
    printf 'RECOVERY_PERSISTED_SHA256=%s\n' "$(k_hash_file "$K_RECOVERY_PERSISTED_FILE")"
    printf 'RECOVERY_BYTES_IDENTICAL=true\n'
  } > "$output_file"
  chmod 600 "$output_file"
}

k_validate_recovery_source_checkout() {
  local source_dir="${K_RECOVERY_SOURCE_DIR:-}"
  local actual_sha=""
  local status=""
  local required_file=""

  k_validate_external_directory "$source_dir" 'Recovery source checkout' || return 1
  [ -e "$source_dir/.git" ] && [ ! -L "$source_dir/.git" ] || {
    k_error 'Recovery source checkout has a missing or symlinked .git'
    return 1
  }
  actual_sha="$(git -C "$source_dir" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)"
  [ "$actual_sha" = "$K_RECOVERY_SHA" ] || {
    k_error 'Recovery source checkout does not resolve to the exact R'
    return 1
  }
  status="$(git -C "$source_dir" status --porcelain=v1 --untracked-files=all)" || return 1
  [ -z "$status" ] || {
    k_error 'Recovery source checkout is not clean'
    printf '%s\n' "$status" >&2
    return 1
  }
  [ ! -e "$source_dir/config/.env.bak-billingfix-20260623" ] || {
    k_error 'Protected billing backup is present in the recovery source checkout'
    return 1
  }
  for required_file in \
    scripts/production-recovery-authority.sh \
    scripts/package-production-recovery-bundle.sh \
    scripts/promote-production-recovery-authority.sh \
    scripts/rollback-production-remote.sh \
    scripts/lib/production-recovery-contract.sh \
    scripts/lib/production-recovery-executor.sh \
    scripts/lib/production-recovery-artifact.sh \
    scripts/lib/production-deployment-diagnostic-fallback.sh \
    scripts/lib/remote-bootstrap.sh \
    scripts/lib/remote-deploy-scaffold.sh \
    scripts/lib/remote-helper-contracts.sh \
    scripts/lib/rollback-executor.sh \
    scripts/lib/rollback-readiness.sh; do
    [ -f "$source_dir/$required_file" ] && [ ! -L "$source_dir/$required_file" ] || {
      k_error "Recovery source checkout is missing $required_file"
      return 1
    }
  done
}

k_prepare_recovery_artifact() {
  local source_dir="${K_RECOVERY_SOURCE_DIR:-}"
  local artifact="${K_RECOVERY_ARTIFACT_FILE:-}"
  local authority_evidence="${K_RECOVERY_AUTHORITY_EVIDENCE_FILE:-}"
  local identity_file="$K_EVIDENCE_DIR/recovery-source-identity.env"
  local authority=""
  local artifact_sha=""
  local executor_sha=""

  k_require_sha40 K_RECOVERY_SHA "${K_RECOVERY_SHA:-}" || return 1
  k_require_sha40 K_RECOVERY_SOURCE_SHA "${K_RECOVERY_SOURCE_SHA:-}" || return 1
  [ "$K_RECOVERY_SHA" = "$K_RECOVERY_SOURCE_SHA" ] || {
    k_error 'Recovery source SHA must equal R'
    return 1
  }
  k_require_sha40 K_CANDIDATE_SHA "${K_CANDIDATE_SHA:-}" || return 1
  [ "$K_RECOVERY_SHA" != "$K_CANDIDATE_SHA" ] || {
    k_error 'Recovery R must differ from candidate C'
    return 1
  }
  k_validate_recovery_source_checkout || return 1
  authority="$source_dir/scripts/production-recovery-authority.sh"
  [ -f "$authority" ] || { k_error 'Recovery authority helper is missing from R'; return 1; }
  [ -n "$artifact" ] || { k_error 'K_RECOVERY_ARTIFACT_FILE is required'; return 1; }
  [ -n "$authority_evidence" ] || { k_error 'K_RECOVERY_AUTHORITY_EVIDENCE_FILE is required'; return 1; }
  [ ! -e "$artifact" ] || {
    k_error 'Recovery artifact already exists; refusing to regenerate R bytes'
    return 1
  }
  [ ! -e "$identity_file" ] || {
    k_error 'Recovery source identity already exists; refusing to regenerate R bytes'
    return 1
  }
  mkdir -p "$(dirname "$artifact")" "$(dirname "$authority_evidence")" "$(dirname "$identity_file")"
  k_require_external_output_path K_RECOVERY_ARTIFACT_FILE || return 1
  K_RECOVERY_AUTHORITY_EVIDENCE_FILE="$authority_evidence"
  k_require_external_output_path K_RECOVERY_AUTHORITY_EVIDENCE_FILE || return 1
  authority="$source_dir/scripts/production-recovery-authority.sh"
  PRODUCTION_RECOVERY_SHA="$K_RECOVERY_SHA" PATH="$K_EFFECTIVE_HOST_PATH" bash "$authority" package --recovery-sha "$K_RECOVERY_SHA" --candidate-sha "$K_CANDIDATE_SHA" --source-root "$source_dir" --output "$artifact" --evidence "$authority_evidence" || return 1
  PRODUCTION_RECOVERY_SHA="$K_RECOVERY_SHA" PATH="$K_EFFECTIVE_HOST_PATH" bash "$authority" preflight --recovery-sha "$K_RECOVERY_SHA" --artifact "$artifact" --evidence "$authority_evidence" || return 1
  artifact_sha="$(k_hash_file "$artifact")"
  executor_sha="$(tar -xOf "$artifact" production-recovery-executor.sh | sha256sum | awk '{ print $1; exit }')"
  k_require_sha64 generated_recovery_artifact_sha256 "$artifact_sha" || return 1
  k_require_sha64 generated_recovery_executor_sha256 "$executor_sha" || return 1
  K_RECOVERY_ARTIFACT_SHA256="$artifact_sha"
  K_RECOVERY_EXECUTOR_SHA256="$executor_sha"
  export K_RECOVERY_ARTIFACT_SHA256 K_RECOVERY_EXECUTOR_SHA256
  {
    printf 'RECOVERY_SOURCE_SHA=%s\n' "$K_RECOVERY_SOURCE_SHA"
    printf 'RECOVERY_CONTRACT_VERSION=%s\n' "$K_RECOVERY_CONTRACT_VERSION"
    printf 'RECOVERY_SOURCE_VERSION=%s\n' "$K_RECOVERY_SOURCE_VERSION"
    printf 'RECOVERY_ARTIFACT_SHA256=%s\n' "$artifact_sha"
    printf 'RECOVERY_EXECUTOR_SHA256=%s\n' "$executor_sha"
    printf 'RECOVERY_GENERATED_ONCE=true\n'
  } > "$identity_file"
  chmod 600 "$identity_file"
  k_info 'exact R recovery artifact packaged and preflighted once'
}

k_validate_prepared_recovery_artifact() {
  local identity_file="${K_EVIDENCE_DIR:-}/recovery-source-identity.env"

  [ -f "$identity_file" ] && [ ! -L "$identity_file" ] || {
    k_error 'Recovery source identity is missing; run prepare-recovery once before K'
    return 1
  }
  [ "$(k_read_required_file_value "$identity_file" RECOVERY_SOURCE_SHA)" = "$K_RECOVERY_SOURCE_SHA" ] || return 1
  [ "$(k_read_required_file_value "$identity_file" RECOVERY_CONTRACT_VERSION)" = "$K_RECOVERY_CONTRACT_VERSION" ] || return 1
  [ "$(k_read_required_file_value "$identity_file" RECOVERY_SOURCE_VERSION)" = "$K_RECOVERY_SOURCE_VERSION" ] || return 1
  [ "$(k_read_required_file_value "$identity_file" RECOVERY_ARTIFACT_SHA256)" = "$K_RECOVERY_ARTIFACT_SHA256" ] || return 1
  [ "$(k_read_required_file_value "$identity_file" RECOVERY_EXECUTOR_SHA256)" = "$K_RECOVERY_EXECUTOR_SHA256" ] || return 1
  [ "$(k_read_required_file_value "$identity_file" RECOVERY_GENERATED_ONCE)" = true ] || return 1
  k_preflight_recovery
}

k_preflight_recovery_against_previous() {
  local state_dir="$K_DEPLOY_ROOT/release-state"
  local phase_file="$state_dir/deployment-phase.env"
  local preflight_file="$K_EVIDENCE_DIR/recovery-readiness.env"
  local temp_dir=""
  local current=""
  local previous=""

  k_validate_prepared_recovery_artifact || return 1
  current="$(tr -d '\r\n' < "$state_dir/current" 2>/dev/null || true)"
  previous="$(tr -d '\r\n' < "$state_dir/previous" 2>/dev/null || true)"
  [ "$current" = "$K_PREVIOUS_RELEASE_ID" ] || {
    k_error 'Recovery readiness requires current to identify the exact previous release P'
    return 1
  }
  [ "$previous" = "$current" ] || {
    k_error 'Recovery readiness requires capture-previous to persist P before the boundary'
    return 1
  }
  temp_dir="$(mktemp -d)" || return 1
  tar -xzf "$K_RECOVERY_ARTIFACT_FILE" -C "$temp_dir" --no-same-owner --no-same-permissions || {
    rm -rf "$temp_dir"
    k_error 'Unable to extract the exact recovery artifact for readiness preflight'
    return 1
  }
  if ! (
    PATH="$K_EFFECTIVE_HOST_PATH" \
    CLASSROOMPATH_DEPLOY_ROOT="$K_DEPLOY_ROOT" \
    APP_DIR="$K_APP_DIR" \
    DEPLOYMENT_TRANSACTION_FILE="$phase_file" \
    DEPLOYMENT_STATE_USE_VERIFIER=1 \
    ROLLBACK_READINESS_USE_VERIFIER=1 \
    PRODUCTION_HOST_NETWORK_URL="$K_NETWORK_PREFLIGHT_URL" \
    PRODUCTION_HOST_CONTRACT_REPORT_FILE="$K_EVIDENCE_DIR/recovery-readiness-host-contract.json" \
    CANDIDATE_SHA="$K_CANDIDATE_SHA" \
    PRODUCTION_RECOVERY_SHA="$K_RECOVERY_SHA" \
    PRODUCTION_RECOVERY_SOURCE_SHA="$K_RECOVERY_SOURCE_SHA" \
    PRODUCTION_RECOVERY_SOURCE_VERSION="$K_RECOVERY_SOURCE_VERSION" \
    PRODUCTION_RECOVERY_CONTRACT_VERSION="$K_RECOVERY_CONTRACT_VERSION" \
    PRODUCTION_RECOVERY_ARTIFACT_SHA256="$K_RECOVERY_ARTIFACT_SHA256" \
    PRODUCTION_RECOVERY_EXECUTOR_SHA256="$K_RECOVERY_EXECUTOR_SHA256" \
    PRODUCTION_CONTAINER_PLATFORM="${K_CONTAINER_PLATFORM:-linux/amd64}" \
    PRODUCTION_ROLLBACK_PUBLIC_URL="$K_BASE_URL" \
    DEPLOYMENT_TRANSACTION_HISTORY_FILE='' \
    bash "$temp_dir/production-recovery-executor.sh" --preflight-only
  ); then
    rm -rf "$temp_dir"
    k_error 'Exact R recovery executor could not preflight the stored previous release'
    return 1
  fi
  rm -rf "$temp_dir"
  {
    printf 'RECOVERY_READINESS_PREFLIGHT=true\n'
    printf 'RECOVERY_READINESS_SOURCE_SHA=%s\n' "$K_RECOVERY_SOURCE_SHA"
    printf 'RECOVERY_READINESS_PREVIOUS_RELEASE_ID=%s\n' "$K_PREVIOUS_RELEASE_ID"
    printf 'RECOVERY_READINESS_ARTIFACT_SHA256=%s\n' "$K_RECOVERY_ARTIFACT_SHA256"
    printf 'RECOVERY_READINESS_EXECUTOR_SHA256=%s\n' "$K_RECOVERY_EXECUTOR_SHA256"
  } > "$preflight_file"
  chmod 600 "$preflight_file"
  k_info 'exact R recovery readiness was preflighted against stored P'
}

k_validate_migration() {
  local repo="$1"
  local from_sha="$2"
  local to_sha="$3"
  local output="$4"

  [ -d "$repo" ] || { k_error "Migration repository is missing: $repo"; return 1; }
  k_require_sha40 MIGRATION_FROM_SHA "$from_sha" || return 1
  k_require_sha40 MIGRATION_TO_SHA "$to_sha" || return 1
  git -C "$repo" cat-file -e "$from_sha^{commit}" 2>/dev/null || {
    k_error "Migration source checkout does not contain the exact previous SHA: $from_sha"
    return 1
  }
  git -C "$repo" cat-file -e "$to_sha^{commit}" 2>/dev/null || {
    k_error "Migration source checkout does not contain the exact candidate SHA: $to_sha"
    return 1
  }
  [ -f "$K_HARNESS_DIR/lib/release-risk-policy.sh" ] || return 1
  # shellcheck source=lib/release-risk-policy.sh
  source "$K_HARNESS_DIR/lib/release-risk-policy.sh"
  release_risk_policy_classify_migration_risk_without_node "$repo" "$from_sha" "$to_sha"
  mkdir -p "$(dirname "$output")"
  {
    printf 'MIGRATION_RISK_LEVEL=%s\n' "${MIGRATION_RISK_LEVEL:-unknown}"
    printf 'MIGRATION_CHANGED_FILES=%s\n' "${MIGRATION_CHANGED_FILES:-}"
    printf 'MIGRATION_DESTRUCTIVE_FILES=%s\n' "${MIGRATION_DESTRUCTIVE_FILES:-}"
    printf 'MIGRATION_EXPAND_FILES=%s\n' "${MIGRATION_EXPAND_FILES:-}"
    printf 'MIGRATION_SAFE_FILES=%s\n' "${MIGRATION_SAFE_FILES:-}"
  } > "$output"
  [ "${MIGRATION_RISK_LEVEL:-}" = safe ] || {
    k_error "Migration risk is not safe: ${MIGRATION_RISK_LEVEL:-unknown}"
    return 1
  }
  k_info 'migration classifier returned safe'
}

k_validate_transition() {
  local state_file="$1"
  local phase=""
  local current=""
  local previous=""
  local candidate=""

  phase="$(k_read_required_file_value "$state_file" DEPLOYMENT_PHASE)" || return 1
  current="$(k_read_required_file_value "$state_file" CURRENT_RELEASE_ID)" || return 1
  previous="$(k_read_required_file_value "$state_file" PREVIOUS_RELEASE_ID)" || return 1
  candidate="$(k_read_required_file_value "$state_file" CANDIDATE_RELEASE_ID)" || return 1
  case "$phase" in
    PREPARED|SWITCHING|ACTIVATED_UNVERIFIED|VERIFIED|FAILED|ROLLING_BACK)
      [ "$current" != "$candidate" ] || { k_error "current points to C before commit at $phase"; return 1; }
      ;;
    COMMITTED)
      [ "$current" = "$candidate" ] || { k_error 'COMMITTED must point current at C'; return 1; }
      [ "$previous" != "$candidate" ] || { k_error 'COMMITTED previous must remain P'; return 1; }
      ;;
    ROLLED_BACK)
      [ "$current" = "$previous" ] || { k_error 'ROLLED_BACK must restore P'; return 1; }
      ;;
    *) k_error "Unknown transaction phase: $phase"; return 1 ;;
  esac
  k_info 'transition contract passed'
}

k_initialize_transaction_history() {
  local history_file="${K_TRANSACTION_HISTORY_FILE:-$K_EVIDENCE_DIR/deployment-phase-history.env}"

  k_validate_configured_path K_EVIDENCE_DIR || return 1
  case "$history_file" in
    "$K_EVIDENCE_DIR"|"$K_EVIDENCE_DIR"/*) ;;
    *) k_error 'Transaction history must remain in the bounded evidence directory'; return 1 ;;
  esac
  if [ -e "$history_file" ]; then
    [ -f "$history_file" ] && [ ! -L "$history_file" ] && [ ! -s "$history_file" ] || {
      k_error 'Existing transaction history is not an empty regular file'
      return 1
    }
  else
    : > "$history_file"
    chmod 600 "$history_file"
  fi
  K_TRANSACTION_HISTORY_FILE="$history_file"
  DEPLOYMENT_TRANSACTION_HISTORY_FILE="$history_file"
  export K_TRANSACTION_HISTORY_FILE DEPLOYMENT_TRANSACTION_HISTORY_FILE
}

k_initialize_transaction_attempt() {
  local requested_id=""

  requested_id="$(k_generate_transaction_id)" || return 1
  k_require_transaction_id "$requested_id" || return 1
  K_TRANSACTION_ID="$requested_id"
  export K_TRANSACTION_ID
}

k_initialize_leg_outcomes() {
  K_SAFETY_OUTCOME=UNDETERMINED
  K_EVIDENCE_OUTCOME=COMPLETE
  K_EVIDENCE_FAILURE_REASON=""
  K_FORWARD_OUTCOME=UNCLASSIFIED
  K_FORWARD_PHASE=unknown
  K_FORWARD_BOUNDARY=unknown
  K_FORWARD_STATE_READABLE=false
  K_RECOVERY_ATTEMPTED=false
  K_RECOVERY_RESULT=NOT_REQUIRED
  export K_SAFETY_OUTCOME K_EVIDENCE_OUTCOME K_EVIDENCE_FAILURE_REASON
  export K_FORWARD_OUTCOME K_FORWARD_PHASE K_FORWARD_BOUNDARY K_FORWARD_STATE_READABLE
  export K_RECOVERY_ATTEMPTED K_RECOVERY_RESULT
}

k_mark_evidence_incomplete() {
  local reason="${1:-evidence failure}"

  K_EVIDENCE_OUTCOME=INCOMPLETE
  if [ -z "${K_EVIDENCE_FAILURE_REASON:-}" ]; then
    K_EVIDENCE_FAILURE_REASON="$reason"
  fi
  export K_EVIDENCE_OUTCOME K_EVIDENCE_FAILURE_REASON
  k_error "$reason" || true
}

k_record_best_effort() {
  local records_file="$1"
  shift

  if ! k_record "$records_file" "$@"; then
    k_mark_evidence_incomplete "Unable to record evidence: ${2:-unknown}"
  fi
  return 0
}

k_classify_forward_outcome() {
  local forward_status="${1:-1}"
  local phase_file="${2:-}"
  local leg="${3:-success}"
  local failure_kind="${4:-}"
  local phase=""
  local boundary=""
  local transaction_id=""
  local candidate_release_id=""
  local candidate_sha=""
  local current_release_id=""
  local previous_release_id=""
  local state_complete=false
  local expected_transaction_field=""

  K_FORWARD_OUTCOME=STATE_UNKNOWN_AFTER_FORWARD
  K_FORWARD_PHASE=unknown
  K_FORWARD_BOUNDARY=unknown
  K_FORWARD_STATE_READABLE=false

  if [ ! -f "$phase_file" ] || [ -L "$phase_file" ]; then
    export K_FORWARD_OUTCOME K_FORWARD_PHASE K_FORWARD_BOUNDARY K_FORWARD_STATE_READABLE
    return 0
  fi

  phase="$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE || true)"
  boundary="$(k_read_file_value "$phase_file" MUTATION_BOUNDARY_REACHED || true)"
  transaction_id="$(k_read_file_value "$phase_file" DEPLOYMENT_TRANSACTION_ID || true)"
  candidate_release_id="$(k_read_file_value "$phase_file" CANDIDATE_RELEASE_ID || true)"
  candidate_sha="$(k_read_file_value "$phase_file" CANDIDATE_SHA || true)"
  current_release_id="$(k_read_file_value "$phase_file" CURRENT_RELEASE_ID || true)"
  previous_release_id="$(k_read_file_value "$phase_file" PREVIOUS_RELEASE_ID || true)"
  K_FORWARD_PHASE="${phase:-unknown}"
  K_FORWARD_BOUNDARY="${boundary:-unknown}"

  if [ -n "$phase" ] && [[ "$boundary" = 0 || "$boundary" = 1 ]] &&
    [[ "$phase" =~ ^(PREPARED|SWITCHING|ACTIVATED_UNVERIFIED|VERIFIED|COMMITTED|FAILED|ROLLING_BACK|ROLLED_BACK)$ ]]; then
    state_complete=true
  fi
  if [ "$state_complete" = true ] &&
    { [ -z "${K_TRANSACTION_ID:-}" ] || [ "$transaction_id" != "$K_TRANSACTION_ID" ]; }; then
    expected_transaction_field="${K_TRANSACTION_ID:-}"
    state_complete=false
  fi
  if [ "$state_complete" = true ] &&
    { [ -z "${K_C_RELEASE_ID:-}" ] || [ "$candidate_release_id" != "$K_C_RELEASE_ID" ]; }; then
    state_complete=false
  fi
  if [ "$state_complete" = true ] &&
    { [ -z "${K_CANDIDATE_SHA:-}" ] || [ "$candidate_sha" != "$K_CANDIDATE_SHA" ]; }; then
    state_complete=false
  fi
  if [ "$state_complete" = true ] &&
    { [ -z "${K_PREVIOUS_RELEASE_ID:-}" ] || [ "$previous_release_id" != "$K_PREVIOUS_RELEASE_ID" ]; }; then
    state_complete=false
  fi
  if [ "$state_complete" = true ] && [ "$phase" = COMMITTED ] &&
    { [ "$boundary" != 1 ] || [ "$current_release_id" != "$candidate_release_id" ]; }; then
    state_complete=false
  fi
  if [ "$state_complete" = true ] && [ "$phase" = ROLLED_BACK ] &&
    { [ "$boundary" != 1 ] || [ "$current_release_id" != "$previous_release_id" ]; }; then
    state_complete=false
  fi
  if [ "$state_complete" != true ]; then
    if [ -n "$expected_transaction_field" ]; then
      k_error 'Durable forward state belongs to a different transaction attempt' || true
    fi
    export K_FORWARD_OUTCOME K_FORWARD_PHASE K_FORWARD_BOUNDARY K_FORWARD_STATE_READABLE
    return 0
  fi
  K_FORWARD_STATE_READABLE=true

  if [ -n "$failure_kind" ]; then
    if [ "$boundary" = 1 ]; then
      case "$phase" in
        COMMITTED)
          K_FORWARD_OUTCOME=HARNESS_FAILURE_TERMINAL_SAFE
          ;;
        ROLLED_BACK)
          K_FORWARD_OUTCOME=HARNESS_FAILURE_TERMINAL_SAFE
          ;;
        *)
          K_FORWARD_OUTCOME=HARNESS_FAILURE_POST_BOUNDARY
          ;;
      esac
    else
      K_FORWARD_OUTCOME=HARNESS_FAILURE_PRE_BOUNDARY
    fi
  elif [ "$boundary" = 0 ]; then
    case "$phase" in
      PREPARED|FAILED)
        if [ "$forward_status" -ne 0 ]; then
          K_FORWARD_OUTCOME=FORWARD_FAILURE_PRE_BOUNDARY
        else
          K_FORWARD_OUTCOME=FORWARD_INCOMPLETE_PRE_BOUNDARY
        fi
        ;;
      *)
        K_FORWARD_OUTCOME=STATE_UNKNOWN_AFTER_FORWARD
        K_FORWARD_STATE_READABLE=false
        ;;
    esac
  else
    case "$phase" in
      COMMITTED)
        if [ "$leg" = fault ]; then
          K_FORWARD_OUTCOME=FORWARD_COMMITTED_FAULT
        elif [ "$forward_status" -eq 0 ]; then
          K_FORWARD_OUTCOME=FORWARD_SUCCESS_COMMITTED
        else
          # A non-zero forward result is still a failed success leg even if
          # the durable executor state reached COMMITTED. Restore P so a
          # caller cannot mistake a post-commit command error for success.
          K_FORWARD_OUTCOME=FORWARD_FAILURE_POST_BOUNDARY
        fi
        ;;
      ROLLED_BACK)
        K_FORWARD_OUTCOME=FORWARD_ROLLED_BACK_SAFE
        ;;
      *)
        if [ "$failure_kind" != "" ]; then
          K_FORWARD_OUTCOME=HARNESS_FAILURE_POST_BOUNDARY
        elif [ "$forward_status" -ne 0 ]; then
          K_FORWARD_OUTCOME=FORWARD_FAILURE_POST_BOUNDARY
        else
          K_FORWARD_OUTCOME=FORWARD_INCOMPLETE_POST_BOUNDARY
        fi
        ;;
    esac
  fi
  export K_FORWARD_OUTCOME K_FORWARD_PHASE K_FORWARD_BOUNDARY K_FORWARD_STATE_READABLE
}

k_durable_rollback_proven() {
  local phase_file="$1"
  local phase=""
  local boundary=""
  local transaction_id=""
  local candidate_release_id=""
  local candidate_sha=""
  local current_release_id=""
  local previous_release_id=""

  [ -f "$phase_file" ] && [ ! -L "$phase_file" ] || return 1
  phase="$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE || true)"
  boundary="$(k_read_file_value "$phase_file" MUTATION_BOUNDARY_REACHED || true)"
  transaction_id="$(k_read_file_value "$phase_file" DEPLOYMENT_TRANSACTION_ID || true)"
  candidate_release_id="$(k_read_file_value "$phase_file" CANDIDATE_RELEASE_ID || true)"
  candidate_sha="$(k_read_file_value "$phase_file" CANDIDATE_SHA || true)"
  current_release_id="$(k_read_file_value "$phase_file" CURRENT_RELEASE_ID || true)"
  previous_release_id="$(k_read_file_value "$phase_file" PREVIOUS_RELEASE_ID || true)"
  [ "$phase" = ROLLED_BACK ] || return 1
  [ "$boundary" = 1 ] || return 1
  [ "$transaction_id" = "${K_TRANSACTION_ID:-}" ] || return 1
  [ "$candidate_release_id" = "${K_C_RELEASE_ID:-}" ] || return 1
  [ "$candidate_sha" = "${K_CANDIDATE_SHA:-}" ] || return 1
  [ "$previous_release_id" = "${K_PREVIOUS_RELEASE_ID:-}" ] || return 1
  [ "$current_release_id" = "$previous_release_id" ] || return 1
}

k_capture_minimum_forward_evidence() {
  local records_file="$1"
  local phase_file="$2"
  local key=""
  local value=""
  local previous_diagnostic_output="${K_DIAGNOSTIC_OUTPUT_FILE:-}"
  local previous_diagnostic_provenance="${K_DIAGNOSTIC_PROVENANCE:-}"
  local pre_recovery_diagnostic="$K_EVIDENCE_DIR/pre-recovery-diagnostic.json"

  k_record_best_effort "$records_file" forward outcome "${K_FORWARD_OUTCOME:-unknown}"
  k_record_best_effort "$records_file" forward phase "${K_FORWARD_PHASE:-unknown}"
  k_record_best_effort "$records_file" forward boundary "${K_FORWARD_BOUNDARY:-unknown}"
  for key in DEPLOYMENT_TRANSACTION_ID DEPLOYMENT_STAGE CURRENT_RELEASE_ID PREVIOUS_RELEASE_ID CANDIDATE_RELEASE_ID CANDIDATE_SHA; do
    value="$(k_read_file_value "$phase_file" "$key" || true)"
    k_record_best_effort "$records_file" transaction "${key,,}" "$value"
  done
  if [ "${K_FORWARD_BOUNDARY:-unknown}" = 1 ]; then
    # Preserve a diagnostic while C is still observable, but never make the
    # safety path depend on this optional evidence collection. The finalizer
    # uses the configured post-recovery output path independently.
    if [ -e "$pre_recovery_diagnostic" ]; then
      k_mark_evidence_incomplete 'Pre-recovery diagnostic path already exists; refusing stale evidence reuse'
    else
      K_DIAGNOSTIC_OUTPUT_FILE="$pre_recovery_diagnostic"
      if k_collect_diagnostic; then
        k_record_best_effort "$records_file" diagnostic pre_recovery_provenance "${K_DIAGNOSTIC_PROVENANCE:-unknown}"
      else
        k_mark_evidence_incomplete 'Pre-recovery diagnostic collection failed'
      fi
    fi
    K_DIAGNOSTIC_OUTPUT_FILE="$previous_diagnostic_output"
    K_DIAGNOSTIC_PROVENANCE="$previous_diagnostic_provenance"
    export K_DIAGNOSTIC_OUTPUT_FILE K_DIAGNOSTIC_PROVENANCE
  fi
}

k_write_leg_outcomes() {
  local output_file="${K_EVIDENCE_DIR:-}/outcome.env"
  local temp_file=""

  case "$output_file" in
    "$K_EVIDENCE_DIR"|"$K_EVIDENCE_DIR"/*) ;;
    *) return 1 ;;
  esac
  mkdir -p "$K_EVIDENCE_DIR" || return 1
  temp_file="$(mktemp "$output_file.tmp.XXXXXX")" || return 1
  {
    printf 'SAFETY_OUTCOME=%s\n' "${K_SAFETY_OUTCOME:-UNDETERMINED}"
    printf 'EVIDENCE_OUTCOME=%s\n' "${K_EVIDENCE_OUTCOME:-INCOMPLETE}"
    printf 'EVIDENCE_FAILURE_REASON=%s\n' "${K_EVIDENCE_FAILURE_REASON:-}"
    printf 'FORWARD_OUTCOME=%s\n' "${K_FORWARD_OUTCOME:-UNCLASSIFIED}"
    printf 'RECOVERY_ATTEMPTED=%s\n' "${K_RECOVERY_ATTEMPTED:-false}"
    printf 'RECOVERY_RESULT=%s\n' "${K_RECOVERY_RESULT:-NOT_REQUIRED}"
  } > "$temp_file" || { rm -f "$temp_file"; return 1; }
  install -m 600 "$temp_file" "$output_file" || { rm -f "$temp_file"; return 1; }
  rm -f "$temp_file"
}

k_process_post_forward() {
  local forward_status="$1"
  local leg="$2"
  local records_file="$3"
  local phase_file="$4"
  local failure_kind="${5:-}"

  # This is the only post-forward safety gate.  It deliberately performs
  # durable-state classification and recovery before any strict evidence
  # validation, because a failed observer/evidence writer must not strand C.
  k_classify_forward_outcome "$forward_status" "$phase_file" "$leg" "$failure_kind" || true
  k_capture_minimum_forward_evidence "$records_file" "$phase_file" || true
  k_ensure_post_boundary_recovery "$leg" "$records_file" "$phase_file" || true
}

k_ensure_post_boundary_recovery() {
  local leg="${1:-success}"
  local records_file="$2"
  local phase_file="$3"
  local needs_recovery=false
  local phase="${K_FORWARD_PHASE:-unknown}"
  local rollback_status=1
  local observer_status=1

  case "${K_FORWARD_OUTCOME:-STATE_UNKNOWN_AFTER_FORWARD}" in
    FORWARD_FAILURE_PRE_BOUNDARY|FORWARD_INCOMPLETE_PRE_BOUNDARY|HARNESS_FAILURE_PRE_BOUNDARY)
      K_RECOVERY_ATTEMPTED=false
      K_RECOVERY_RESULT=NOT_REQUIRED
      K_SAFETY_OUTCOME=NO_RECOVERY
      ;;
    FORWARD_SUCCESS_COMMITTED|FORWARD_FAILURE_TERMINAL_SAFE|HARNESS_FAILURE_TERMINAL_SAFE)
      if [ "$leg" = fault ] && [ "$phase" != ROLLED_BACK ]; then
        needs_recovery=true
      else
        K_RECOVERY_ATTEMPTED=false
        K_RECOVERY_RESULT=NOT_REQUIRED
        K_SAFETY_OUTCOME=COMMITTED
      fi
      ;;
    FORWARD_ROLLED_BACK_SAFE)
      K_RECOVERY_ATTEMPTED=false
      K_RECOVERY_RESULT=ROLLED_BACK
      K_SAFETY_OUTCOME=ROLLED_BACK
      ;;
    *)
      needs_recovery=true
      ;;
  esac

  if [ "$needs_recovery" = true ]; then
    K_RECOVERY_ATTEMPTED=true
    K_RECOVERY_RESULT=FAILED
    K_SAFETY_OUTCOME=RECOVERY_FAILED
    export K_RECOVERY_ATTEMPTED K_RECOVERY_RESULT K_SAFETY_OUTCOME
    k_record_best_effort "$records_file" recovery attempted true
    if ! k_require_durable_recovery_artifact 0 1 1; then
      k_mark_evidence_incomplete 'Exact durable recovery R could not be validated'
    fi
    k_record_best_effort "$records_file" recovery state_ambiguous "${K_RECOVERY_STATE_AMBIGUOUS:-false}"
    # A post-boundary validation failure must not suppress the recovery call:
    # the rollback path performs its own exact-R checks and records failure if
    # the persisted material cannot be used.
    K_RECOVERY_REQUIRED_AFTER_FORWARD=1
    export K_RECOVERY_REQUIRED_AFTER_FORWARD
    k_run_rollback_observed || true
    rollback_status="${K_ROLLBACK_STATUS:-1}"
    observer_status="${K_ROLLBACK_OBSERVER_STATUS:-1}"
    if k_durable_rollback_proven "$phase_file"; then
      K_RECOVERY_RESULT=ROLLED_BACK
      K_SAFETY_OUTCOME=ROLLED_BACK
      [ "$rollback_status" -eq 0 ] || k_mark_evidence_incomplete 'Rollback executor returned failure after durable ROLLED_BACK/current=P'
      [ "$observer_status" -eq 0 ] || k_mark_evidence_incomplete 'Rollback completed but phase observation evidence is incomplete'
    else
      K_RECOVERY_RESULT=FAILED
      K_SAFETY_OUTCOME=RECOVERY_FAILED
      if [ "$rollback_status" -eq 0 ]; then
        k_mark_evidence_incomplete 'Rollback executor returned success without durable ROLLED_BACK/current=P'
      fi
    fi
    k_record_best_effort "$records_file" recovery result "$K_RECOVERY_RESULT"
    k_record_best_effort "$records_file" safety outcome "$K_SAFETY_OUTCOME"
  else
    k_record_best_effort "$records_file" recovery attempted false
    k_record_best_effort "$records_file" recovery result "$K_RECOVERY_RESULT"
    k_record_best_effort "$records_file" safety outcome "$K_SAFETY_OUTCOME"
  fi
  k_write_leg_outcomes || true
  export K_RECOVERY_ATTEMPTED K_RECOVERY_RESULT K_SAFETY_OUTCOME
  return 0
}

k_finalize_leg_evidence() {
  local leg="$1"
  local records_file="$2"
  local history_file="$3"
  local history_status=0
  local diagnostic_status=0
  local output_status=0

  if k_collect_diagnostic; then diagnostic_status=0; else diagnostic_status=$?; fi
  if [ "$diagnostic_status" -ne 0 ]; then
    k_mark_evidence_incomplete 'Post-forward diagnostic collection failed'
  else
    k_record_best_effort "$records_file" diagnostic provenance "${K_DIAGNOSTIC_PROVENANCE:-not-required}"
  fi

  if [ "$leg" = fault ]; then
    if k_validate_transaction_history "$history_file" \
      PREPARED SWITCHING ACTIVATED_UNVERIFIED FAILED ROLLING_BACK ROLLED_BACK; then
      history_status=0
    elif k_validate_transaction_history "$history_file" PREPARED SWITCHING FAILED ROLLING_BACK ROLLED_BACK; then
      history_status=0
    fi
  else
    if k_validate_transaction_history "$history_file" PREPARED SWITCHING ACTIVATED_UNVERIFIED VERIFIED COMMITTED; then
      history_status=0
    else
      history_status=$?
    fi
  fi
  if [ "$history_status" -ne 0 ]; then
    k_mark_evidence_incomplete 'Transaction history validation failed'
  fi
  if ! k_record_transaction_history "$records_file" "$history_file"; then
    k_mark_evidence_incomplete 'Transaction history evidence recording failed'
  fi
  k_record_phase_state "$records_file" || k_mark_evidence_incomplete 'Final durable phase evidence is unavailable'
  k_record_best_effort "$records_file" outcome safety "${K_SAFETY_OUTCOME:-UNKNOWN}"
  k_record_best_effort "$records_file" outcome evidence "${K_EVIDENCE_OUTCOME:-UNKNOWN}"
  k_record_best_effort "$records_file" outcome recovery_attempted "${K_RECOVERY_ATTEMPTED:-false}"
  k_record_best_effort "$records_file" outcome recovery_result "${K_RECOVERY_RESULT:-UNKNOWN}"
  k_write_leg_outcomes || k_mark_evidence_incomplete 'Outcome evidence could not be persisted'
  if k_build_evidence "$records_file" "$K_EVIDENCE_DIR"; then
    output_status=0
  else
    output_status=$?
    k_mark_evidence_incomplete 'Evidence bundle construction failed'
  fi
  k_write_leg_outcomes || true
  [ "$diagnostic_status" -eq 0 ] && [ "$history_status" -eq 0 ] && [ "$output_status" -eq 0 ] &&
    [ "${K_EVIDENCE_OUTCOME:-INCOMPLETE}" = COMPLETE ]
}

k_validate_transaction_history() {
  local history_file="$1"
  shift
  local expected_phase=""
  local actual_phase=""
  local line=""
  local index=0
  local count=0
  local -a expected_phases=( "$@" )
  local expected_count="${#expected_phases[@]}"
  local recovery_source_field=""
  local recovery_artifact_field=""
  local recovery_executor_field=""
  local recovery_path_field=""
  local transaction_id_field=""

  [ -f "$history_file" ] && [ ! -L "$history_file" ] || {
    k_error "Transaction history is missing: $history_file"
    return 1
  }
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    [[ "$line" == DEPLOYMENT_PHASE=* ]] || {
      k_error 'Transaction history contains an invalid record'
      return 1
    }
    actual_phase="${line#DEPLOYMENT_PHASE=}"
    actual_phase="${actual_phase%% *}"
    case "$actual_phase" in
      PREPARED|SWITCHING|ACTIVATED_UNVERIFIED|VERIFIED|COMMITTED|FAILED|ROLLING_BACK|ROLLED_BACK) ;;
      *) k_error "Transaction history contains an unknown phase: $actual_phase"; return 1 ;;
    esac
    [ "$count" -lt "$expected_count" ] || {
      k_error 'Transaction history contains more phases than expected'
      return 1
    }
    expected_phase="${expected_phases[$index]}"
    [ "$actual_phase" = "$expected_phase" ] || {
      k_error "Transaction history phase mismatch: expected=$expected_phase actual=$actual_phase"
      return 1
    }
    [[ "$line" == *'DEPLOYMENT_PHASE_UPDATED_AT='* ]] || return 1
    [[ "$line" == *'MUTATION_BOUNDARY_REACHED='* ]] || return 1
    if [ -n "${K_TRANSACTION_ID:-}" ]; then
      printf -v transaction_id_field 'DEPLOYMENT_TRANSACTION_ID=%q' "$K_TRANSACTION_ID"
      [[ "$line" == *"$transaction_id_field"* ]] || {
        k_error 'Transaction history belongs to a different transaction attempt'
        return 1
      }
    fi
    if [ "$actual_phase" = SWITCHING ]; then
      [[ "$line" == *'MUTATION_BOUNDARY_REACHED=1 '* ]] || {
        k_error 'SWITCHING history record does not prove the mutation boundary'
        return 1
      }
      if [ -n "${K_RECOVERY_ARTIFACT_SHA256:-}" ]; then
        printf -v recovery_source_field 'RECOVERY_SOURCE_SHA=%q' "${K_RECOVERY_SOURCE_SHA:-}"
        printf -v recovery_artifact_field 'RECOVERY_ARTIFACT_SHA256=%q' "${K_RECOVERY_ARTIFACT_SHA256:-}"
        printf -v recovery_executor_field 'RECOVERY_EXECUTOR_SHA256=%q' "${K_RECOVERY_EXECUTOR_SHA256:-}"
        printf -v recovery_path_field 'RECOVERY_ARTIFACT_PATH=%q' "${K_RECOVERY_PERSISTED_FILE:-}"
        [[ "$line" == *"$recovery_source_field"* ]] || {
          k_error 'SWITCHING history record does not prove the independent recovery source'
          return 1
        }
        [[ "$line" == *"$recovery_artifact_field"* ]] || {
          k_error 'SWITCHING history record does not prove the persisted recovery artifact'
          return 1
        }
        [[ "$line" == *"$recovery_executor_field"* ]] || {
          k_error 'SWITCHING history record does not prove the recovery executor identity'
          return 1
        }
        [[ "$line" == *"$recovery_path_field"* ]] || {
          k_error 'SWITCHING history record does not prove the recovery artifact path'
          return 1
        }
      fi
    fi
    count=$((count + 1))
    index=$((index + 1))
  done < "$history_file"
  [ "$count" -eq "$expected_count" ] || {
    k_error "Transaction history is incomplete: expected=$expected_count actual=$count"
    return 1
  }
}

k_record_transaction_history() {
  local records_file="$1"
  local history_file="$2"
  local line=""
  local phase=""
  local updated_at=""

  while IFS= read -r line; do
    [ -n "$line" ] || continue
    phase="${line#DEPLOYMENT_PHASE=}"
    phase="${phase%% *}"
    updated_at="${line#*DEPLOYMENT_PHASE_UPDATED_AT=}"
    updated_at="${updated_at%% *}"
    k_record "$records_file" phase_history "$phase" "$updated_at" || return 1
  done < "$history_file"
}

k_snapshot_container_ids() {
  local service="$1"
  local ids=""
  local id=""
  local count=0

  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$K_COMPOSE_PROJECT" --filter "label=com.docker.compose.service=$service")" || return 1
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    count=$((count + 1))
    printf '%s\n' "$id"
  done <<< "$ids"
  [ "$count" -eq 1 ] || { k_error "Expected exactly one $service container, found $count"; return 1; }
}

k_validate_project_container_inventory() {
  local ids=""
  local id=""
  local service=""
  local count=0
  local -A seen=()

  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$K_COMPOSE_PROJECT")" || return 1
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    service="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id")" || return 1
    case "$service" in
      gateway|api|spa|windows-offline-installer-provision)
        seen["$service"]=$(( ${seen[$service]:-0} + 1 ))
        count=$((count + 1))
        ;;
      *)
        k_error "Unexpected Compose service in the fenced project: $service"
        return 1
        ;;
    esac
  done <<< "$ids"
  [ "$count" -eq 4 ] || {
    k_error "Expected exactly four runtime containers in $K_COMPOSE_PROJECT, found $count"
    return 1
  }
  for service in gateway api spa windows-offline-installer-provision; do
    [ "${seen[$service]:-0}" -eq 1 ] || {
      k_error "Expected exactly one Compose service container: $service"
      return 1
    }
  done
}

k_snapshot_mounts() {
  local container_id="$1"
  local raw=""
  local name=""
  local source=""
  local destination=""
  local writable=""
  local identity=""
  local mode=""
  local result=""

  raw="$(docker inspect -f '{{range .Mounts}}{{printf "%s|%s|%s|%t\n" .Name .Source .Destination .RW}}{{end}}' "$container_id")" || return 1
  while IFS='|' read -r name source destination writable; do
    [ -n "$destination" ] || continue
    identity="${name:-$source}"
    mode=ro
    [ "$writable" = true ] && mode=rw
    [ -n "$result" ] && result+=','
    result+="$identity|$destination|$mode"
  done <<< "$raw"
  printf '%s\n' "$result"
}

k_snapshot_service() {
  local service="$1"
  local prefix="$2"
  local id=""
  local metadata=""
  local name=""
  local project=""
  local actual_service=""
  local image=""
  local status=""
  local digest=""
  local networks=""
  local mounts=""

  id="$(k_snapshot_container_ids "$service")" || return 1
  metadata="$(docker inspect -f '{{.Id}}|{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}|{{.State.Status}}' "$id")" || return 1
  IFS='|' read -r id name project actual_service image status <<< "$metadata"
  name="${name#/}"
  digest="$(docker inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$id" | awk 'NF { if (count++) printf ","; printf "%s", $0 }')" || return 1
  networks="$(docker inspect -f '{{range $name, $network := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$id" | awk 'NF { if (count++) printf ","; printf "%s", $0 }')" || return 1
  mounts="$(k_snapshot_mounts "$id")" || return 1
  printf 'LIVE_%s_ID=%s\n' "$prefix" "$id"
  printf 'LIVE_%s_NAME=%s\n' "$prefix" "$name"
  printf 'LIVE_%s_PROJECT=%s\n' "$prefix" "$project"
  printf 'LIVE_%s_SERVICE=%s\n' "$prefix" "$actual_service"
  printf 'LIVE_%s_IMAGE=%s\n' "$prefix" "$image"
  printf 'LIVE_%s_IMAGE_DIGEST=%s\n' "$prefix" "$digest"
  printf 'LIVE_%s_STATUS=%s\n' "$prefix" "$status"
  printf 'LIVE_%s_NETWORKS=%s\n' "$prefix" "$networks"
  printf 'LIVE_%s_MOUNTS=%s\n' "$prefix" "$mounts"
}

k_snapshot_volume() {
  local prefix="$1"
  local volume_name="$2"
  local metadata=""
  local name=""
  local mountpoint=""
  local project=""
  local compose_key=""

  metadata="$(docker volume inspect -f '{{.Name}}|{{.Mountpoint}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}' "$volume_name")" || return 1
  IFS='|' read -r name mountpoint project compose_key <<< "$metadata"
  printf 'LIVE_VOLUME_%s_ID=%s\n' "$prefix" "$name"
  printf 'LIVE_VOLUME_%s_NAME=%s\n' "$prefix" "$name"
  printf 'LIVE_VOLUME_%s_MOUNTPOINT=%s\n' "$prefix" "$mountpoint"
  printf 'LIVE_VOLUME_%s_PROJECT=%s\n' "$prefix" "$project"
  printf 'LIVE_VOLUME_%s_COMPOSE_KEY=%s\n' "$prefix" "$compose_key"
}

k_mount_value() {
  local mounts="$1"
  local destination="$2"
  printf '%s\n' "$mounts" | tr ',' '\n' | awk -F'|' -v expected="$destination" '$2 == expected { print; exit }'
}

k_container_env_value() {
  local container_id="$1"
  local expected_key="$2"
  local env_lines=""
  local line=""
  local key=""
  local value=""
  local count=0

  env_lines="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container_id")" || return 1
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key="${line%%=*}"
    value="${line#*=}"
    if [ "$key" = "$expected_key" ]; then
      count=$((count + 1))
      printf '%s\n' "$value"
    fi
  done <<< "$env_lines"
  [ "$count" -eq 1 ]
}

k_hash_live_runtime_projection() {
  local output_file="$1"
  local expected_file="${K_EXPECTED_RUNTIME_PROJECTION_FILE:-}"
  local service=""
  local id=""
  local key=""
  local expected=""
  local actual=""

  [ -f "$expected_file" ] || {
    k_error 'Live runtime attestation requires the exact verifier runtime projection'
    return 1
  }
  k_validate_runtime_projection_file "$expected_file" || return 1
  : > "$output_file"
  for service in gateway api provision; do
    case "$service" in
      gateway) id="$(k_read_required_file_value "$K_SNAPSHOT_TEMP" LIVE_GATEWAY_ID)" ;;
      api) id="$(k_read_required_file_value "$K_SNAPSHOT_TEMP" LIVE_API_ID)" ;;
      provision) id="$(k_read_required_file_value "$K_SNAPSHOT_TEMP" LIVE_PROVISION_ID)" ;;
    esac
    for key in "${K_RUNTIME_PROJECTION_KEYS[@]}"; do
      expected="$(k_read_required_file_value "$expected_file" "$key")" || return 1
      actual="$(k_container_env_value "$id" "$key")" || {
        k_error "$service container is missing exactly one runtime projection value: $key"
        return 1
      }
      [ "$actual" = "$expected" ] || {
        k_error "$service container runtime projection differs for $key"
        return 1
      }
    done
  done
  for key in "${K_RUNTIME_PROJECTION_KEYS[@]}"; do
    printf '%s=%s\n' "$key" "$(k_read_required_file_value "$expected_file" "$key")" >> "$output_file"
  done
  k_hash_file "$output_file"
}

k_ready_response_is_semantically_ready() {
  local response_file="$1"
  local verifier_image="$2"
  local response=""

  k_require_immutable_image K_EXPECTED_VERIFIER_IMAGE "$verifier_image" || return 1
  response="$(cat "$response_file")"
  printf '%s' "$response" |
    docker run --rm -i --entrypoint node "$verifier_image" -e '
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        try {
          const parsed = JSON.parse(input);
          const valid = parsed !== null && typeof parsed === "object" &&
            !Array.isArray(parsed) && parsed.ready === true;
          process.exit(valid ? 0 : 1);
        } catch { process.exit(1); }
      });
    '
}

k_http_probe() {
  local url="$1"
  local body_file="$2"
  local status=""

  status="$(curl -sS --max-time "${K_CURL_TIMEOUT_SECONDS:-10}" -o "$body_file" -w '%{http_code}' "$url" 2>/dev/null || true)"
  [[ "$status" =~ ^[0-9]{3}$ ]] || status=000
  printf '%s\n' "$status"
}

k_collect_snapshot() {
  local snapshot_file="$1"
  local mode="${2:-durable}"
  local expected_release_id="${3:-}"
  local expected_bundle_file="${4:-}"
  local expected_contract_file="${5:-}"
  local expected_runtime_file="${6:-}"
  local state_dir="$K_DEPLOY_ROOT/release-state"
  local current=""
  local previous=""
  local release_dir=""
  local temp=""
  local body_dir=""
  local projection_file=""
  local ready_body=""
  local health_body=""
  local ready_status=""
  local health_status=""

  case "$mode" in
    durable|pre-activation)
      ;;
    *)
      k_error "Unknown snapshot mode: $mode"
      return 1
      ;;
  esac
  mkdir -p "$(dirname "$snapshot_file")"
  temp="$(mktemp "$snapshot_file.tmp.XXXXXX")" || return 1
  body_dir="$(mktemp -d)" || { rm -f "$temp"; return 1; }
  if [ "$mode" = durable ]; then
    current="$(tr -d '\r\n' < "$state_dir/current" 2>/dev/null || true)"
    previous="$(tr -d '\r\n' < "$state_dir/previous" 2>/dev/null || true)"
    [ -n "$current" ] || { rm -rf "$body_dir"; rm -f "$temp"; k_error 'current pointer is missing'; return 1; }
    release_dir="$state_dir/releases/$current"
    for file in classroompath-release-bundle.json openpath-promotion-contract.json runtime.env; do
      [ -f "$release_dir/$file" ] || { rm -rf "$body_dir"; rm -f "$temp"; return 1; }
    done
    {
      printf 'STATE_CURRENT_RELEASE_ID=%s\n' "$current"
      printf 'STATE_PREVIOUS_RELEASE_ID=%s\n' "$previous"
      printf 'DURABLE_BUNDLE_SHA256=%s\n' "$(k_hash_file "$release_dir/classroompath-release-bundle.json")"
      printf 'DURABLE_CONTRACT_SHA256=%s\n' "$(k_hash_file "$release_dir/openpath-promotion-contract.json")"
      printf 'DURABLE_RUNTIME_SHA256=%s\n' "$(k_hash_file "$release_dir/runtime.env")"
      printf 'DURABLE_RC_RUN_ID=%s\n' "$(k_read_file_value "$release_dir/runtime.env" RC_RUN_ID || true)"
      printf 'LIVE_CHECKOUT_SHA=%s\n' "$(git -C "$K_APP_DIR" rev-parse HEAD)"
      printf 'LIVE_OPENPATH_GITLINK_SHA=%s\n' "$(git -C "$K_APP_DIR" rev-parse HEAD:upstream/openpath)"
      printf 'WORKTREE_CLEAN=%s\n' "${K0_WORKTREE_CLEAN:-true}"
    } > "$temp"
  else
    [ -n "$expected_release_id" ] && [ -f "$expected_bundle_file" ] &&
      [ -f "$expected_contract_file" ] && [ -f "$expected_runtime_file" ] || {
        rm -rf "$body_dir"
        rm -f "$temp"
        k_error 'Pre-activation snapshot requires the exact expected release artifacts'
        return 1
      }
    {
      printf 'STATE_CURRENT_RELEASE_ID=UNPERSISTED\n'
      printf 'STATE_PREVIOUS_RELEASE_ID=UNPERSISTED\n'
      printf 'LIVE_EXPECTED_RELEASE_ID=%s\n' "$expected_release_id"
      printf 'LIVE_EXPECTED_BUNDLE_SHA256=%s\n' "$(k_hash_file "$expected_bundle_file")"
      printf 'LIVE_EXPECTED_CONTRACT_SHA256=%s\n' "$(k_hash_file "$expected_contract_file")"
      printf 'LIVE_EXPECTED_RC_RUN_ID=%s\n' "${K_EXPECTED_RC_RUN_ID:-}"
      printf 'LIVE_CHECKOUT_SHA=%s\n' "$(git -C "$K_APP_DIR" rev-parse HEAD)"
      printf 'LIVE_OPENPATH_GITLINK_SHA=%s\n' "$(git -C "$K_APP_DIR" rev-parse HEAD:upstream/openpath)"
      printf 'WORKTREE_CLEAN=%s\n' "${K0_WORKTREE_CLEAN:-true}"
    } > "$temp"
  fi
  k_validate_project_container_inventory || return 1
  k_snapshot_service gateway GATEWAY >> "$temp" || return 1
  k_snapshot_service api API >> "$temp" || return 1
  k_snapshot_service spa SPA >> "$temp" || return 1
  k_snapshot_service windows-offline-installer-provision PROVISION >> "$temp" || return 1
  printf 'LIVE_PROJECT=%s\n' "$K_COMPOSE_PROJECT" >> "$temp"
  k_snapshot_volume API_DATA "$K_EXPECTED_API_DATA_VOLUME" >> "$temp" || return 1
  k_snapshot_volume TEMPLATES "$K_EXPECTED_TEMPLATES_VOLUME" >> "$temp" || return 1
  k_snapshot_volume ARTIFACTS "$K_EXPECTED_ARTIFACTS_VOLUME" >> "$temp" || return 1
  printf 'LIVE_API_DATA_MOUNT=%s\n' "$(k_mount_value "$(k_read_required_file_value "$temp" LIVE_API_MOUNTS)" /app/data)" >> "$temp"
  printf 'LIVE_PROVISION_TEMPLATES_MOUNT=%s\n' "$(k_mount_value "$(k_read_required_file_value "$temp" LIVE_PROVISION_MOUNTS)" /app/var/windows-offline-installer/templates)" >> "$temp"
  printf 'LIVE_API_TEMPLATES_MOUNT=%s\n' "$(k_mount_value "$(k_read_required_file_value "$temp" LIVE_API_MOUNTS)" /app/var/windows-offline-installer/templates)" >> "$temp"
  printf 'LIVE_API_ARTIFACTS_MOUNT=%s\n' "$(k_mount_value "$(k_read_required_file_value "$temp" LIVE_API_MOUNTS)" /app/var/windows-offline-installer/artifacts)" >> "$temp"
  printf 'LIVE_API_FIREFOX_MOUNT=%s\n' "$(k_mount_value "$(k_read_required_file_value "$temp" LIVE_API_MOUNTS)" /openpath-firefox-release)" >> "$temp"
  projection_file="$body_dir/runtime-live-projection.env"
  K_SNAPSHOT_TEMP="$temp"
  export K_SNAPSHOT_TEMP
  printf 'LIVE_RUNTIME_PROJECTION_SHA256=%s\n' "$(k_hash_live_runtime_projection "$projection_file")" >> "$temp"
  health_body="$body_dir/health.body"
  ready_body="$body_dir/ready.body"
  health_status="$(k_http_probe "$K_BASE_URL/cp/health" "$health_body")"
  ready_status="$(k_http_probe "$K_BASE_URL/cp/ready" "$ready_body")"
  printf 'HEALTH_HTTP_STATUS=%s\n' "$health_status" >> "$temp"
  printf 'READY_HTTP_STATUS=%s\n' "$ready_status" >> "$temp"
  printf 'READY_BODY_SHA256=%s\n' "$(k_hash_file "$ready_body")" >> "$temp"
  if [ "$ready_status" = 200 ] && k_ready_response_is_semantically_ready "$ready_body" "${K_EXPECTED_VERIFIER_IMAGE:-$K_P_VERIFIER_IMAGE}"; then
    printf 'READY_JSON_VALID=true\nREADY=true\n' >> "$temp"
  else
    printf 'READY_JSON_VALID=false\nREADY=false\n' >> "$temp"
  fi
  mv "$temp" "$snapshot_file"
  rm -rf "$body_dir"
  printf '%s\n' "$snapshot_file"
}

k_stage_immutable_copy() {
  local source="$1"
  local destination="$2"
  local source_hash=""

  [ -f "$source" ] && [ ! -L "$source" ] || return 1
  [ ! -L "$destination" ] || {
    k_error "Immutable staged destination must not be a symlink: $destination"
    return 1
  }
  source_hash="$(k_hash_file "$source")"
  if [ -e "$destination" ]; then
    [ -f "$destination" ] || {
      k_error "Immutable staged destination is not a regular file: $destination"
      return 1
    }
    cmp -- "$source" "$destination" || { k_error "Immutable staged copy differs: $destination"; return 1; }
    return 0
  fi
  mkdir -p "$(dirname "$destination")"
  install -m 600 "$source" "$destination"
  [ "$(k_hash_file "$destination")" = "$source_hash" ]
}

k_stage_recovery_before_boundary() {
  local generation_file="${K_RECOVERY_GENERATION_FILE:-$K_EVIDENCE_DIR/recovery-generation.env}"
  local prepared_file="${K_RECOVERY_PREPARED_FILE:-$K_EVIDENCE_DIR/recovery-prepared.env}"
  local expected_persisted=""
  local persisted_release_root=""
  local existing_entry=""

  k_validate_prepared_recovery_artifact || return 1
  K_RECOVERY_TRANSMITTED_FILE="${K_RECOVERY_TRANSMITTED_FILE:-$K_EVIDENCE_DIR/recovery-transmitted.tgz}"
  k_validate_evidence_path "$K_RECOVERY_TRANSMITTED_FILE" 'Transmitted recovery artifact' || return 1
  expected_persisted="$K_DEPLOY_ROOT/recovery/releases/$K_RECOVERY_ARTIFACT_SHA256/production-recovery-bundle.tgz"
  if [ -n "${K_RECOVERY_PERSISTED_FILE:-}" ] && [ "$K_RECOVERY_PERSISTED_FILE" != "$expected_persisted" ]; then
    k_error 'K_RECOVERY_PERSISTED_FILE must be the canonical artifact path for the exact R hash'
    return 1
  fi
  K_RECOVERY_PERSISTED_FILE="$expected_persisted"
  export K_RECOVERY_TRANSMITTED_FILE K_RECOVERY_PERSISTED_FILE
  k_validate_evidence_path "$generation_file" 'Recovery generation record' || return 1
  k_validate_evidence_path "$prepared_file" 'Recovery prepared record' || return 1
  k_stage_immutable_copy "$K_RECOVERY_ARTIFACT_FILE" "$K_RECOVERY_TRANSMITTED_FILE" || return 1
  persisted_release_root="$(dirname "$K_RECOVERY_PERSISTED_FILE")"
  if [ -e "$K_RECOVERY_PERSISTED_FILE" ]; then
    k_validate_recovery_persisted || return 1
    k_require_durable_recovery_artifact || return 1
  elif [ -e "$persisted_release_root" ]; then
    [ -d "$persisted_release_root" ] || {
      k_error 'Recovery release path exists but is not a directory'
      return 1
    }
    for existing_entry in "$persisted_release_root"/* "$persisted_release_root"/.[!.]* "$persisted_release_root"/..?*; do
      [ -e "$existing_entry" ] || continue
      k_error 'Recovery release path contains state without the exact durable identity'
      return 1
    done
  fi
  if [ -f "$generation_file" ]; then
    [ "$(k_read_required_file_value "$generation_file" RECOVERY_GENERATION_COUNT)" = 1 ] || return 1
    [ "$(k_read_required_file_value "$generation_file" RECOVERY_ARTIFACT_SHA256)" = "$K_RECOVERY_ARTIFACT_SHA256" ] || return 1
  else
    {
      printf 'RECOVERY_GENERATION_COUNT=1\n'
      printf 'RECOVERY_ARTIFACT_SHA256=%s\n' "$K_RECOVERY_ARTIFACT_SHA256"
    } > "$generation_file"
    chmod 600 "$generation_file"
  fi
  {
    printf 'RECOVERY_PREPARED_BEFORE_BOUNDARY=true\n'
    printf 'RECOVERY_SOURCE_SHA=%s\n' "$K_RECOVERY_SOURCE_SHA"
    printf 'RECOVERY_CONTRACT_VERSION=%s\n' "$K_RECOVERY_CONTRACT_VERSION"
    printf 'RECOVERY_SOURCE_VERSION=%s\n' "$K_RECOVERY_SOURCE_VERSION"
    printf 'RECOVERY_ARTIFACT_SHA256=%s\n' "$K_RECOVERY_ARTIFACT_SHA256"
    printf 'RECOVERY_EXECUTOR_SHA256=%s\n' "$K_RECOVERY_EXECUTOR_SHA256"
    printf 'RECOVERY_TRANSMITTED_FILE=%s\n' "$K_RECOVERY_TRANSMITTED_FILE"
    printf 'RECOVERY_PERSISTED_FILE=%s\n' "$K_RECOVERY_PERSISTED_FILE"
    printf 'RECOVERY_PERSISTED_BEFORE_BOUNDARY=%s\n' "$([ -f "$K_RECOVERY_PERSISTED_FILE" ] && printf true || printf false)"
  } > "$prepared_file"
  chmod 600 "$prepared_file"
  K_RECOVERY_PREPARED_FILE="$prepared_file"
  export K_RECOVERY_PREPARED_FILE
}

k_stage_candidate_entrypoint() {
  local source="${K_C_FORWARD_ENTRYPOINT_SOURCE_FILE:-}"
  local destination="${K_C_FORWARD_ENTRYPOINT_FILE:-$K_EVIDENCE_DIR/candidate-forward.sh}"
  local expected_sha="${K_C_FORWARD_ENTRYPOINT_SHA256:-}"
  local canonical_source="${K_C_SOURCE_DIR:-}/scripts/deploy-production-remote.sh"

  [ -n "$source" ] || {
    k_error 'K_C_FORWARD_ENTRYPOINT_SOURCE_FILE must be the externally staged exact C entrypoint'
    return 1
  }
  k_validate_external_file "$source" 'Candidate forward entrypoint source' || return 1
  k_validate_evidence_path "$destination" 'Candidate forward entrypoint destination' || return 1
  [ -f "$canonical_source" ] || {
    k_error 'Candidate source checkout has no production forward entrypoint'
    return 1
  }
  cmp -- "$source" "$canonical_source" || {
    k_error 'Candidate forward entrypoint is not the exact file from C'
    return 1
  }
  k_require_sha64 K_C_FORWARD_ENTRYPOINT_SHA256 "$expected_sha" || return 1
  if [ ! -f "$destination" ]; then
    mkdir -p "$(dirname "$destination")"
    k_stage_immutable_copy "$source" "$destination" || return 1
    chmod 700 "$destination"
  fi
  [ "$(k_hash_file "$destination")" = "$expected_sha" ] || {
    k_error 'Candidate forward entrypoint hash mismatch'
    return 1
  }
  K_C_FORWARD_ENTRYPOINT_FILE="$destination"
  export K_C_FORWARD_ENTRYPOINT_FILE
}

k_validate_candidate_payload() {
  local payload="${K_C_PAYLOAD_FILE:-}"
  local temp_dir=""
  local manifest=""
  local bundle=""
  local contract=""
  local mapping=""
  local key=""
  local expected_name=""
  local expected=""
  local actual=""
  local -a mappings=(
    "gateway_image|K_C_GATEWAY_IMAGE"
    "migrations_image|K_C_MIGRATIONS_IMAGE"
    "openpath_firefox_assets_image|K_C_FIREFOX_ASSETS_IMAGE"
    "openpath_api_image|K_C_OPENPATH_API_IMAGE"
    "spa_image|K_C_SPA_IMAGE"
    "verifier_image|K_C_VERIFIER_IMAGE"
  )
  k_validate_external_file "$payload" 'Candidate deploy payload' || return 1
  [ "$(k_read_required_file_value "$payload" deploy_sha)" = "$K_CANDIDATE_SHA" ] || {
    k_error 'Candidate deploy payload SHA differs from C'
    return 1
  }
  [ "$(k_read_required_file_value "$payload" image_source)" = release-candidate ] || return 1
  [ "$(k_read_required_file_value "$payload" deployment_mode)" = promotion-eligible ] || return 1
  [ "$(k_read_required_file_value "$payload" release_id)" = "$K_C_RELEASE_ID" ] || return 1
  [ "$(k_read_required_file_value "$payload" rc_run_id)" = "$K_C_RC_RUN_ID" ] || return 1
  manifest="$(k_read_required_file_value "$payload" manifest_base64)" || return 1
  bundle="$(k_read_required_file_value "$payload" release_bundle_base64)" || return 1
  contract="$(k_read_required_file_value "$payload" openpath_contract_base64)" || return 1
  [ "${#manifest}" -le 262144 ] && [ "${#bundle}" -le 262144 ] && [ "${#contract}" -le 262144 ] || {
    k_error 'Candidate deploy payload contains an unbounded encoded artifact'
    return 1
  }
  temp_dir="$(mktemp -d)"
  if ! printf '%s' "$manifest" | base64 --decode > "$temp_dir/manifest.env" ||
    ! printf '%s' "$bundle" | base64 --decode > "$temp_dir/bundle.json" ||
    ! printf '%s' "$contract" | base64 --decode > "$temp_dir/contract.json"; then
    rm -rf "$temp_dir"
    k_error 'Candidate deploy payload contains invalid base64'
    return 1
  fi
  cmp -- "$K_C_BUNDLE_FILE" "$temp_dir/bundle.json" || {
    rm -rf "$temp_dir"
    k_error 'Candidate payload bundle bytes differ from the exact C bundle'
    return 1
  }
  cmp -- "$K_C_CONTRACT_FILE" "$temp_dir/contract.json" || {
    rm -rf "$temp_dir"
    k_error 'Candidate payload contract bytes differ from the exact C contract'
    return 1
  }
  k_source_common_helper || { rm -rf "$temp_dir"; return 1; }
  # shellcheck source=lib/release-manifest.sh
  source "$K_HARNESS_DIR/lib/release-manifest.sh"
  release_manifest_validate_contract "$temp_dir/manifest.env" "$K_C_APP_SHA" || {
    rm -rf "$temp_dir"
    return 1
  }
  for mapping in "${mappings[@]}"; do
    key="${mapping%%|*}"
    expected_name="${mapping#*|}"
    expected="${!expected_name:-}"
    actual="$(release_manifest_get "$temp_dir/manifest.env" "$key")" || {
      rm -rf "$temp_dir"
      return 1
    }
    [ "$actual" = "$expected" ] || {
      rm -rf "$temp_dir"
      k_error "Candidate payload manifest differs for $key"
      return 1
    }
  done
  rm -rf "$temp_dir"
  k_info 'exact C deploy payload identity passed'
}

k_validate_candidate_source_checkout() {
  local source_dir="${K_C_SOURCE_DIR:-}"
  local actual_sha=""
  local status=""
  local required_file=""

  k_validate_external_directory "$source_dir" 'Candidate source checkout' || return 1
  [ -e "$source_dir/.git" ] && [ ! -L "$source_dir/.git" ] || {
    k_error 'Candidate source checkout has a missing or symlinked .git'
    return 1
  }
  actual_sha="$(git -C "$source_dir" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)"
  [ "$actual_sha" = "$K_CANDIDATE_SHA" ] || {
    k_error 'Candidate source checkout does not resolve to the exact C'
    return 1
  }
  status="$(git -C "$source_dir" status --porcelain=v1 --untracked-files=all)" || return 1
  [ -z "$status" ] || {
    k_error 'Candidate source checkout is not clean'
    printf '%s\n' "$status" >&2
    return 1
  }
  [ ! -e "$source_dir/config/.env.bak-billingfix-20260623" ] || {
    k_error 'Protected billing backup is present in the candidate source checkout'
    return 1
  }
  actual_sha="$(git -C "$source_dir" rev-parse HEAD:upstream/openpath 2>/dev/null || true)"
  [ "$actual_sha" = "$K_C_OPENPATH_SHA" ] || {
    k_error 'Candidate source OpenPath gitlink differs from C Release Bundle'
    return 1
  }
  for required_file in \
    scripts/deploy-production-remote.sh \
    scripts/lib/deployment-transaction.sh \
    scripts/lib/production-recovery-artifact.sh \
    scripts/production-deployment-diagnostic.sh; do
    [ -f "$source_dir/$required_file" ] && [ ! -L "$source_dir/$required_file" ] || {
      k_error "Candidate source checkout is missing $required_file"
      return 1
    }
  done
}

k_validate_candidate_identity() {
  k_require_sha40 K_CANDIDATE_SHA "${K_CANDIDATE_SHA:-}" || return 1
  k_require_sha40 K_C_APP_SHA "${K_C_APP_SHA:-}" || return 1
  [ "$K_CANDIDATE_SHA" = "$K_C_APP_SHA" ] || {
    k_error 'Candidate identity C must equal the Release Bundle ClassroomPath SHA'
    return 1
  }
  k_require_immutable_image K_C_GATEWAY_IMAGE "${K_C_GATEWAY_IMAGE:-}" || return 1
  if [ -n "${K_CANDIDATE_GATEWAY_IMAGE:-}" ] &&
    [ "$K_CANDIDATE_GATEWAY_IMAGE" != "$K_C_GATEWAY_IMAGE" ]; then
    k_error 'Candidate watchdog image must equal the exact C gateway image'
    return 1
  fi
}

k_stage_stable_rollback_wrapper() {
  local source="${K_RECOVERY_WRAPPER_SOURCE_FILE:-}"
  local destination="${K_RECOVERY_WRAPPER_FILE:-$K_EVIDENCE_DIR/rollback-production-remote.sh}"
  local canonical_source="${K_RECOVERY_SOURCE_DIR:-}/scripts/rollback-production-remote.sh"
  [ -n "$source" ] || { k_error 'K_RECOVERY_WRAPPER_SOURCE_FILE is required'; return 1; }
  k_validate_external_file "$source" 'Stable rollback wrapper source' || return 1
  k_validate_evidence_path "$destination" 'Stable rollback wrapper destination' || return 1
  [ -f "$canonical_source" ] || {
    k_error 'Recovery source checkout has no stable rollback wrapper'
    return 1
  }
  cmp -- "$source" "$canonical_source" || {
    k_error 'Stable rollback wrapper is not the exact file from R'
    return 1
  }
  k_require_sha64 K_RECOVERY_WRAPPER_SHA256 "${K_RECOVERY_WRAPPER_SHA256:-}" || return 1
  if [ ! -f "$destination" ]; then
    k_stage_immutable_copy "$source" "$destination" || return 1
    chmod 700 "$destination"
  fi
  [ "$(k_hash_file "$destination")" = "$K_RECOVERY_WRAPPER_SHA256" ] || {
    k_error 'Stable rollback wrapper hash mismatch'
    return 1
  }
  case "$destination" in
    "$K_APP_DIR"|"$K_APP_DIR"/*) k_error 'Rollback wrapper must be outside APP_DIR'; return 1 ;;
  esac
  K_RECOVERY_WRAPPER_FILE="$destination"
  export K_RECOVERY_WRAPPER_FILE
}

k_stage_diagnostic_fallback() {
  local source="${K_DIAGNOSTIC_FALLBACK_FILE:-}"
  local destination="${K_DIAGNOSTIC_STAGED_FALLBACK_FILE:-$K_EVIDENCE_DIR/diagnostic-fallback.sh}"
  local canonical_source="${K_RECOVERY_SOURCE_DIR:-}/scripts/lib/production-deployment-diagnostic-fallback.sh"

  [ -n "$source" ] || { k_error 'K_DIAGNOSTIC_FALLBACK_FILE is required'; return 1; }
  k_validate_external_file "$source" 'Stable diagnostic fallback source' || return 1
  k_validate_evidence_path "$destination" 'Stable diagnostic fallback destination' || return 1
  [ -f "$canonical_source" ] || {
    k_error 'Recovery source checkout has no diagnostic fallback'
    return 1
  }
  cmp -- "$source" "$canonical_source" || {
    k_error 'Diagnostic fallback is not the exact file from R'
    return 1
  }
  case "$source" in
    "$K_APP_DIR"|"$K_APP_DIR"/*) k_error 'Diagnostic fallback must be outside APP_DIR'; return 1 ;;
  esac
  k_require_sha64 K_DIAGNOSTIC_FALLBACK_SHA256 "${K_DIAGNOSTIC_FALLBACK_SHA256:-}" || return 1
  [ "$(k_hash_file "$source")" = "$K_DIAGNOSTIC_FALLBACK_SHA256" ] || return 1
  k_stage_immutable_copy "$source" "$destination" || return 1
  chmod 700 "$destination"
  K_DIAGNOSTIC_STAGED_FALLBACK_FILE="$destination"
  export K_DIAGNOSTIC_STAGED_FALLBACK_FILE
}

k_require_durable_recovery_artifact() {
  local require_transmitted="${1:-1}"
  local allow_missing_transmitted="${2:-0}"
  local allow_ambiguous_state="${3:-0}"
  local identity_file="$K_DEPLOY_ROOT/recovery/current-artifact.env"
  local transaction_file="$K_DEPLOY_ROOT/release-state/deployment-phase.env"
  local artifact_path=""
  local artifact_sha=""
  local identity_recovery_sha=""
  local identity_source_sha=""
  local identity_contract_version=""
  local identity_source_version=""
  local identity_executor_sha=""
  local identity_candidate_sha=""
  local identity_artifact_version=""
  local identity_preflight=""
  local extracted_dir=""
  local expected_artifact_path=""
  local state_transaction_id=""
  local state_candidate_release_id=""
  local state_candidate_sha=""
  local state_recovery_artifact_version=""
  local state_recovery_source_sha=""
  local state_recovery_contract_version=""
  local state_recovery_source_version=""
  local state_recovery_artifact_sha256=""
  local state_recovery_executor_sha256=""
  local state_recovery_artifact_path=""
  local state_identity_complete=1

  K_RECOVERY_STATE_AMBIGUOUS=0
  export K_RECOVERY_STATE_AMBIGUOUS

  [ -f "$identity_file" ] && [ ! -L "$identity_file" ] || { k_error 'Durable recovery identity is missing or symlinked'; return 1; }
  k_source_recovery_artifact_helper || return 1
  identity_artifact_version="$(k_read_required_file_value "$identity_file" PRODUCTION_RECOVERY_ARTIFACT_VERSION)" || return 1
  identity_recovery_sha="$(k_read_required_file_value "$identity_file" PRODUCTION_RECOVERY_SHA)" || return 1
  identity_source_sha="$(k_read_required_file_value "$identity_file" PRODUCTION_RECOVERY_SOURCE_SHA)" || return 1
  identity_contract_version="$(k_read_required_file_value "$identity_file" PRODUCTION_RECOVERY_CONTRACT_VERSION)" || return 1
  identity_source_version="$(k_read_required_file_value "$identity_file" PRODUCTION_RECOVERY_SOURCE_VERSION)" || return 1
  artifact_sha="$(k_read_required_file_value "$identity_file" PRODUCTION_RECOVERY_ARTIFACT_SHA256)" || return 1
  identity_executor_sha="$(k_read_required_file_value "$identity_file" PRODUCTION_RECOVERY_EXECUTOR_SHA256)" || return 1
  identity_candidate_sha="$(k_read_required_file_value "$identity_file" PRODUCTION_RECOVERY_CANDIDATE_SHA)" || return 1
  identity_preflight="$(k_read_required_file_value "$identity_file" PRODUCTION_RECOVERY_PREFLIGHT)" || return 1
  artifact_path="$(k_read_required_file_value "$identity_file" PRODUCTION_RECOVERY_ARTIFACT_PATH)" || return 1
  [ "$identity_artifact_version" = 1 ] || return 1
  [ "${K_RECOVERY_SHA:-$identity_recovery_sha}" = "$identity_recovery_sha" ] || return 1
  [ "${K_RECOVERY_SOURCE_SHA:-$identity_source_sha}" = "$identity_source_sha" ] || return 1
  [ "${K_RECOVERY_CONTRACT_VERSION:-$identity_contract_version}" = "$identity_contract_version" ] || return 1
  [ "${K_RECOVERY_SOURCE_VERSION:-$identity_source_version}" = "$identity_source_version" ] || return 1
  [ "${K_RECOVERY_ARTIFACT_SHA256:-$artifact_sha}" = "$artifact_sha" ] || return 1
  [ "${K_RECOVERY_EXECUTOR_SHA256:-$identity_executor_sha}" = "$identity_executor_sha" ] || return 1
  [ "${K_CANDIDATE_SHA:-$identity_candidate_sha}" = "$identity_candidate_sha" ] || return 1
  [ "$identity_preflight" = passed ] || return 1
  K_RECOVERY_SHA="$identity_recovery_sha"
  K_RECOVERY_SOURCE_SHA="$identity_source_sha"
  K_RECOVERY_CONTRACT_VERSION="$identity_contract_version"
  K_RECOVERY_SOURCE_VERSION="$identity_source_version"
  K_RECOVERY_ARTIFACT_SHA256="$artifact_sha"
  K_RECOVERY_EXECUTOR_SHA256="$identity_executor_sha"
  K_CANDIDATE_SHA="$identity_candidate_sha"
  K_RECOVERY_PERSISTED_FILE="$artifact_path"
  export K_RECOVERY_SHA K_RECOVERY_SOURCE_SHA K_RECOVERY_CONTRACT_VERSION K_RECOVERY_SOURCE_VERSION
  export K_RECOVERY_ARTIFACT_SHA256 K_RECOVERY_EXECUTOR_SHA256 K_CANDIDATE_SHA K_RECOVERY_PERSISTED_FILE
  expected_artifact_path="$K_DEPLOY_ROOT/recovery/releases/$K_RECOVERY_ARTIFACT_SHA256/production-recovery-bundle.tgz"
  [ "$artifact_path" = "$expected_artifact_path" ] || {
    k_error 'Durable recovery artifact must use the canonical hash-addressed path'
    return 1
  }
  if [ "$allow_ambiguous_state" = 1 ]; then
    if [ -f "$transaction_file" ] && [ ! -L "$transaction_file" ]; then
      state_transaction_id="$(k_read_file_value "$transaction_file" DEPLOYMENT_TRANSACTION_ID || true)"
      state_candidate_release_id="$(k_read_file_value "$transaction_file" CANDIDATE_RELEASE_ID || true)"
      state_candidate_sha="$(k_read_file_value "$transaction_file" CANDIDATE_SHA || true)"
      state_recovery_artifact_version="$(k_read_file_value "$transaction_file" RECOVERY_ARTIFACT_VERSION || true)"
      state_recovery_source_sha="$(k_read_file_value "$transaction_file" RECOVERY_SOURCE_SHA || true)"
      state_recovery_contract_version="$(k_read_file_value "$transaction_file" RECOVERY_CONTRACT_VERSION || true)"
      state_recovery_source_version="$(k_read_file_value "$transaction_file" RECOVERY_SOURCE_VERSION || true)"
      state_recovery_artifact_sha256="$(k_read_file_value "$transaction_file" RECOVERY_ARTIFACT_SHA256 || true)"
      state_recovery_executor_sha256="$(k_read_file_value "$transaction_file" RECOVERY_EXECUTOR_SHA256 || true)"
      state_recovery_artifact_path="$(k_read_file_value "$transaction_file" RECOVERY_ARTIFACT_PATH || true)"
      if [ -z "${K_TRANSACTION_ID:-}" ] || [ "$state_transaction_id" != "$K_TRANSACTION_ID" ] ||
        [ -z "${K_C_RELEASE_ID:-}" ] || [ "$state_candidate_release_id" != "$K_C_RELEASE_ID" ] ||
        [ -z "${K_CANDIDATE_SHA:-}" ] || [ "$state_candidate_sha" != "$K_CANDIDATE_SHA" ] ||
        [ "$state_recovery_artifact_version" != 1 ] ||
        [ -z "${K_RECOVERY_SOURCE_SHA:-}" ] || [ "$state_recovery_source_sha" != "$K_RECOVERY_SOURCE_SHA" ] ||
        [ -z "${K_RECOVERY_CONTRACT_VERSION:-}" ] || [ "$state_recovery_contract_version" != "$K_RECOVERY_CONTRACT_VERSION" ] ||
        [ -z "${K_RECOVERY_SOURCE_VERSION:-}" ] || [ "$state_recovery_source_version" != "$K_RECOVERY_SOURCE_VERSION" ] ||
        [ -z "${K_RECOVERY_ARTIFACT_SHA256:-}" ] || [ "$state_recovery_artifact_sha256" != "$K_RECOVERY_ARTIFACT_SHA256" ] ||
        [ -z "${K_RECOVERY_EXECUTOR_SHA256:-}" ] || [ "$state_recovery_executor_sha256" != "$K_RECOVERY_EXECUTOR_SHA256" ] ||
        [ -z "${K_RECOVERY_PERSISTED_FILE:-}" ] || [ "$state_recovery_artifact_path" != "$K_RECOVERY_PERSISTED_FILE" ]; then
        state_identity_complete=0
      fi
    else
      state_identity_complete=0
    fi
    if [ "$state_identity_complete" -ne 1 ]; then
      # R remains the only recovery source after the forward may have crossed
      # the boundary.  The executor must still prove ROLLED_BACK/current=P
      # before this function reports a safe result.
      K_RECOVERY_STATE_AMBIGUOUS=1
      export K_RECOVERY_STATE_AMBIGUOUS
    fi
  else
    [ -f "$transaction_file" ] && [ ! -L "$transaction_file" ] || return 1
    [ "$(k_read_required_file_value "$transaction_file" RECOVERY_ARTIFACT_VERSION)" = 1 ] || return 1
    [ "$(k_read_required_file_value "$transaction_file" RECOVERY_SOURCE_SHA)" = "$K_RECOVERY_SOURCE_SHA" ] || return 1
    [ "$(k_read_required_file_value "$transaction_file" RECOVERY_CONTRACT_VERSION)" = "$K_RECOVERY_CONTRACT_VERSION" ] || return 1
    [ "$(k_read_required_file_value "$transaction_file" RECOVERY_SOURCE_VERSION)" = "$K_RECOVERY_SOURCE_VERSION" ] || return 1
    [ "$(k_read_required_file_value "$transaction_file" RECOVERY_ARTIFACT_SHA256)" = "$K_RECOVERY_ARTIFACT_SHA256" ] || return 1
    [ "$(k_read_required_file_value "$transaction_file" RECOVERY_EXECUTOR_SHA256)" = "$K_RECOVERY_EXECUTOR_SHA256" ] || return 1
    [ "$(k_read_required_file_value "$transaction_file" RECOVERY_ARTIFACT_PATH)" = "$K_RECOVERY_PERSISTED_FILE" ] || return 1
  fi
  [ -f "$artifact_path" ] && [ ! -L "$artifact_path" ] || return 1
  [ "$(k_hash_file "$artifact_path")" = "$K_RECOVERY_ARTIFACT_SHA256" ] || return 1
  production_recovery_artifact_archive_has_safe_paths "$artifact_path" || return 1
  extracted_dir="$(mktemp -d)" || return 1
  if ! tar -xzf "$artifact_path" -C "$extracted_dir" --no-same-owner --no-same-permissions; then
    rm -rf "$extracted_dir"
    k_error 'Durable recovery artifact cannot be extracted'
    return 1
  fi
  if ! production_recovery_artifact_bundle_is_complete "$extracted_dir"; then
    rm -rf "$extracted_dir"
    return 1
  fi
  rm -rf "$extracted_dir"
  if [ "$require_transmitted" = 1 ] || [ -n "${K_RECOVERY_TRANSMITTED_FILE:-}" ]; then
    if [ -f "${K_RECOVERY_TRANSMITTED_FILE:-}" ] && [ ! -L "$K_RECOVERY_TRANSMITTED_FILE" ]; then
      cmp -- "$K_RECOVERY_TRANSMITTED_FILE" "$artifact_path" || {
        k_error 'Transmitted recovery bytes differ from durable bytes'
        return 1
      }
    elif [ "$require_transmitted" = 1 ] || [ "$allow_missing_transmitted" != 1 ] ||
      [ -e "${K_RECOVERY_TRANSMITTED_FILE:-}" ]; then
      k_error 'Transmitted recovery artifact is required for this rollback path'
      return 1
    fi
  fi
}

k_validate_manual_rollback_fence() {
  local phase_file="$K_DEPLOY_ROOT/release-state/deployment-phase.env"
  local phase=""
  local boundary=""
  local current=""
  local previous=""
  local candidate=""
  local candidate_sha=""
  local transaction_id=""
  local expected_artifact=""

  K_MANUAL_ROLLBACK_NOOP=0
  [ -f "$phase_file" ] && [ ! -L "$phase_file" ] || {
    k_error 'Manual rollback requires a readable durable transaction state'
    return 1
  }
  phase="$(k_read_required_file_value "$phase_file" DEPLOYMENT_PHASE)" || return 1
  boundary="$(k_read_required_file_value "$phase_file" MUTATION_BOUNDARY_REACHED)" || return 1
  current="$(k_read_required_file_value "$phase_file" CURRENT_RELEASE_ID)" || return 1
  previous="$(k_read_required_file_value "$phase_file" PREVIOUS_RELEASE_ID)" || return 1
  candidate="$(k_read_required_file_value "$phase_file" CANDIDATE_RELEASE_ID)" || return 1
  candidate_sha="$(k_read_required_file_value "$phase_file" CANDIDATE_SHA)" || return 1
  transaction_id="$(k_read_required_file_value "$phase_file" DEPLOYMENT_TRANSACTION_ID)" || return 1
  k_require_transaction_id "$transaction_id" || return 1
  [ -n "${K_P_RELEASE_ID:-}" ] && [ "$previous" = "$K_P_RELEASE_ID" ] || {
    k_error 'Manual rollback transaction does not identify the configured baseline P'
    return 1
  }
  [ -n "${K_C_RELEASE_ID:-}" ] && [ "$candidate" = "$K_C_RELEASE_ID" ] || {
    k_error 'Manual rollback transaction does not identify the configured candidate C'
    return 1
  }
  [ -n "${K_CANDIDATE_SHA:-}" ] && [ "$candidate_sha" = "$K_CANDIDATE_SHA" ] || {
    k_error 'Manual rollback transaction does not identify the configured candidate SHA'
    return 1
  }
  if [ "$phase" = ROLLED_BACK ] && [ "$boundary" = 1 ] && [ "$current" = "$previous" ]; then
    K_MANUAL_ROLLBACK_NOOP=1
    export K_MANUAL_ROLLBACK_NOOP
    k_info 'Manual rollback fence shows that P is already restored; no mutation required'
    return 0
  fi
  [ "$boundary" = 1 ] || {
    k_error 'Manual rollback refuses a transaction that has not crossed the mutation boundary'
    return 1
  }
  case "$phase" in
    SWITCHING|ACTIVATED_UNVERIFIED|VERIFIED|COMMITTED|FAILED|ROLLING_BACK) ;;
    *) k_error "Manual rollback refuses phase $phase"; return 1 ;;
  esac
  [ -n "${K_PREVIOUS_RELEASE_ID:-}" ] && [ "$previous" = "$K_PREVIOUS_RELEASE_ID" ] || {
    k_error 'Manual rollback transaction does not identify the expected baseline P'
    return 1
  }
  k_require_durable_recovery_artifact 0 1 || return 1
  expected_artifact="$K_DEPLOY_ROOT/recovery/releases/$K_RECOVERY_ARTIFACT_SHA256/production-recovery-bundle.tgz"
  [ "$K_RECOVERY_PERSISTED_FILE" = "$expected_artifact" ] || {
    k_error 'Manual rollback must use the canonical persisted recovery artifact path'
    return 1
  }
  export K_MANUAL_ROLLBACK_NOOP
}

k_run_forward_from_stdin() {
  local payload_b64=""
  local recovery_b64=""
  local effective_path="${K_EFFECTIVE_HOST_PATH:-${PATH:-}}"

  k_validate_candidate_payload || return 1
  k_preflight_recovery || return 1
  k_validate_recovery_transmitted || return 1
  [ "$(k_read_required_file_value "${K_RECOVERY_PREPARED_FILE:-$K_EVIDENCE_DIR/recovery-prepared.env}" RECOVERY_PREPARED_BEFORE_BOUNDARY)" = true ] || {
    k_error 'Forward executor requires recovery bytes staged before the mutation boundary'
    return 1
  }
  payload_b64="$(base64 "$K_C_PAYLOAD_FILE" | tr -d '\r\n')"
  recovery_b64="$(base64 "$K_RECOVERY_TRANSMITTED_FILE" | tr -d '\r\n')"
  (
    cd "$K_APP_DIR"
    PATH="$effective_path" env \
      -u PRODUCTION_RECOVERY_SHA -u PRODUCTION_RECOVERY_SOURCE_SHA \
      -u PRODUCTION_RECOVERY_ARTIFACT_SHA256 -u PRODUCTION_RECOVERY_EXECUTOR_SHA256 \
      -u PRODUCTION_RECOVERY_CONTRACT_VERSION -u PRODUCTION_RECOVERY_SOURCE_VERSION \
      -u PRODUCTION_RECOVERY_BUNDLE_B64 \
      DEPLOYMENT_TRANSACTION_HISTORY_FILE="${K_TRANSACTION_HISTORY_FILE:-}" \
      DEPLOYMENT_TRANSACTION_ID="${K_TRANSACTION_ID:-}" \
      COMPOSE_PROJECT_NAME="$K_COMPOSE_PROJECT" CLASSROOMPATH_DEPLOY_ROOT="$K_DEPLOY_ROOT" \
      APP_DIR="$K_APP_DIR" DEPLOY_SHA="$K_CANDIDATE_SHA" CANDIDATE_SHA="$K_CANDIDATE_SHA" \
      DEPLOY_PAYLOAD_B64="$payload_b64" \
      PRODUCTION_HOST_NETWORK_URL="$K_NETWORK_PREFLIGHT_URL" \
      PRODUCTION_CONTAINER_PLATFORM="${K_CONTAINER_PLATFORM:-linux/amd64}" \
      PRODUCTION_RECOVERY_SHA="$K_RECOVERY_SHA" PRODUCTION_RECOVERY_SOURCE_SHA="$K_RECOVERY_SOURCE_SHA" \
      PRODUCTION_RECOVERY_CONTRACT_VERSION="$K_RECOVERY_CONTRACT_VERSION" PRODUCTION_RECOVERY_SOURCE_VERSION="$K_RECOVERY_SOURCE_VERSION" \
      PRODUCTION_RECOVERY_ARTIFACT_SHA256="$K_RECOVERY_ARTIFACT_SHA256" PRODUCTION_RECOVERY_EXECUTOR_SHA256="$K_RECOVERY_EXECUTOR_SHA256" \
      PRODUCTION_RECOVERY_BUNDLE_B64="$recovery_b64" \
      CLASSROOMPATH_CONTAINER_PLATFORM="${K_CONTAINER_PLATFORM:-linux/amd64}" \
      bash -s < "$K_C_FORWARD_ENTRYPOINT_FILE"
  )
}

k_run_rollback_from_stdin() {
  local recovery_b64=""
  local effective_path="${K_EFFECTIVE_HOST_PATH:-${PATH:-}}"
  local history_file="${K_TRANSACTION_HISTORY_FILE:-}"

  if [ "${K_MANUAL_ROLLBACK:-0}" = 1 ]; then
    k_validate_manual_rollback_fence || return 1
    [ "${K_MANUAL_ROLLBACK_NOOP:-0}" = 1 ] && return 0
    history_file=""
  fi
  k_stage_stable_rollback_wrapper || return 1
  if [ "${K_MANUAL_ROLLBACK:-0}" = 1 ]; then
    k_require_durable_recovery_artifact 0 1 || return 1
  elif [ "${K_RECOVERY_REQUIRED_AFTER_FORWARD:-0}" = 1 ]; then
    # The persisted R archive is the recovery source of truth once the
    # boundary is crossed.  Compare a transmitted copy when it survives, but
    # do not let a post-boundary evidence failure suppress recovery.
    k_require_durable_recovery_artifact 0 1 1 || return 1
  else
    k_require_durable_recovery_artifact || return 1
  fi
  if [ "${K_MANUAL_ROLLBACK:-0}" = 1 ]; then
    # Re-read the durable fence after all artifact checks and immediately
    # before transmitting R; an intervening successful rollback is a safe
    # no-op, while any other fence drift aborts without host mutation.
    k_validate_manual_rollback_fence || return 1
    [ "${K_MANUAL_ROLLBACK_NOOP:-0}" = 1 ] && return 0
  fi
  recovery_b64="$(base64 "$K_RECOVERY_PERSISTED_FILE" | tr -d '\r\n')"
  (
    cd "$K_APP_DIR"
    PATH="$effective_path" env \
      -u PRODUCTION_RECOVERY_EXECUTOR_PATH -u PRODUCTION_RECOVERY_SHA \
      -u PRODUCTION_RECOVERY_SOURCE_SHA -u PRODUCTION_RECOVERY_ARTIFACT_SHA256 \
      -u PRODUCTION_RECOVERY_EXECUTOR_SHA256 -u PRODUCTION_RECOVERY_CONTRACT_VERSION \
      -u PRODUCTION_RECOVERY_SOURCE_VERSION \
      DEPLOYMENT_TRANSACTION_HISTORY_FILE="$history_file" \
      DEPLOYMENT_TRANSACTION_ID="${K_TRANSACTION_ID:-}" \
      CANDIDATE_RELEASE_ID="${K_C_RELEASE_ID:-}" \
      PREVIOUS_RELEASE_ID="${K_PREVIOUS_RELEASE_ID:-}" \
      RECOVERY_REQUIRED_AFTER_FORWARD="${K_RECOVERY_REQUIRED_AFTER_FORWARD:-0}" \
      PRODUCTION_RECOVERY_SHA="$K_RECOVERY_SHA" PRODUCTION_RECOVERY_SOURCE_SHA="$K_RECOVERY_SOURCE_SHA" \
      PRODUCTION_RECOVERY_CONTRACT_VERSION="$K_RECOVERY_CONTRACT_VERSION" PRODUCTION_RECOVERY_SOURCE_VERSION="$K_RECOVERY_SOURCE_VERSION" \
      PRODUCTION_RECOVERY_ARTIFACT_SHA256="$K_RECOVERY_ARTIFACT_SHA256" PRODUCTION_RECOVERY_EXECUTOR_SHA256="$K_RECOVERY_EXECUTOR_SHA256" \
      PRODUCTION_RECOVERY_BUNDLE_B64="$recovery_b64" CANDIDATE_SHA="$K_CANDIDATE_SHA" \
      CLASSROOMPATH_DEPLOY_ROOT="$K_DEPLOY_ROOT" APP_DIR="$K_APP_DIR" COMPOSE_PROJECT_NAME="$K_COMPOSE_PROJECT" \
      PRODUCTION_HOST_NETWORK_URL="$K_NETWORK_PREFLIGHT_URL" \
      PRODUCTION_CONTAINER_PLATFORM="${K_CONTAINER_PLATFORM:-linux/amd64}" \
      PRODUCTION_ROLLBACK_PUBLIC_URL="$K_BASE_URL" \
      bash -s < "$K_RECOVERY_WRAPPER_FILE"
  )
}

k_run_rollback_observed() {
  local phase_file="$K_DEPLOY_ROOT/release-state/deployment-phase.env"
  local observations_file="${K_ROLLBACK_PHASE_OBSERVATIONS_FILE:-$K_EVIDENCE_DIR/rollback-phase-observations.env}"
  local rollback_pid=0
  local observer_pid=0
  local rollback_status=0
  local observer_status=0
  local observer_enabled=0

  if k_initialize_rollback_phase_observations; then
    observer_enabled=1
  else
    k_error 'Rollback phase observer could not initialize; continuing recovery without observer evidence'
  fi
  k_run_rollback_from_stdin &
  rollback_pid=$!
  if [ "$observer_enabled" -eq 1 ]; then
    k_observe_rollback_phases "$rollback_pid" "$phase_file" "$observations_file" &
    observer_pid=$!
  fi
  if wait "$rollback_pid"; then rollback_status=0; else rollback_status=$?; fi
  if [ "$observer_enabled" -eq 1 ]; then
    if wait "$observer_pid"; then observer_status=0; else observer_status=$?; fi
  else
    observer_status=1
  fi
  K_ROLLBACK_STATUS="$rollback_status"
  K_ROLLBACK_OBSERVER_STATUS="$observer_status"
  export K_ROLLBACK_STATUS K_ROLLBACK_OBSERVER_STATUS
  [ "$observer_status" -eq 0 ] || {
    k_error 'Rollback phase observer failed; rollback evidence is incomplete'
    return 1
  }
  return "$rollback_status"
}

k_watchdog_select_candidate() {
  local phase_file="$1"
  local records_file="$2"
  local previous_gateway_id="$3"
  local expected_image="$4"
  local phase=""
  local id=""
  local project=""
  local service=""
  local image=""
  local name=""
  local status=""
  local candidate=""
  local count=0

  phase="$(k_read_required_file_value "$phase_file" DEPLOYMENT_PHASE)" || return 1
  [ "$phase" = ACTIVATED_UNVERIFIED ] || {
    k_error "Watchdog may act only at ACTIVATED_UNVERIFIED (observed $phase)"
    return 1
  }
  while IFS='|' read -r id project service image name status; do
    [ -n "$id" ] || continue
    [ "$project" = "$K_HARNESS_COMPOSE_PROJECT" ] || continue
    [ "$service" = gateway ] || continue
    [ "$id" != "$previous_gateway_id" ] || continue
    [ "$image" = "$expected_image" ] || continue
    [ "$status" = running ] || continue
    candidate="$id"
    count=$((count + 1))
  done < "$records_file"
  [ "$count" -eq 1 ] || {
    k_error "Watchdog could not identify exactly one distinct candidate gateway (count=$count)"
    return 1
  }
  printf '%s\n' "$candidate"
}

k_watchdog_attempt_is_prepared() {
  local phase_file="$1"
  local expected_transaction_id="$2"
  local expected_release_id="$3"
  local expected_candidate_sha="$4"
  local phase=""
  local boundary=""
  local current=""
  local previous=""

  [ -f "$phase_file" ] && [ ! -L "$phase_file" ] || return 1
  phase="$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE || true)"
  boundary="$(k_read_file_value "$phase_file" MUTATION_BOUNDARY_REACHED || true)"
  current="$(k_read_file_value "$phase_file" CURRENT_RELEASE_ID || true)"
  previous="$(k_read_file_value "$phase_file" PREVIOUS_RELEASE_ID || true)"
  [ "$phase" = PREPARED ] || return 1
  [ "$boundary" = 0 ] || return 1
  [ -n "$current" ] && [ "$current" = "$previous" ] && [ "$current" != "$expected_release_id" ] || return 1
  [ -z "${K_PREVIOUS_RELEASE_ID:-}" ] || [ "$current" = "$K_PREVIOUS_RELEASE_ID" ] || return 1
  [ "$(k_read_file_value "$phase_file" DEPLOYMENT_TRANSACTION_ID || true)" = "$expected_transaction_id" ] || return 1
  [ "$(k_read_file_value "$phase_file" CANDIDATE_RELEASE_ID || true)" = "$expected_release_id" ] || return 1
  [ "$(k_read_file_value "$phase_file" CANDIDATE_SHA || true)" = "$expected_candidate_sha" ] || return 1
}

k_watchdog_attempt_is_activated() {
  local phase_file="$1"
  local expected_transaction_id="$2"
  local expected_release_id="$3"
  local expected_candidate_sha="$4"
  local phase=""
  local current=""
  local previous=""

  [ -f "$phase_file" ] && [ ! -L "$phase_file" ] || return 1
  phase="$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE || true)"
  current="$(k_read_file_value "$phase_file" CURRENT_RELEASE_ID || true)"
  previous="$(k_read_file_value "$phase_file" PREVIOUS_RELEASE_ID || true)"
  [ "$phase" = ACTIVATED_UNVERIFIED ] || return 1
  [ "$(k_read_file_value "$phase_file" MUTATION_BOUNDARY_REACHED || true)" = 1 ] || return 1
  [ -n "$current" ] && [ "$current" = "$previous" ] && [ "$current" != "$expected_release_id" ] || return 1
  [ -z "${K_PREVIOUS_RELEASE_ID:-}" ] || [ "$current" = "$K_PREVIOUS_RELEASE_ID" ] || return 1
  [ "$(k_read_file_value "$phase_file" DEPLOYMENT_TRANSACTION_ID || true)" = "$expected_transaction_id" ] || return 1
  [ "$(k_read_file_value "$phase_file" CANDIDATE_RELEASE_ID || true)" = "$expected_release_id" ] || return 1
  [ "$(k_read_file_value "$phase_file" CANDIDATE_SHA || true)" = "$expected_candidate_sha" ] || return 1
}

k_watchdog_act_once() {
  local phase_file="$1"
  local records_file="$2"
  local previous_gateway_id="$3"
  local expected_image="$4"
  local docker_bin="$5"
  local marker_file="$6"
  local expected_transaction_id="${7:-${K_TRANSACTION_ID:-}}"
  local expected_release_id="${8:-${K_C_RELEASE_ID:-}}"
  local expected_candidate_sha="${9:-${K_CANDIDATE_SHA:-}}"
  local candidate=""
  local name=""

  k_require_transaction_id "$expected_transaction_id" || return 1
  k_require_sha40 watchdog_candidate_sha "$expected_candidate_sha" || return 1
  [ -n "$expected_release_id" ] || { k_error 'Watchdog requires the current candidate release ID'; return 1; }
  [ ! -e "$marker_file" ] && [ ! -L "$marker_file" ] || {
    k_error 'Watchdog is one-shot and already acted'
    return 1
  }
  k_watchdog_attempt_is_activated "$phase_file" "$expected_transaction_id" "$expected_release_id" "$expected_candidate_sha" || {
    k_error 'Watchdog transaction window does not belong to the current attempt'
    return 1
  }
  candidate="$(k_watchdog_select_candidate "$phase_file" "$records_file" "$previous_gateway_id" "$expected_image")" || return 1
  [ "$candidate" != "$previous_gateway_id" ] || return 1
  name="$(awk -F'|' -v expected_id="$candidate" '$1 == expected_id { print $5; exit }' "$records_file")"
  name="${name#/}"
  [ "$name" = "${K_EXPECTED_GATEWAY_NAME:-classroompath-gateway}" ] || {
    k_error 'Watchdog candidate has an unexpected Compose container name'
    return 1
  }
  k_watchdog_attempt_is_activated "$phase_file" "$expected_transaction_id" "$expected_release_id" "$expected_candidate_sha" || {
    k_error 'Watchdog transaction window closed before stopping the candidate gateway'
    return 1
  }
  [ ! -e "$marker_file" ] && [ ! -L "$marker_file" ] || {
    k_error 'Watchdog marker appeared before the candidate stop'
    return 1
  }
  "$docker_bin" stop "$candidate" >/dev/null
  mkdir -p "$(dirname "$marker_file")"
  [ ! -e "$marker_file" ] && [ ! -L "$marker_file" ] || {
    k_error 'Watchdog marker appeared before evidence could be written'
    return 1
  }
  {
    printf 'FAULT_TARGET_CONTAINER_ID=%s\n' "$candidate"
    printf 'FAULT_PHASE=ACTIVATED_UNVERIFIED\n'
    printf 'FAULT_TRANSACTION_ID=%s\n' "$expected_transaction_id"
    printf 'FAULT_CANDIDATE_RELEASE_ID=%s\n' "$expected_release_id"
    printf 'FAULT_CANDIDATE_SHA=%s\n' "$expected_candidate_sha"
  } > "$marker_file"
}

k_watchdog_loop() {
  local expected_transaction_id="${1:-${K_TRANSACTION_ID:-}}"
  local expected_release_id="${2:-${K_C_RELEASE_ID:-}}"
  local expected_candidate_sha="${3:-${K_CANDIDATE_SHA:-}}"
  local phase_file="$K_DEPLOY_ROOT/release-state/deployment-phase.env"
  local records_file="${K_WATCHDOG_RECORDS_FILE:-$K_EVIDENCE_DIR/watchdog-containers.txt}"
  local marker_file="${K_FAULT_TARGET_FILE:-$K_EVIDENCE_DIR/fault-target.env}"
  local attempts="${K_WATCHDOG_MAX_ATTEMPTS:-120}"
  local attempt=0
  local id=""
  local metadata=""
  local phase=""
  local prepared_observed=0

  k_require_immutable_image K_C_GATEWAY_IMAGE "${K_C_GATEWAY_IMAGE:-}" || return 1
  k_require_transaction_id "$expected_transaction_id" || return 1
  k_require_sha40 watchdog_candidate_sha "$expected_candidate_sha" || return 1
  [ -n "$expected_release_id" ] || { k_error 'Watchdog requires the current candidate release ID'; return 1; }
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    phase="$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE || true)"
    if [ "$prepared_observed" -eq 0 ]; then
      if k_watchdog_attempt_is_prepared "$phase_file" "$expected_transaction_id" "$expected_release_id" "$expected_candidate_sha"; then
        prepared_observed=1
      else
        sleep "${K_WATCHDOG_POLL_SECONDS:-1}"
        continue
      fi
    fi
    if k_watchdog_attempt_is_activated "$phase_file" "$expected_transaction_id" "$expected_release_id" "$expected_candidate_sha"; then
      : > "$records_file"
      while IFS= read -r id; do
        [ -n "$id" ] || continue
        metadata="$(docker inspect -f '{{.Id}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.Config.Image}}|{{.Name}}|{{.State.Status}}' "$id")" || return 1
        printf '%s\n' "$metadata" >> "$records_file"
      done < <(docker ps -aq --filter "label=com.docker.compose.project=$K_COMPOSE_PROJECT" --filter 'label=com.docker.compose.service=gateway')
      k_watchdog_act_once "$phase_file" "$records_file" "$K_BASELINE_GATEWAY_ID" "$K_C_GATEWAY_IMAGE" "$(command -v docker)" "$marker_file" "$expected_transaction_id" "$expected_release_id" "$expected_candidate_sha"
      return $?
    fi
    if [ "$phase" = FAILED ] && [ "$(k_read_file_value "$phase_file" MUTATION_BOUNDARY_REACHED || true)" = 0 ]; then
      k_info 'Watchdog observed the current attempt fail before the mutation boundary'
      return 0
    fi
    case "$phase" in
      VERIFIED|COMMITTED|ROLLED_BACK|FAILED)
        k_error 'Watchdog phase window closed for the current transaction attempt'
        return 1
        ;;
    esac
    sleep "${K_WATCHDOG_POLL_SECONDS:-1}"
  done
  k_error 'Watchdog timed out waiting for PREPARED and ACTIVATED_UNVERIFIED of the current transaction'
}

k_validate_fault_target_evidence() {
  local marker_file="${K_FAULT_TARGET_FILE:-$K_EVIDENCE_DIR/fault-target.env}"
  local records_file="${K_WATCHDOG_RECORDS_FILE:-$K_EVIDENCE_DIR/watchdog-containers.txt}"
  local target_id=""
  local target_phase=""
  local target_transaction_id=""
  local target_release_id=""
  local target_sha=""
  local matching_count=0

  [ -f "$marker_file" ] && [ ! -L "$marker_file" ] || {
    k_error 'Fault watchdog target evidence is missing or symlinked'
    return 1
  }
  target_id="$(k_read_required_file_value "$marker_file" FAULT_TARGET_CONTAINER_ID)" || return 1
  target_phase="$(k_read_required_file_value "$marker_file" FAULT_PHASE)" || return 1
  target_transaction_id="$(k_read_required_file_value "$marker_file" FAULT_TRANSACTION_ID)" || return 1
  target_release_id="$(k_read_required_file_value "$marker_file" FAULT_CANDIDATE_RELEASE_ID)" || return 1
  target_sha="$(k_read_required_file_value "$marker_file" FAULT_CANDIDATE_SHA)" || return 1
  [[ "$target_id" =~ ^[0-9a-f]{12,64}$ ]] || {
    k_error 'Fault target evidence does not contain a valid container ID'
    return 1
  }
  [ "$target_phase" = ACTIVATED_UNVERIFIED ] || {
    k_error 'Fault target evidence does not identify ACTIVATED_UNVERIFIED'
    return 1
  }
  k_require_transaction_id "$target_transaction_id" || return 1
  [ "$target_transaction_id" = "${K_TRANSACTION_ID:-}" ] || {
    k_error 'Fault target evidence belongs to another transaction attempt'
    return 1
  }
  [ "$target_release_id" = "${K_C_RELEASE_ID:-}" ] || {
    k_error 'Fault target evidence belongs to another candidate release'
    return 1
  }
  k_require_sha40 fault_target_candidate_sha "$target_sha" || return 1
  [ "$target_sha" = "${K_CANDIDATE_SHA:-}" ] || {
    k_error 'Fault target evidence belongs to another candidate SHA'
    return 1
  }
  [ "$target_id" != "${K_BASELINE_GATEWAY_ID:-}" ] || {
    k_error 'Fault target evidence points at the baseline gateway'
    return 1
  }
  [ -f "$records_file" ] && [ ! -L "$records_file" ] || {
    k_error 'Watchdog container inventory is missing or symlinked'
    return 1
  }
  k_require_immutable_image K_C_GATEWAY_IMAGE "${K_C_GATEWAY_IMAGE:-}" || return 1
  matching_count="$(awk -F'|' \
    -v expected_id="$target_id" \
    -v expected_project="$K_HARNESS_COMPOSE_PROJECT" \
    -v expected_image="$K_C_GATEWAY_IMAGE" \
    -v expected_name="${K_EXPECTED_GATEWAY_NAME:-classroompath-gateway}" '
      $1 == expected_id && $2 == expected_project && $3 == "gateway" &&
      $4 == expected_image && $6 == "running" {
        name = $5
        sub(/^\//, "", name)
        if (name == expected_name) count++
      }
      END { print count + 0 }
    ' "$records_file")" || return 1
  [ "$matching_count" -eq 1 ] || {
    k_error 'Fault target evidence does not match exactly one candidate gateway record'
    return 1
  }
  printf '%s\n' "$target_id"
}

k_diagnostic_is_candidate_valid() {
  local diagnostic_file="$1"
  local candidate_sha="$2"
  local previous_release_id="$3"

  k_validate_diagnostic_artifact "$diagnostic_file" || return 1
  grep -Fq '"mutation_boundary_reached":true' "$diagnostic_file" || return 1
  grep -Fq "\"candidateSha\":\"$candidate_sha\"" "$diagnostic_file" || return 1
  grep -Fq "\"previousReleaseId\":\"$previous_release_id\"" "$diagnostic_file" || return 1
}

k_validate_diagnostic_artifact() {
  local diagnostic_file="$1"
  local line=""
  local total=0
  local max_bytes="${K_MAX_DIAGNOSTIC_BYTES:-65536}"

  [[ "$max_bytes" =~ ^[0-9]+$ ]] || {
    k_error 'K_MAX_DIAGNOSTIC_BYTES must be numeric'
    return 1
  }
  [ -s "$diagnostic_file" ] && [ ! -L "$diagnostic_file" ] || {
    k_error 'Diagnostic artifact is missing or symlinked'
    return 1
  }
  while IFS= read -r line || [ -n "$line" ]; do
    k_contains_secret_shape "$line" && {
      k_error 'Diagnostic artifact contains secret-shaped content'
      return 1
    }
    total=$((total + ${#line} + 1))
    [ "$total" -le "$max_bytes" ] || {
      k_error 'Diagnostic artifact exceeds its bounded size'
      return 1
    }
    [ "${#line}" -le "$K_HARNESS_MAX_RECORD_BYTES" ] || {
      k_error 'Diagnostic artifact contains an oversized line'
      return 1
    }
  done < "$diagnostic_file"
}

k_collect_diagnostic() {
  local diagnostic_file="${K_DIAGNOSTIC_OUTPUT_FILE:-$K_EVIDENCE_DIR/post-switch-diagnostic.json}"
  local state_file="$K_DEPLOY_ROOT/release-state/deployment-phase.env"
  local marker=""
  local candidate_status=1
  local candidate_script="$K_APP_DIR/scripts/production-deployment-diagnostic.sh"
  local fallback="${K_DIAGNOSTIC_STAGED_FALLBACK_FILE:-}"

  marker="$(k_read_file_value "$state_file" MUTATION_BOUNDARY_REACHED || true)"
  if [ "$marker" != 1 ]; then
    K_DIAGNOSTIC_PROVENANCE=not-required
    export K_DIAGNOSTIC_PROVENANCE
    k_info 'No mutation boundary reached; no post-switch diagnostic required'
    return 0
  fi
  case "$diagnostic_file" in
    "$K_EVIDENCE_DIR"|"$K_EVIDENCE_DIR"/*) ;;
    *) k_error 'Diagnostic output must remain inside the bounded evidence directory'; return 1 ;;
  esac
  [ ! -e "$diagnostic_file" ] || {
    k_error 'Diagnostic output already exists; refusing stale evidence reuse'
    return 1
  }
  if [ -f "$candidate_script" ] && [ ! -L "$candidate_script" ] && [ -x "$candidate_script" ] &&
    env -u GHCR_USERNAME -u GHCR_TOKEN -u PRODUCTION_RECOVERY_BUNDLE_B64 \
      PRODUCTION_DIAGNOSTIC_BASE_URL="$K_BASE_URL" PRODUCTION_DIAGNOSTIC_OUTPUT="$diagnostic_file" \
      CLASSROOMPATH_DEPLOY_ROOT="$K_DEPLOY_ROOT" bash "$candidate_script" >/dev/null 2>&1 &&
    k_diagnostic_is_candidate_valid "$diagnostic_file" "$K_CANDIDATE_SHA" "$K_PREVIOUS_RELEASE_ID"; then
    candidate_status=0
  fi
  if [ "$candidate_status" -ne 0 ]; then
    [ -x "$fallback" ] || { k_error 'Independent diagnostic fallback is unavailable'; return 1; }
    rm -f "$diagnostic_file"
    env -u GHCR_USERNAME -u GHCR_TOKEN -u PRODUCTION_RECOVERY_BUNDLE_B64 \
      bash "$fallback" "$state_file" "$diagnostic_file" >/dev/null 2>&1 || true
    k_validate_diagnostic_artifact "$diagnostic_file" || {
      k_error 'Diagnostic fallback produced invalid evidence'
      return 1
    }
    K_DIAGNOSTIC_PROVENANCE=fallback
  else
    K_DIAGNOSTIC_PROVENANCE=candidate
  fi
  K_DIAGNOSTIC_OUTPUT_FILE="$diagnostic_file"
  export K_DIAGNOSTIC_OUTPUT_FILE K_DIAGNOSTIC_PROVENANCE
  k_info "post-switch diagnostic provenance=$K_DIAGNOSTIC_PROVENANCE"
}

k_record() {
  local records_file="$1"
  local kind="$2"
  local name="$3"
  local value="$4"
  local line=""

  if k_contains_secret_shape "$value"; then
    k_error "Refusing secret-shaped evidence value for $name"
    return 1
  fi
  line="{\"schemaVersion\":$K_HARNESS_SCHEMA_VERSION,\"timestampUtc\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"kind\":\"$(k_json_escape "$kind")\",\"name\":\"$(k_json_escape "$name")\",\"value\":\"$(k_json_escape "${value:0:$K_HARNESS_MAX_RECORD_BYTES}")\"}"
  [ "${#line}" -le "$K_HARNESS_MAX_RECORD_BYTES" ] || { k_error "Evidence record is too large: $name"; return 1; }
  printf '%s\n' "$line" >> "$records_file"
}

k_build_evidence() {
  local records_file="$1"
  local output_dir="$2"
  local line=""
  local first=1
  local count=0
  local total=0
  local evidence_file="$output_dir/evidence.json"
  local summary_file="$output_dir/evidence-summary.md"
  local temp=""
  local archive_list=""
  local evidence_path=""
  local evidence_basename=""
  local extra_line_total=0

  K_EVIDENCE_DIR="${K_EVIDENCE_DIR:-$output_dir}"
  k_validate_configured_path K_EVIDENCE_DIR || return 1
  mkdir -p "$K_EVIDENCE_DIR"
  export K_EVIDENCE_DIR
  k_validate_evidence_path "$output_dir" 'Evidence output directory' || return 1

  [ -f "$records_file" ] || { k_error "Evidence records are missing: $records_file"; return 1; }
  mkdir -p "$output_dir"
  temp="$(mktemp "$evidence_file.tmp.XXXXXX")" || return 1
  {
    printf '{"schemaVersion":%s,"harnessContractVersion":%s,"records":[' \
      "$K_HARNESS_SCHEMA_VERSION" "$K_HARNESS_CONTRACT_VERSION"
    while IFS= read -r line || [ -n "$line" ]; do
      [ -n "$line" ] || continue
      k_contains_secret_shape "$line" && {
        rm -f "$temp"
        k_error 'Evidence contains secret-shaped content'
        return 1
      }
      [ "${#line}" -le "$K_HARNESS_MAX_RECORD_BYTES" ] || { rm -f "$temp"; return 1; }
      total=$((total + ${#line} + 1))
      [ "$total" -le "$K_HARNESS_MAX_EVIDENCE_BYTES" ] || { rm -f "$temp"; k_error 'Evidence exceeds bounded size'; return 1; }
      [ "$first" -eq 0 ] && printf ','
      printf '%s' "$line"
      first=0
      count=$((count + 1))
    done < "$records_file"
    printf ']}\n'
  } > "$temp" || return 1
  install -m 600 "$temp" "$evidence_file"
  rm -f "$temp"
  {
    printf '# Staging-equivalent K evidence\n\n'
    printf '%s\n' '- Generated from evidence.json records.'
    printf '%s\n\n' "- Record count: $count"
    printf '## Recorded values\n\n'
    sed -n 's/.*"name":"\([^"\\]*\)".*"value":"\([^"\\]*\)".*/- \1: \2/p' "$evidence_file"
  } > "$summary_file"
  archive_list="$(mktemp)" || return 1
  printf '%s\n' evidence.json evidence-summary.md > "$archive_list"
  for evidence_path in "$output_dir"/*.snapshot "$output_dir"/*.env "$output_dir"/*.json "$output_dir"/*.txt; do
    [ -f "$evidence_path" ] || continue
    evidence_basename="${evidence_path##*/}"
    case "$evidence_basename" in
      evidence.json|evidence-summary.md) continue ;;
      *secret*|*token*|*password*|*.key) rm -f "$archive_list"; k_error 'Evidence filename is secret-shaped'; return 1 ;;
    esac
    [ "${#evidence_basename}" -le 200 ] || { rm -f "$archive_list"; return 1; }
    extra_line_total=0
    while IFS= read -r line || [ -n "$line" ]; do
      k_contains_secret_shape "$line" && {
        rm -f "$archive_list"
        k_error "Evidence file contains secret-shaped content: $evidence_basename"
        return 1
      }
      [ "${#line}" -le "$K_HARNESS_MAX_RECORD_BYTES" ] || { rm -f "$archive_list"; return 1; }
      extra_line_total=$((extra_line_total + ${#line} + 1))
      [ "$extra_line_total" -le "$K_HARNESS_MAX_EVIDENCE_BYTES" ] || { rm -f "$archive_list"; k_error 'Evidence file exceeds bounded size'; return 1; }
    done < "$evidence_path"
    printf '%s\n' "$evidence_basename" >> "$archive_list"
  done
  tar -czf "$output_dir/evidence.tgz" -C "$output_dir" -T "$archive_list"
  rm -f "$archive_list"
  k_info "bounded evidence written to $output_dir"
}

k_run_state_cli() {
  local command_name="$1"
  local state_dir="$2"
  local verifier="$3"
  shift 3

  PATH="$K_EFFECTIVE_HOST_PATH" docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
    -v "$state_dir:/tmp/classroompath-release-state:rw" \
    "$verifier" /app/scripts/lib/release-bundle-state.mjs "$command_name" \
    --state-root /tmp/classroompath-release-state "$@"
}

k_persist_release_bundle() {
  local state_dir="$1"
  local bundle="$2"
  local contract="$3"
  local release_id="$4"
  local rc_run_id="$5"
  local verifier="$6"

  PATH="$K_EFFECTIVE_HOST_PATH" docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
    -v "$state_dir:/tmp/classroompath-release-state:rw" \
    -v "$bundle:/tmp/classroompath-release-bundle.json:ro" \
    -v "$contract:/tmp/openpath-promotion-contract.json:ro" \
    "$verifier" /app/scripts/lib/release-bundle-state.mjs persist \
    --state-root /tmp/classroompath-release-state \
    --bundle-file /tmp/classroompath-release-bundle.json \
    --contract-file /tmp/openpath-promotion-contract.json \
    --release-id "$release_id" --rc-run-id "$rc_run_id"
}

k_activate_release_bundle() {
  local state_dir="$1"
  local release_id="$2"
  local verifier="$3"

  PATH="$K_EFFECTIVE_HOST_PATH" docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
    -v "$state_dir:/tmp/classroompath-release-state:rw" \
    "$verifier" /app/scripts/lib/release-bundle-state.mjs activate \
    --state-root /tmp/classroompath-release-state --release-id "$release_id"
}

k_capture_previous_release() {
  local state_dir="$1"
  local verifier="$2"
  local current=""
  local previous=""

  k_run_state_cli capture-previous "$state_dir" "$verifier" >/dev/null || {
    k_error 'Unable to capture the exact current P as the durable rollback target'
    return 1
  }
  current="$(tr -d '\r\n' < "$state_dir/current" 2>/dev/null || true)"
  previous="$(tr -d '\r\n' < "$state_dir/previous" 2>/dev/null || true)"
  [ "$current" = "$K_PREVIOUS_RELEASE_ID" ] && [ "$previous" = "$current" ] || {
    k_error 'capture-previous did not persist P in both current and previous pointers'
    return 1
  }
}

k_record_phase_state() {
  local records_file="$1"
  local state_file="$K_DEPLOY_ROOT/release-state/deployment-phase.env"
  local phase=""
  local updated_at=""
  local boundary=""

  [ -f "$state_file" ] || return 1
  phase="$(k_read_required_file_value "$state_file" DEPLOYMENT_PHASE)" || return 1
  updated_at="$(k_read_required_file_value "$state_file" DEPLOYMENT_PHASE_UPDATED_AT)" || return 1
  boundary="$(k_read_required_file_value "$state_file" MUTATION_BOUNDARY_REACHED)" || return 1
  k_record "$records_file" phase "$phase" "$updated_at" || return 1
  k_record "$records_file" phase mutation_boundary_reached "$boundary" || return 1
  k_record "$records_file" pointer current "$(k_read_file_value "$state_file" CURRENT_RELEASE_ID || true)" || return 1
  k_record "$records_file" pointer previous "$(k_read_file_value "$state_file" PREVIOUS_RELEASE_ID || true)" || return 1
  k_record "$records_file" pointer candidate "$(k_read_file_value "$state_file" CANDIDATE_RELEASE_ID || true)" || return 1
}

k_initialize_rollback_phase_observations() {
  local observations_file="${K_ROLLBACK_PHASE_OBSERVATIONS_FILE:-$K_EVIDENCE_DIR/rollback-phase-observations.env}"

  k_validate_configured_path K_EVIDENCE_DIR || return 1
  case "$observations_file" in
    "$K_EVIDENCE_DIR"|"$K_EVIDENCE_DIR"/*) ;;
    *) k_error 'Rollback phase observations must remain in the bounded evidence directory'; return 1 ;;
  esac
  if [ -e "$observations_file" ]; then
    [ -f "$observations_file" ] && [ ! -L "$observations_file" ] && [ ! -s "$observations_file" ] || {
      k_error 'Existing rollback phase observations are not an empty regular file'
      return 1
    }
  else
    : > "$observations_file"
    chmod 600 "$observations_file"
  fi
  K_ROLLBACK_PHASE_OBSERVATIONS_FILE="$observations_file"
  export K_ROLLBACK_PHASE_OBSERVATIONS_FILE
}

k_observe_rollback_phases() {
  local rollback_pid="$1"
  local phase_file="$2"
  local observations_file="$3"
  local last_phase=""
  local phase=""
  local timestamp=""
  local poll_seconds="${K_ROLLBACK_PHASE_POLL_SECONDS:-0.1}"
  local rollback_started=0

  case "$poll_seconds" in
    ''|*[!0-9.]*|.*|*.*.*|0) return 1 ;;
  esac
  while kill -0 "$rollback_pid" 2>/dev/null; do
    phase="$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE || true)"
    case "$phase" in
      ROLLING_BACK|ROLLED_BACK)
        rollback_started=1
        ;;&
      FAILED)
        [ "$rollback_started" -eq 1 ] || continue
        ;;&
    esac
    case "$phase" in
      ROLLING_BACK|ROLLED_BACK|FAILED)
        if [ "$phase" != "$last_phase" ]; then
          timestamp="$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE_UPDATED_AT || true)"
          [ -n "$timestamp" ] || return 1
          printf 'OBSERVED_PHASE=%s OBSERVED_AT=%s\n' "$phase" "$timestamp" >> "$observations_file" || return 1
          last_phase="$phase"
        fi
        ;;
    esac
    sleep "$poll_seconds" || return 1
  done
  phase="$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE || true)"
  case "$phase" in
    ROLLING_BACK|ROLLED_BACK)
      rollback_started=1
      ;;&
    FAILED)
      [ "$rollback_started" -eq 1 ] || return 0
      ;;&
  esac
  case "$phase" in
    ROLLING_BACK|ROLLED_BACK|FAILED)
      if [ "$phase" != "$last_phase" ]; then
        timestamp="$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE_UPDATED_AT || true)"
        [ -n "$timestamp" ] || return 1
        printf 'OBSERVED_PHASE=%s OBSERVED_AT=%s\n' "$phase" "$timestamp" >> "$observations_file" || return 1
      fi
      ;;
  esac
}

k_validate_rollback_phase_observations() {
  local observations_file="$1"
  local require_success="${2:-0}"
  local line=""
  local phase=""
  local timestamp=""
  local previous_phase=""
  local count=0
  local rolling_back_count=0
  local rolled_back_count=0

  [ -f "$observations_file" ] && [ ! -L "$observations_file" ] || {
    k_error 'Rollback phase observations are missing'
    return 1
  }
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    [[ "$line" =~ ^OBSERVED_PHASE=([A-Z_]+)[[:space:]]OBSERVED_AT=([^[:space:]]+)$ ]] || {
      k_error 'Rollback phase observations contain an invalid record'
      return 1
    }
    phase="${line#OBSERVED_PHASE=}"
    phase="${phase%% *}"
    timestamp="${line##*OBSERVED_AT=}"
    [ -n "$timestamp" ] || return 1
    case "$phase" in
      ROLLING_BACK|ROLLED_BACK|FAILED) ;;
      *) k_error "Rollback phase observations contain an unexpected phase: $phase"; return 1 ;;
    esac
    [ "$phase" != "$previous_phase" ] || {
      k_error 'Rollback phase observations contain a duplicate consecutive phase'
      return 1
    }
    case "$phase" in
      ROLLING_BACK) rolling_back_count=$((rolling_back_count + 1)) ;;
      ROLLED_BACK) rolled_back_count=$((rolled_back_count + 1)) ;;
    esac
    previous_phase="$phase"
    count=$((count + 1))
  done < "$observations_file"
  [ "$rolling_back_count" -eq 1 ] || {
    k_error 'Rollback phase observation did not prove ROLLING_BACK'
    return 1
  }
  if [ "$require_success" = 1 ]; then
    [ "$rolled_back_count" -eq 1 ] && [ "$previous_phase" = ROLLED_BACK ] || {
      k_error 'Rollback phase observation did not prove the final ROLLED_BACK transition'
      return 1
    }
  else
    [ "$count" -ge 1 ] || return 1
  fi
}

k_record_rollback_phase_observations() {
  local records_file="$1"
  local observations_file="${K_ROLLBACK_PHASE_OBSERVATIONS_FILE:-$K_EVIDENCE_DIR/rollback-phase-observations.env}"
  local line=""
  local phase=""
  local timestamp=""

  while IFS= read -r line; do
    [ -n "$line" ] || continue
    phase="${line#OBSERVED_PHASE=}"
    phase="${phase%% *}"
    timestamp="${line##*OBSERVED_AT=}"
    k_record "$records_file" rollback_phase "$phase" "$timestamp" || return 1
  done < "$observations_file"
}

k_validate_recovery_readiness_record() {
  local readiness_file="${K_EVIDENCE_DIR:-}/recovery-readiness.env"

  [ -f "$readiness_file" ] || {
    k_error 'Recovery readiness proof is missing before the mutation boundary'
    return 1
  }
  [ "$(k_read_required_file_value "$readiness_file" RECOVERY_READINESS_PREFLIGHT)" = true ] || return 1
  [ "$(k_read_required_file_value "$readiness_file" RECOVERY_READINESS_SOURCE_SHA)" = "$K_RECOVERY_SOURCE_SHA" ] || return 1
  [ "$(k_read_required_file_value "$readiness_file" RECOVERY_READINESS_PREVIOUS_RELEASE_ID)" = "$K_PREVIOUS_RELEASE_ID" ] || return 1
  [ "$(k_read_required_file_value "$readiness_file" RECOVERY_READINESS_ARTIFACT_SHA256)" = "$K_RECOVERY_ARTIFACT_SHA256" ] || return 1
  [ "$(k_read_required_file_value "$readiness_file" RECOVERY_READINESS_EXECUTOR_SHA256)" = "$K_RECOVERY_EXECUTOR_SHA256" ] || return 1
}

k_prepare_p_baseline() {
  local snapshot_file="$1"
  local runtime_dir="$K_EVIDENCE_DIR/p-verifier"

  K_APP_DIR="${K_APP_DIR:-$K_DEPLOY_ROOT/app}"
  export K_APP_DIR
  k_validate_app_path "$K_APP_DIR" || return 1
  k_validate_release_inputs P || return 1
  k_verify_bundle_in_verifier P "$runtime_dir" || return 1
  k_set_attestation_expectations P || return 1
  k_set_topology_expectations || return 1
  k_validate_topology_config || return 1
  k_require_clean_worktree || return 1
  k_collect_snapshot "$snapshot_file" || return 1
  k_validate_attestation "$snapshot_file"
}

k_attest_p() {
  K_EVIDENCE_DIR="${K_EVIDENCE_DIR:-$K_DEPLOY_ROOT/k-evidence}"
  K_APP_DIR="${K_APP_DIR:-$K_DEPLOY_ROOT/app}"
  export K_EVIDENCE_DIR K_APP_DIR
  mkdir -p "$K_EVIDENCE_DIR"
  k_validate_host_contract || return 1
  k_validate_database_endpoint "$K_APP_DIR" || return 1
  k_prepare_p_baseline "$K_EVIDENCE_DIR/p-attestation.snapshot"
}

k_require_fresh_container_names() {
  local container_name=""
  local existing=""

  for container_name in \
    classroompath-gateway \
    classroompath-api \
    classroompath-spa \
    classroompath-openpath-windows-offline-installer-provision; do
    existing="$(PATH="$K_EFFECTIVE_HOST_PATH" docker ps -aq --filter "name=^/${container_name}$" 2>/dev/null)" || {
      k_error "Unable to prove that the fixed-name container is absent: $container_name"
      return 1
    }
    [ -z "$existing" ] || {
      k_error "Provisioning refuses an existing fixed-name container: $container_name"
      return 1
    }
  done
}

k_require_fresh_runtime_resources() {
  local volume_name=""

  k_require_fresh_container_names || return 1
  for volume_name in \
    "$K_EXPECTED_API_DATA_VOLUME" \
    "$K_EXPECTED_TEMPLATES_VOLUME" \
    "$K_EXPECTED_ARTIFACTS_VOLUME"; do
    if PATH="$K_EFFECTIVE_HOST_PATH" docker volume inspect "$volume_name" >/dev/null 2>&1; then
      k_error "Provisioning refuses an existing persistent volume without a durable P: $volume_name"
      return 1
    else
      local volume_listing=""
      volume_listing="$(PATH="$K_EFFECTIVE_HOST_PATH" docker volume ls -q --filter "name=$volume_name" 2>/dev/null)" || {
        k_error "Unable to prove that the persistent volume is absent: $volume_name"
        return 1
      }
      if printf '%s\n' "$volume_listing" | awk -v expected="$volume_name" '$0 == expected { found = 1 } END { exit(found ? 0 : 1) }'; then
        k_error "Provisioning refuses an existing persistent volume without a durable P: $volume_name"
        return 1
      fi
    fi
  done
  if PATH="$K_EFFECTIVE_HOST_PATH" docker network inspect "$K_EXPECTED_NETWORKS" >/dev/null 2>&1; then
    k_error "Provisioning refuses an existing production Compose network without a durable P: $K_EXPECTED_NETWORKS"
    return 1
  else
    local network_listing=""
    network_listing="$(PATH="$K_EFFECTIVE_HOST_PATH" docker network ls --format '{{.Name}}' --filter "name=$K_EXPECTED_NETWORKS" 2>/dev/null)" || {
      k_error "Unable to prove that the production Compose network is absent: $K_EXPECTED_NETWORKS"
      return 1
    }
    if printf '%s\n' "$network_listing" | awk -v expected="$K_EXPECTED_NETWORKS" '$0 == expected { found = 1 } END { exit(found ? 0 : 1) }'; then
      k_error "Provisioning refuses an existing production Compose network without a durable P: $K_EXPECTED_NETWORKS"
      return 1
    fi
  fi
}

k_provision_attempt_file() {
  printf '%s/release-state/provision-attempt.env\n' "$K_DEPLOY_ROOT"
}

k_provision_update_attempt() {
  local attempt_file=""
  local temp_file=""

  attempt_file="$(k_provision_attempt_file)" || return 1
  mkdir -p "$(dirname "$attempt_file")" || return 1
  temp_file="$(mktemp "$attempt_file.tmp.XXXXXX")" || return 1
  {
    printf 'PROVISION_ATTEMPT_ID=%s\n' "${K_PROVISION_ATTEMPT_ID:-}"
    printf 'PROVISION_STATUS=%s\n' "${K_PROVISION_ATTEMPT_STATUS:-PREPARING}"
    printf 'PROVISION_OWNERSHIP_CONFIRMED=%s\n' "${K_PROVISION_OWNERSHIP_CONFIRMED:-false}"
    printf 'PROVISION_RESOURCES_ABSENT_BEFORE=%s\n' "${K_PROVISION_RESOURCES_ABSENT_BEFORE:-false}"
    printf 'PROVISION_RELEASE_ID=%s\n' "${K_P_RELEASE_ID:-}"
    printf 'PROVISION_COMPOSE_PROJECT=%s\n' "$K_COMPOSE_PROJECT"
    printf 'PROVISION_NETWORK_NAME=%s\n' "${K_EXPECTED_NETWORKS:-}"
    printf 'PROVISION_GATEWAY_NAME=%s\n' "${K_EXPECTED_GATEWAY_NAME:-classroompath-gateway}"
    printf 'PROVISION_API_NAME=%s\n' "${K_EXPECTED_API_NAME:-classroompath-api}"
    printf 'PROVISION_SPA_NAME=%s\n' "${K_EXPECTED_SPA_NAME:-classroompath-spa}"
    printf 'PROVISION_PROVISION_NAME=%s\n' "${K_EXPECTED_PROVISION_NAME:-classroompath-openpath-windows-offline-installer-provision}"
    printf 'PROVISION_API_DATA_VOLUME=%s\n' "${K_EXPECTED_API_DATA_VOLUME:-}"
    printf 'PROVISION_TEMPLATES_VOLUME=%s\n' "${K_EXPECTED_TEMPLATES_VOLUME:-}"
    printf 'PROVISION_ARTIFACTS_VOLUME=%s\n' "${K_EXPECTED_ARTIFACTS_VOLUME:-}"
    printf 'PROVISION_GATEWAY_ID=%s\n' "${K_PROVISION_GATEWAY_ID:-}"
    printf 'PROVISION_API_ID=%s\n' "${K_PROVISION_API_ID:-}"
    printf 'PROVISION_SPA_ID=%s\n' "${K_PROVISION_SPA_ID:-}"
    printf 'PROVISION_PROVISION_ID=%s\n' "${K_PROVISION_PROVISION_ID:-}"
    printf 'PROVISION_NETWORK_ID=%s\n' "${K_PROVISION_NETWORK_ID:-}"
  } > "$temp_file" || {
    rm -f "$temp_file"
    return 1
  }
  install -m 600 "$temp_file" "$attempt_file" || {
    rm -f "$temp_file"
    return 1
  }
  rm -f "$temp_file"
}

k_provision_begin_attempt() {
  K_PROVISION_ATTEMPT_ID="$(k_generate_transaction_id)" || return 1
  k_require_transaction_id "$K_PROVISION_ATTEMPT_ID" || return 1
  K_PROVISION_ATTEMPT_STATUS=PREPARING
  K_PROVISION_OWNERSHIP_CONFIRMED=true
  K_PROVISION_RESOURCES_ABSENT_BEFORE=true
  K_PROVISION_GATEWAY_ID=""
  K_PROVISION_API_ID=""
  K_PROVISION_SPA_ID=""
  K_PROVISION_PROVISION_ID=""
  K_PROVISION_NETWORK_ID=""
  export K_PROVISION_ATTEMPT_ID K_PROVISION_ATTEMPT_STATUS K_PROVISION_OWNERSHIP_CONFIRMED K_PROVISION_RESOURCES_ABSENT_BEFORE
  export K_PROVISION_GATEWAY_ID K_PROVISION_API_ID K_PROVISION_SPA_ID K_PROVISION_PROVISION_ID K_PROVISION_NETWORK_ID
  k_provision_update_attempt
}

k_provision_load_attempt() {
  local attempt_file=""

  attempt_file="$(k_provision_attempt_file)" || return 1
  [ -f "$attempt_file" ] && [ ! -L "$attempt_file" ] || return 1
  K_PROVISION_ATTEMPT_ID="$(k_read_required_file_value "$attempt_file" PROVISION_ATTEMPT_ID)" || return 1
  K_PROVISION_ATTEMPT_STATUS="$(k_read_required_file_value "$attempt_file" PROVISION_STATUS)" || return 1
  K_PROVISION_OWNERSHIP_CONFIRMED="$(k_read_required_file_value "$attempt_file" PROVISION_OWNERSHIP_CONFIRMED)" || return 1
  K_PROVISION_RESOURCES_ABSENT_BEFORE="$(k_read_required_file_value "$attempt_file" PROVISION_RESOURCES_ABSENT_BEFORE)" || return 1
  local provision_release_id=""
  k_require_transaction_id "$K_PROVISION_ATTEMPT_ID" || return 1
  [ "$(k_read_required_file_value "$attempt_file" PROVISION_COMPOSE_PROJECT)" = "$K_COMPOSE_PROJECT" ] || return 1
  [ "$K_PROVISION_RESOURCES_ABSENT_BEFORE" = true ] || return 1
  provision_release_id="$(k_read_required_file_value "$attempt_file" PROVISION_RELEASE_ID)"
  [ -z "${K_P_RELEASE_ID:-}" ] || [ "$provision_release_id" = "$K_P_RELEASE_ID" ] || return 1
  K_EXPECTED_NETWORKS="$(k_read_required_file_value "$attempt_file" PROVISION_NETWORK_NAME)"
  K_EXPECTED_GATEWAY_NAME="$(k_read_required_file_value "$attempt_file" PROVISION_GATEWAY_NAME)"
  K_EXPECTED_API_NAME="$(k_read_required_file_value "$attempt_file" PROVISION_API_NAME)"
  K_EXPECTED_SPA_NAME="$(k_read_required_file_value "$attempt_file" PROVISION_SPA_NAME)"
  K_EXPECTED_PROVISION_NAME="$(k_read_required_file_value "$attempt_file" PROVISION_PROVISION_NAME)"
  K_EXPECTED_API_DATA_VOLUME="$(k_read_required_file_value "$attempt_file" PROVISION_API_DATA_VOLUME)"
  K_EXPECTED_TEMPLATES_VOLUME="$(k_read_required_file_value "$attempt_file" PROVISION_TEMPLATES_VOLUME)"
  K_EXPECTED_ARTIFACTS_VOLUME="$(k_read_required_file_value "$attempt_file" PROVISION_ARTIFACTS_VOLUME)"
  [ "$K_EXPECTED_NETWORKS" = "${K_COMPOSE_PROJECT}_openpath_default" ] || return 1
  [ "$K_EXPECTED_API_DATA_VOLUME" = "${K_COMPOSE_PROJECT}_api-data" ] || return 1
  [ "$K_EXPECTED_TEMPLATES_VOLUME" = "${K_COMPOSE_PROJECT}_windows_offline_installer_templates" ] || return 1
  [ "$K_EXPECTED_ARTIFACTS_VOLUME" = "${K_COMPOSE_PROJECT}_windows_offline_installer_artifacts" ] || return 1
  [ "$K_EXPECTED_GATEWAY_NAME" = classroompath-gateway ] || return 1
  [ "$K_EXPECTED_API_NAME" = classroompath-api ] || return 1
  [ "$K_EXPECTED_SPA_NAME" = classroompath-spa ] || return 1
  [ "$K_EXPECTED_PROVISION_NAME" = classroompath-openpath-windows-offline-installer-provision ] || return 1
  export K_EXPECTED_NETWORKS K_EXPECTED_GATEWAY_NAME K_EXPECTED_API_NAME K_EXPECTED_SPA_NAME K_EXPECTED_PROVISION_NAME
  export K_EXPECTED_API_DATA_VOLUME K_EXPECTED_TEMPLATES_VOLUME K_EXPECTED_ARTIFACTS_VOLUME
  export K_PROVISION_ATTEMPT_ID K_PROVISION_ATTEMPT_STATUS K_PROVISION_OWNERSHIP_CONFIRMED K_PROVISION_RESOURCES_ABSENT_BEFORE
  K_PROVISION_GATEWAY_ID="$(k_read_file_value "$attempt_file" PROVISION_GATEWAY_ID || true)"
  K_PROVISION_API_ID="$(k_read_file_value "$attempt_file" PROVISION_API_ID || true)"
  K_PROVISION_SPA_ID="$(k_read_file_value "$attempt_file" PROVISION_SPA_ID || true)"
  K_PROVISION_PROVISION_ID="$(k_read_file_value "$attempt_file" PROVISION_PROVISION_ID || true)"
  K_PROVISION_NETWORK_ID="$(k_read_file_value "$attempt_file" PROVISION_NETWORK_ID || true)"
  export K_PROVISION_GATEWAY_ID K_PROVISION_API_ID K_PROVISION_SPA_ID K_PROVISION_PROVISION_ID K_PROVISION_NETWORK_ID
}

k_provision_container_metadata() {
  local container_id="$1"

  PATH="$K_EFFECTIVE_HOST_PATH" docker inspect -f '{{.Id}}|{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' "$container_id"
}

k_provision_container_id_for_exact_name() {
  local container_name="$1"
  local ids=""
  local id_count=0
  local id=""
  local metadata=""
  local actual_id=""
  local actual_name=""

  ids="$(PATH="$K_EFFECTIVE_HOST_PATH" docker ps -aq --filter "name=^/${container_name}$")" || return 1
  id_count="$(printf '%s\n' "$ids" | awk 'NF { count += 1 } END { print count + 0 }')"
  [ "$id_count" -le 1 ] || return 1
  [ "$id_count" -eq 1 ] || return 0
  id="$(printf '%s\n' "$ids" | awk 'NF { print; exit }')"
  metadata="$(k_provision_container_metadata "$id")" || return 1
  IFS='|' read -r actual_id actual_name _ _ <<< "$metadata"
  actual_name="${actual_name#/}"
  [ -n "$actual_id" ] || return 1
  [ "$actual_name" = "$container_name" ] || return 1
  printf '%s\n' "$actual_id"
}

k_provision_container_id_for_name() {
  local container_name="$1"
  local service="$2"
  local metadata=""
  local id=""
  local actual_name=""
  local project=""
  local actual_service=""

  id="$(k_provision_container_id_for_exact_name "$container_name")" || return 1
  [ -n "$id" ] || return 1
  metadata="$(k_provision_container_metadata "$id" 2>/dev/null)" || return 1
  IFS='|' read -r id actual_name project actual_service <<< "$metadata"
  actual_name="${actual_name#/}"
  [ "$project" = "$K_COMPOSE_PROJECT" ] || return 1
  [ "$actual_service" = "$service" ] || return 1
  [ "$actual_name" = "$container_name" ] || return 1
  [ -n "$id" ] || return 1
  printf '%s\n' "$id"
}

k_provision_record_runtime_resources() {
  local network_metadata=""
  local network_id=""
  local network_project=""
  local complete=1

  K_PROVISION_GATEWAY_ID="$(k_provision_container_id_for_name "${K_EXPECTED_GATEWAY_NAME:-classroompath-gateway}" gateway 2>/dev/null || true)"
  K_PROVISION_API_ID="$(k_provision_container_id_for_name "${K_EXPECTED_API_NAME:-classroompath-api}" api 2>/dev/null || true)"
  K_PROVISION_SPA_ID="$(k_provision_container_id_for_name "${K_EXPECTED_SPA_NAME:-classroompath-spa}" spa 2>/dev/null || true)"
  K_PROVISION_PROVISION_ID="$(k_provision_container_id_for_name "${K_EXPECTED_PROVISION_NAME:-classroompath-openpath-windows-offline-installer-provision}" windows-offline-installer-provision 2>/dev/null || true)"
  network_metadata="$(PATH="$K_EFFECTIVE_HOST_PATH" docker network inspect -f '{{.Id}}|{{.Name}}|{{index .Labels "com.docker.compose.project"}}' "$K_EXPECTED_NETWORKS" 2>/dev/null || true)"
  IFS='|' read -r network_id _ network_project <<< "$network_metadata"
  [ "$network_project" = "$K_COMPOSE_PROJECT" ] || complete=0
  [ -n "$network_id" ] || complete=0
  K_PROVISION_NETWORK_ID="$network_id"
  K_PROVISION_ATTEMPT_STATUS=RUNTIME_CREATED
  export K_PROVISION_GATEWAY_ID K_PROVISION_API_ID K_PROVISION_SPA_ID K_PROVISION_PROVISION_ID K_PROVISION_NETWORK_ID K_PROVISION_ATTEMPT_STATUS
  k_provision_update_attempt || return 1
  [ -n "$K_PROVISION_GATEWAY_ID" ] || complete=0
  [ -n "$K_PROVISION_API_ID" ] || complete=0
  [ -n "$K_PROVISION_SPA_ID" ] || complete=0
  [ -n "$K_PROVISION_PROVISION_ID" ] || complete=0
  [ "$complete" -eq 1 ]
}

k_provision_verify_container_owner() {
  local container_id="$1"
  local expected_name="$2"
  local expected_service="$3"
  local metadata=""
  local actual_id=""
  local actual_name=""
  local project=""
  local service=""

  metadata="$(k_provision_container_metadata "$container_id")" || return 1
  IFS='|' read -r actual_id actual_name project service <<< "$metadata"
  actual_name="${actual_name#/}"
  [ "$actual_id" = "$container_id" ] || return 1
  [ "$actual_name" = "$expected_name" ] || return 1
  [ "$project" = "$K_COMPOSE_PROJECT" ] || return 1
  [ "$service" = "$expected_service" ]
}

k_provision_verify_volume_owner() {
  local volume_name="$1"
  local expected_key="$2"
  local metadata=""
  local actual_name=""
  local project=""
  local compose_key=""

  metadata="$(PATH="$K_EFFECTIVE_HOST_PATH" docker volume inspect -f '{{.Name}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.volume"}}' "$volume_name")" || return 1
  IFS='|' read -r actual_name project compose_key <<< "$metadata"
  [ "$actual_name" = "$volume_name" ] || return 1
  [ "$project" = "$K_COMPOSE_PROJECT" ] || return 1
  [ "$compose_key" = "$expected_key" ]
}

k_provision_verify_network_owner() {
  local network_id="$1"
  local metadata=""
  local actual_id=""
  local actual_name=""
  local project=""

  metadata="$(PATH="$K_EFFECTIVE_HOST_PATH" docker network inspect -f '{{.Id}}|{{.Name}}|{{index .Labels "com.docker.compose.project"}}' "$network_id")" || return 1
  IFS='|' read -r actual_id actual_name project <<< "$metadata"
  [ "$actual_id" = "$network_id" ] || return 1
  [ "$actual_name" = "$K_EXPECTED_NETWORKS" ] || return 1
  [ "$project" = "$K_COMPOSE_PROJECT" ]
}

k_provision_cleanup_attempt() {
  local status=""
  local current=""
  local cleanup_failed=0
  local resource=""
  local volume=""
  local id=""
  local expected_name=""
  local expected_service=""
  local current_id=""
  local volume_name=""
  local expected_key=""
  local network_metadata=""
  local volume_listing=""
  local network_listing=""
  local network_id=""

  k_provision_load_attempt || return 1
  current="$(tr -d '\r\n' < "$K_DEPLOY_ROOT/release-state/current" 2>/dev/null || true)"
  [ -z "$current" ] || {
    k_error 'Provisioning cleanup refuses to remove resources after current became authoritative'
    K_PROVISION_ATTEMPT_STATUS=CLEANUP_BLOCKED
    k_provision_update_attempt || true
    return 1
  }
  status="$K_PROVISION_ATTEMPT_STATUS"
  case "$status" in
    CLEANED) return 0 ;;
    ACTIVE)
      k_error 'Provisioning attempt is marked active without an authoritative current pointer'
      return 1
      ;;
    PREPARING|RUNTIME_CREATED|CLEANUP_FAILED) ;;
    *) k_error "Provisioning cleanup refuses unknown attempt status: $status"; return 1 ;;
  esac
  [ "$K_PROVISION_OWNERSHIP_CONFIRMED" = true ] || {
    k_error 'Provisioning cleanup lacks an ownership proof for the attempt resources'
    return 1
  }
  [ "$K_PROVISION_RESOURCES_ABSENT_BEFORE" = true ] || {
    k_error 'Provisioning cleanup lacks proof that resource names were absent before this attempt'
    return 1
  }

  for resource in \
    "${K_PROVISION_GATEWAY_ID:-}|${K_EXPECTED_GATEWAY_NAME:-classroompath-gateway}|gateway" \
    "${K_PROVISION_API_ID:-}|${K_EXPECTED_API_NAME:-classroompath-api}|api" \
    "${K_PROVISION_SPA_ID:-}|${K_EXPECTED_SPA_NAME:-classroompath-spa}|spa" \
    "${K_PROVISION_PROVISION_ID:-}|${K_EXPECTED_PROVISION_NAME:-classroompath-openpath-windows-offline-installer-provision}|windows-offline-installer-provision"; do
    IFS='|' read -r id expected_name expected_service <<< "$resource"
    if [ -n "$id" ] && PATH="$K_EFFECTIVE_HOST_PATH" docker inspect "$id" >/dev/null 2>&1; then
      if ! k_provision_verify_container_owner "$id" "$expected_name" "$expected_service" ||
        ! PATH="$K_EFFECTIVE_HOST_PATH" docker rm -f "$id" >/dev/null; then
        cleanup_failed=1
      fi
      continue
    fi
    current_id="$(k_provision_container_id_for_exact_name "$expected_name" 2>/dev/null)" || {
      cleanup_failed=1
      continue
    }
    if [ -z "$id" ]; then
      [ -z "$current_id" ] || cleanup_failed=1
      continue
    fi
    if [ -n "$id" ] && [ -n "$current_id" ] && [ "$id" != "$current_id" ]; then
      cleanup_failed=1
      continue
    fi
    if [ -n "$current_id" ] &&
      { ! k_provision_verify_container_owner "$current_id" "$expected_name" "$expected_service" ||
        ! PATH="$K_EFFECTIVE_HOST_PATH" docker rm -f "$current_id" >/dev/null; }; then
      cleanup_failed=1
    fi
  done

  for volume in \
    "${K_EXPECTED_API_DATA_VOLUME:-}|api-data" \
    "${K_EXPECTED_TEMPLATES_VOLUME:-}|windows_offline_installer_templates" \
    "${K_EXPECTED_ARTIFACTS_VOLUME:-}|windows_offline_installer_artifacts"; do
    IFS='|' read -r volume_name expected_key <<< "$volume"
    [ -n "$volume_name" ] || { cleanup_failed=1; continue; }
    if PATH="$K_EFFECTIVE_HOST_PATH" docker volume inspect "$volume_name" >/dev/null 2>&1; then
      if ! k_provision_verify_volume_owner "$volume_name" "$expected_key" ||
        ! PATH="$K_EFFECTIVE_HOST_PATH" docker volume rm "$volume_name" >/dev/null; then
        cleanup_failed=1
      fi
    else
      volume_listing="$(PATH="$K_EFFECTIVE_HOST_PATH" docker volume ls -q --filter "name=$volume_name" 2>/dev/null)" || {
        cleanup_failed=1
        continue
      }
      if printf '%s\n' "$volume_listing" | awk -v expected="$volume_name" '$0 == expected { found = 1 } END { exit(found ? 0 : 1) }'; then
        # Inspect failed but the exact name still exists; do not guess ownership.
        cleanup_failed=1
      fi
    fi
  done

  if [ -n "${K_PROVISION_NETWORK_ID:-}" ]; then
    if ! k_provision_verify_network_owner "$K_PROVISION_NETWORK_ID" ||
      ! PATH="$K_EFFECTIVE_HOST_PATH" docker network rm "$K_PROVISION_NETWORK_ID" >/dev/null; then
      cleanup_failed=1
    fi
  else
    if network_metadata="$(PATH="$K_EFFECTIVE_HOST_PATH" docker network inspect -f '{{.Id}}|{{.Name}}|{{index .Labels "com.docker.compose.project"}}' "$K_EXPECTED_NETWORKS" 2>/dev/null)"; then
      if [ -n "$network_metadata" ]; then
        # Without the network ID persisted by this attempt, a matching name is
        # not enough to prove ownership. Leave it in place and make the attempt
        # retryable instead of deleting a resource created by another actor.
        cleanup_failed=1
      fi
    else
      network_listing="$(PATH="$K_EFFECTIVE_HOST_PATH" docker network ls --format '{{.Name}}' --filter "name=$K_EXPECTED_NETWORKS" 2>/dev/null)" || {
        cleanup_failed=1
        network_listing=""
      }
      if printf '%s\n' "$network_listing" | awk -v expected="$K_EXPECTED_NETWORKS" '$0 == expected { found = 1 } END { exit(found ? 0 : 1) }'; then
        cleanup_failed=1
      fi
    fi
  fi

  if [ "$cleanup_failed" -ne 0 ]; then
    K_PROVISION_ATTEMPT_STATUS=CLEANUP_FAILED
    k_provision_update_attempt || true
    k_error 'Provisioning cleanup did not prove removal of every attempt-owned resource'
    return 1
  fi
  K_PROVISION_ATTEMPT_STATUS=CLEANED
  k_provision_update_attempt
}

k_provision_reconcile_attempt() {
  local attempt_file=""
  local status=""
  local current=""

  attempt_file="$(k_provision_attempt_file)" || return 1
  [ -e "$attempt_file" ] || return 0
  k_provision_load_attempt || {
    k_error 'Provisioning attempt marker is unreadable; refusing to guess ownership'
    return 1
  }
  status="$K_PROVISION_ATTEMPT_STATUS"
  current="$(tr -d '\r\n' < "$K_DEPLOY_ROOT/release-state/current" 2>/dev/null || true)"
  case "$status" in
    ACTIVE)
      [ "$current" = "${K_P_RELEASE_ID:-}" ] || {
        k_error 'Active provisioning attempt does not match authoritative P'
        return 1
      }
      ;;
    CLEANED)
      [ -z "$current" ] || { k_error 'Cleaned provisioning attempt contradicts current pointer'; return 1; }
      ;;
    PREPARING|RUNTIME_CREATED|CLEANUP_FAILED)
      if [ "$current" = "${K_P_RELEASE_ID:-}" ] && [ -n "$current" ]; then
        # Activation is the authority.  If writing the attempt marker failed
        # immediately after activation, retain the live P and repair only the
        # secondary marker on the next invocation.
        K_PROVISION_ATTEMPT_STATUS=ACTIVE
        k_provision_update_attempt || return 1
        return 0
      fi
      [ -z "$current" ] || { k_error 'Incomplete provisioning attempt conflicts with an authoritative current pointer'; return 1; }
      k_provision_cleanup_attempt || return 1
      ;;
    CLEANUP_BLOCKED)
      if [ "$current" = "${K_P_RELEASE_ID:-}" ] && [ -n "$current" ]; then
        # A failed activation write may have published current=P before the
        # secondary attempt marker recorded the failure. Authority wins; do
        # not remove the now-live P resources on the next retry.
        K_PROVISION_ATTEMPT_STATUS=ACTIVE
        k_provision_update_attempt || return 1
        return 0
      fi
      [ -z "$current" ] || { k_error 'Blocked provisioning attempt conflicts with an authoritative current pointer'; return 1; }
      k_provision_cleanup_attempt || return 1
      ;;
    *) k_error "Unknown provisioning attempt status: $status"; return 1 ;;
  esac
}

k_provision_p() (
  local state_dir="$K_DEPLOY_ROOT/release-state"
  local app_dir="${K_APP_DIR:-$K_DEPLOY_ROOT/app}"
  local runtime_dir=""
  local current=""
  local compose_file="$app_dir/docker/docker-compose.yml"
  local env_file="$app_dir/config/.env"
  local pre_activation=""
  local post_activation=""
  local previous_requirement="${K_ATTESTATION_DURABLE_STATE_REQUIRED:-1}"
  local provision_status=0

  K_PROVISION_ATTEMPT_CREATED=0
  K_PROVISION_ACTIVATED=0
  trap 'provision_status=$?; if [ "${K_PROVISION_ATTEMPT_CREATED:-0}" = 1 ] && [ "${K_PROVISION_ACTIVATED:-0}" != 1 ]; then k_provision_record_runtime_resources || true; k_provision_cleanup_attempt || true; fi; exit "$provision_status"' EXIT

  k_require_mutation_confirmation || return 1
  K_APP_DIR="$app_dir"
  K_EVIDENCE_DIR="${K_EVIDENCE_DIR:-$K_DEPLOY_ROOT/k-evidence}"
  export K_APP_DIR K_EVIDENCE_DIR
  mkdir -p "$K_EVIDENCE_DIR"
  runtime_dir="$K_EVIDENCE_DIR/p-verifier"
  pre_activation="$K_EVIDENCE_DIR/p-pre-activation.snapshot"
  post_activation="$K_EVIDENCE_DIR/p-post-activation.snapshot"
  k_validate_host_contract || return 1
  k_validate_release_inputs P || return 1
  k_validate_app_path "$app_dir" || return 1
  k_provision_reconcile_attempt || return 1
  current="$(tr -d '\r\n' < "$state_dir/current" 2>/dev/null || true)"
  if [ -n "$current" ]; then
    [ "$current" = "$K_P_RELEASE_ID" ] || { k_error 'Provisioning refuses contradictory current state'; return 1; }
    [ -e "$app_dir/.git" ] || { k_error 'Current P state has no application checkout'; return 1; }
    k_require_clean_worktree || return 1
    [ "$(git -C "$app_dir" rev-parse HEAD)" = "$K_P_APP_SHA" ] || {
      k_error 'Current P state is served by a different application checkout'
      return 1
    }
    [ "$(git -C "$app_dir" rev-parse HEAD:upstream/openpath)" = "$K_P_OPENPATH_SHA" ] || {
      k_error 'Current P state has a different OpenPath gitlink'
      return 1
    }
  else
    [ -z "$(PATH="$K_EFFECTIVE_HOST_PATH" docker ps -aq --filter "label=com.docker.compose.project=$K_COMPOSE_PROJECT" 2>/dev/null)" ] || {
      k_error 'Provisioning refuses existing containers without durable current state'
      return 1
    }
    if [ -e "$state_dir/current" ] || [ -e "$state_dir/previous" ] ||
      [ -e "$state_dir/deployment-phase.env" ]; then
      k_error 'Provisioning refuses partial release state without a durable current P'
      return 1
    fi
    k_checkout_exact_release "$app_dir" "$K_P_APP_SHA" "${K_REPOSITORY_URL:-}" "$K_P_OPENPATH_SHA" || return 1
  fi
  [ "$K_GATEWAY_DOWNLOAD_HOST_ROOT" = /srv/classroompath/downloads ] || {
    k_error 'Provisioning requires the production gateway bind-mount path'
    return 1
  }
  [ -e "$K_GATEWAY_DOWNLOAD_HOST_ROOT" ] || mkdir -p "$K_GATEWAY_DOWNLOAD_HOST_ROOT"
  k_set_topology_expectations || return 1
  k_validate_topology_config || return 1
  if [ -z "$current" ]; then
    k_require_fresh_runtime_resources || return 1
  fi
  if [ -z "$current" ]; then
    k_provision_begin_attempt || return 1
    K_PROVISION_ATTEMPT_CREATED=1
  fi
  k_validate_firefox_release_root || return 1
  k_verify_bundle_in_verifier P "$runtime_dir" || return 1
  k_set_attestation_expectations P || return 1
  [ -f "$compose_file" ] || { k_error "Production Compose file is missing: $compose_file"; return 1; }
  if [ -n "$current" ]; then
    k_collect_snapshot "$K_EVIDENCE_DIR/p-existing.snapshot" || return 1
    k_validate_attestation "$K_EVIDENCE_DIR/p-existing.snapshot" || return 1
    K_PROVISION_ACTIVATED=1
    k_info 'P is already provisioned and K0-valid'
    return 0
  fi
  k_validate_runtime_secrets_path "$app_dir" || return 1
  k_load_runtime_secrets || return 1
  mkdir -p "$(dirname "$env_file")"
  install -m 600 "$K_RUNTIME_SECRETS_FILE" "$env_file"
  k_apply_runtime_projection "$K_P_VERIFIER_RUNTIME_FILE" "$env_file" || return 1
  k_validate_compose_resolved_images P "$compose_file" "$env_file" || return 1
  k_source_common_helper || return 1
  [ -f "$K_HARNESS_DIR/lib/deploy-container-platform.sh" ] || return 1
  # shellcheck source=lib/deploy-container-platform.sh
  source "$K_HARNESS_DIR/lib/deploy-container-platform.sh"
  configure_deploy_container_platform "${K_CONTAINER_PLATFORM:-linux/amd64}" || return 1
  verify_deploy_container_platform || return 1
  K_P_MIGRATIONS_IMAGE="${K_P_MIGRATIONS_IMAGE:-${CLASSROOMPATH_MIGRATIONS_IMAGE:-}}"
  k_require_immutable_image K_P_MIGRATIONS_IMAGE "$K_P_MIGRATIONS_IMAGE" || return 1
  export K_P_MIGRATIONS_IMAGE
  export COMPOSE_PROJECT_NAME="$K_COMPOSE_PROJECT"
  k_prepare_openpath_assets || return 1
  PATH="$K_EFFECTIVE_HOST_PATH" docker compose --env-file "$env_file" -p "$K_COMPOSE_PROJECT" -f "$compose_file" pull gateway api windows-offline-installer-provision spa || return 1
  PATH="$K_EFFECTIVE_HOST_PATH" bash "$app_dir/scripts/run-migrations-docker.sh" --cp --openpath --app-dir "$app_dir" --env-file "$env_file" --runner-image "$K_P_MIGRATIONS_IMAGE" || return 1
  PATH="$K_EFFECTIVE_HOST_PATH" docker compose --env-file "$env_file" -p "$K_COMPOSE_PROJECT" -f "$compose_file" up -d --force-recreate --no-build || return 1
  k_provision_record_runtime_resources || return 1
  K_ATTESTATION_DURABLE_STATE_REQUIRED=0
  export K_ATTESTATION_DURABLE_STATE_REQUIRED
  k_collect_snapshot "$pre_activation" pre-activation "$K_P_RELEASE_ID" "$K_P_BUNDLE_FILE" "$K_P_CONTRACT_FILE" "$K_P_VERIFIER_RUNTIME_FILE" || {
    K_ATTESTATION_DURABLE_STATE_REQUIRED="$previous_requirement"
    export K_ATTESTATION_DURABLE_STATE_REQUIRED
    return 1
  }
  if ! k_validate_attestation "$pre_activation"; then
    K_ATTESTATION_DURABLE_STATE_REQUIRED="$previous_requirement"
    export K_ATTESTATION_DURABLE_STATE_REQUIRED
    return 1
  fi
  K_ATTESTATION_DURABLE_STATE_REQUIRED="$previous_requirement"
  export K_ATTESTATION_DURABLE_STATE_REQUIRED
  k_persist_release_bundle "$state_dir" "$K_P_BUNDLE_FILE" "$K_P_CONTRACT_FILE" "$K_P_RELEASE_ID" "$K_P_RC_RUN_ID" "$K_P_VERIFIER_IMAGE" || return 1
  k_activate_release_bundle "$state_dir" "$K_P_RELEASE_ID" "$K_P_VERIFIER_IMAGE" || return 1
  K_PROVISION_ACTIVATED=1
  K_PROVISION_ATTEMPT_STATUS=ACTIVE
  k_provision_update_attempt || return 1
  k_collect_snapshot "$post_activation" || return 1
  k_validate_attestation "$post_activation" || return 1
  k_info 'P provisioning completed; K remains pending'
)

k_execute_fault_leg() {
  local baseline="$K_EVIDENCE_DIR/baseline.snapshot"
  local records="$K_EVIDENCE_DIR/records.jsonl"
  local forward_status=0
  local watchdog_pid=0
  local watchdog_status=1
  local phase_file="$K_DEPLOY_ROOT/release-state/deployment-phase.env"
  local post_rollback="$K_EVIDENCE_DIR/post-rollback.snapshot"
  local finalize_status=1
  local boundary=""
  local target_id=""
  local baseline_hash=""
  local post_rollback_hash=""
  local post_rollback_contract_status=0

  k_require_mutation_confirmation || return 1
  k_validate_host_contract || return 1
  k_prepare_p_baseline "$baseline" || return 1
  k_load_runtime_secrets || return 1
  K_BASELINE_GATEWAY_ID="$(k_read_required_file_value "$baseline" LIVE_GATEWAY_ID)"
  K_PREVIOUS_RELEASE_ID="$(k_read_required_file_value "$baseline" STATE_CURRENT_RELEASE_ID)"
  K_PREVIOUS_APP_SHA="$K_P_APP_SHA"
  export K_BASELINE_GATEWAY_ID K_PREVIOUS_RELEASE_ID K_PREVIOUS_APP_SHA
  k_capture_previous_release "$K_DEPLOY_ROOT/release-state" "$K_P_VERIFIER_IMAGE" || return 1
  k_initialize_leg_outcomes
  k_initialize_transaction_history || return 1
  k_initialize_transaction_attempt || return 1
  mkdir -p "$K_EVIDENCE_DIR" || return 1
  k_record "$records" identity transaction_id "$K_TRANSACTION_ID" || return 1
  k_record "$records" identity candidate_sha "$K_CANDIDATE_SHA" || return 1
  k_record "$records" identity recovery_sha "$K_RECOVERY_SHA" || return 1
  k_record "$records" identity previous_release_id "$K_PREVIOUS_RELEASE_ID" || return 1
  k_record "$records" identity environment_id "$K_ENVIRONMENT_ID" || return 1
  k_record "$records" identity previous_release_app_sha "$K_PREVIOUS_APP_SHA" || return 1
  k_record "$records" identity candidate_release_id "$K_C_RELEASE_ID" || return 1
  k_record "$records" identity previous_rc_run_id "$K_P_RC_RUN_ID" || return 1
  k_record "$records" identity candidate_rc_run_id "$K_C_RC_RUN_ID" || return 1
  k_record "$records" identity previous_openpath_sha "$K_P_OPENPATH_SHA" || return 1
  k_record "$records" identity candidate_openpath_sha "$K_C_OPENPATH_SHA" || return 1
  k_record "$records" artifact previous_bundle_sha256 "$K_P_BUNDLE_SHA256" || return 1
  k_record "$records" artifact candidate_bundle_sha256 "$K_C_BUNDLE_SHA256" || return 1
  k_record "$records" artifact previous_contract_sha256 "$K_P_CONTRACT_SHA256" || return 1
  k_record "$records" artifact candidate_contract_sha256 "$K_C_CONTRACT_SHA256" || return 1
  k_record "$records" topology compose_project "$K_COMPOSE_PROJECT" || return 1
  k_record "$records" topology normal_staging_allowed "$K_NORMAL_STAGING_ALLOWED" || return 1
  k_record "$records" isolation database_identity "$K_DATABASE_IDENTITY" || return 1
  k_record "$records" isolation database_endpoint_sha256 "$K_DATABASE_ENDPOINT_SHA256" || return 1
  k_record "$records" isolation database_scope "$K_DATABASE_SCOPE" || return 1
  k_record "$records" isolation credentials_scope "$K_CREDENTIALS_SCOPE" || return 1
  k_record "$records" isolation base_url_sha256 "$K_BASE_URL_SHA256" || return 1
  k_record "$records" host node_npm_unavailable "${K_HOST_NODE_NPM_UNAVAILABLE:-false}" || return 1
  k_record "$records" host contract_passed true || return 1
  k_record "$records" host node_observed "${K_HOST_NODE_OBSERVED:-unknown}" || return 1
  k_record "$records" host npm_observed "${K_NPM_OBSERVED:-unknown}" || return 1
  k_record "$records" host docker_daemon_id "${K_DOCKER_DAEMON_ID_OBSERVED:-unknown}" || return 1
  k_record "$records" host gateway_download_device_sha256 "${K_GATEWAY_DOWNLOAD_DEVICE_SHA256_OBSERVED:-unknown}" || return 1
  k_validate_release_inputs C || return 1
  k_validate_candidate_identity || return 1
  k_validate_candidate_source_checkout || return 1
  k_verify_bundle_in_verifier C "$K_EVIDENCE_DIR/c-verifier" || return 1
  k_set_attestation_expectations C || return 1
  k_validate_migration "$K_C_SOURCE_DIR" "$K_PREVIOUS_APP_SHA" "$K_C_APP_SHA" "$K_EVIDENCE_DIR/migration.env" || return 1
  k_validate_recovery_source_checkout || return 1
  k_preflight_recovery_against_previous || return 1
  k_validate_recovery_readiness_record || return 1
  k_stage_recovery_before_boundary || return 1
  k_stage_candidate_entrypoint || return 1
  k_stage_stable_rollback_wrapper || return 1
  k_stage_diagnostic_fallback || return 1
  k_record "$records" recovery source_sha "$K_RECOVERY_SOURCE_SHA" || return 1
  k_record "$records" recovery contract_version "$K_RECOVERY_CONTRACT_VERSION" || return 1
  k_record "$records" recovery source_version "$K_RECOVERY_SOURCE_VERSION" || return 1
  k_record "$records" recovery artifact_sha256 "$K_RECOVERY_ARTIFACT_SHA256" || return 1
  k_record "$records" recovery executor_sha256 "$K_RECOVERY_EXECUTOR_SHA256" || return 1
  k_record "$records" recovery preflight_before_boundary true || return 1
  k_record "$records" migration risk "$(k_read_required_file_value "$K_EVIDENCE_DIR/migration.env" MIGRATION_RISK_LEVEL)" || return 1
  k_record "$records" migration changed_files "$(k_read_file_value "$K_EVIDENCE_DIR/migration.env" MIGRATION_CHANGED_FILES || true)" || return 1
  k_record "$records" migration destructive_files "$(k_read_file_value "$K_EVIDENCE_DIR/migration.env" MIGRATION_DESTRUCTIVE_FILES || true)" || return 1
  k_record "$records" pointer baseline_current "$(k_read_required_file_value "$baseline" STATE_CURRENT_RELEASE_ID)" || return 1
  k_record "$records" pointer baseline_previous "$(k_read_file_value "$baseline" STATE_PREVIOUS_RELEASE_ID || true)" || return 1

  # The watchdog may start before the executor, but it cannot act until it
  # observes this exact transaction in PREPARED and later ACTIVATED_UNVERIFIED.
  k_watchdog_loop "$K_TRANSACTION_ID" "$K_C_RELEASE_ID" "$K_CANDIDATE_SHA" &
  watchdog_pid="$!"
  if k_run_forward_from_stdin; then forward_status=0; else forward_status="$?"; fi
  # Do not wait out the watchdog timeout once the forward has returned.  If it
  # never observed PREPARED, this is a pre-boundary failure; if it did observe
  # the boundary, the shared policy below must classify and recover it.
  if kill -0 "$watchdog_pid" 2>/dev/null; then
    kill "$watchdog_pid" 2>/dev/null || true
  fi
  if wait "$watchdog_pid"; then watchdog_status=0; else watchdog_status="$?"; fi

  # Recovery is intentionally before every strict evidence check below.
  k_process_post_forward "$forward_status" fault "$records" "$phase_file"
  k_record_best_effort "$records" fault watchdog_status "$watchdog_status"
  if [ "$forward_status" -eq 0 ]; then
    k_mark_evidence_incomplete 'Fault leg forward unexpectedly succeeded'
  fi
  if [ "$watchdog_status" -ne 0 ]; then
    k_mark_evidence_incomplete 'Fault watchdog did not complete its expected action'
  fi
  boundary="$(k_read_file_value "$phase_file" MUTATION_BOUNDARY_REACHED || true)"
  if [ "$boundary" != 1 ]; then
    k_mark_evidence_incomplete 'Fault leg did not prove that the mutation boundary was reached'
  fi
  if target_id="$(k_validate_fault_target_evidence)"; then
    k_record_best_effort "$records" fault target_container_id "$target_id"
  else
    k_mark_evidence_incomplete 'Fault target evidence is missing or belongs to another transaction'
  fi

  if [ "${K_RECOVERY_ATTEMPTED:-false}" = true ]; then
    if [ "${K_RECOVERY_RESULT:-FAILED}" = ROLLED_BACK ]; then
      k_record_best_effort "$records" rollback result ROLLED_BACK
    else
      k_record_best_effort "$records" rollback result FAILED
    fi
    if [ -f "${K_ROLLBACK_PHASE_OBSERVATIONS_FILE:-$K_EVIDENCE_DIR/rollback-phase-observations.env}" ]; then
      k_record_rollback_phase_observations "$records" ||
        k_mark_evidence_incomplete 'Rollback phase observations could not be recorded'
    else
      k_mark_evidence_incomplete 'Rollback phase observations are missing'
    fi
  fi

  if [ "${K_RECOVERY_RESULT:-NOT_REQUIRED}" = ROLLED_BACK ]; then
    if ! k_set_attestation_expectations P; then
      k_mark_evidence_incomplete 'P attestation expectations could not be restored'
      post_rollback_contract_status=1
    fi
    if ! k_collect_snapshot "$post_rollback"; then
      k_mark_evidence_incomplete 'Post-recovery P snapshot could not be collected'
      post_rollback_contract_status=1
    elif ! k_validate_attestation "$post_rollback" "$baseline"; then
      k_mark_evidence_incomplete 'Post-recovery P attestation did not match the baseline'
      post_rollback_contract_status=1
    fi
    if ! k_validate_transition "$phase_file"; then
      k_mark_evidence_incomplete 'Post-recovery durable transition is invalid'
      post_rollback_contract_status=1
    fi
    if [ "$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE || true)" != ROLLED_BACK ]; then
      k_mark_evidence_incomplete 'Recovery did not leave the durable phase at ROLLED_BACK'
      post_rollback_contract_status=1
    fi
    if [ "$(k_read_file_value "$phase_file" CURRENT_RELEASE_ID || true)" != "$K_PREVIOUS_RELEASE_ID" ]; then
      k_mark_evidence_incomplete 'Recovery did not restore current to P'
      post_rollback_contract_status=1
    fi
    if [ "$post_rollback_contract_status" -eq 0 ]; then
      k_record_best_effort "$records" rollback health 200
      k_record_best_effort "$records" rollback ready true
      k_record_best_effort "$records" rollback same_persistent_topology true
    else
      k_record_best_effort "$records" rollback health unproven
      k_record_best_effort "$records" rollback ready unproven
      k_record_best_effort "$records" rollback same_persistent_topology unproven
    fi
    k_record_best_effort "$records" rollback current "$K_PREVIOUS_RELEASE_ID"
  elif [ "${K_RECOVERY_ATTEMPTED:-false}" = true ]; then
    k_mark_evidence_incomplete 'Automated recovery did not prove that P was restored'
  fi

  baseline_hash="$(k_hash_file "$baseline" 2>/dev/null || true)"
  k_record_best_effort "$records" evidence baseline_snapshot_sha256 "$baseline_hash"
  if [ -f "$post_rollback" ]; then
    post_rollback_hash="$(k_hash_file "$post_rollback" 2>/dev/null || true)"
    k_record_best_effort "$records" evidence post_rollback_snapshot_sha256 "$post_rollback_hash"
  fi
  if k_validate_recovery "$K_EVIDENCE_DIR/recovery-identity.env"; then
    k_record_best_effort "$records" recovery exact_identity_valid true
  else
    k_mark_evidence_incomplete 'Recovery identity evidence is incomplete'
  fi

  if k_finalize_leg_evidence fault "$records" "$K_TRANSACTION_HISTORY_FILE"; then
    finalize_status=0
  else
    finalize_status="$?"
  fi

  # A fault rehearsal is successful only when the expected fault happened,
  # recovery restored P, and the evidence is complete.  Recovery success
  # never turns the forward leg into success.
  if [ "$forward_status" -eq 0 ] ||
    [ "${K_FORWARD_OUTCOME:-STATE_UNKNOWN_AFTER_FORWARD}" = FORWARD_COMMITTED_FAULT ] ||
    [ "${K_FORWARD_OUTCOME:-STATE_UNKNOWN_AFTER_FORWARD}" = FORWARD_SUCCESS_COMMITTED ] ||
    [ "$boundary" != 1 ] ||
    [ "${K_RECOVERY_RESULT:-FAILED}" != ROLLED_BACK ] ||
    [ "${K_SAFETY_OUTCOME:-RECOVERY_FAILED}" != ROLLED_BACK ] ||
    [ "${K_EVIDENCE_OUTCOME:-INCOMPLETE}" != COMPLETE ] ||
    [ "$finalize_status" -ne 0 ]; then
    k_error 'fault-leg failed; inspect evidence and recovery outcome'
    return 1
  fi
  k_info 'fault-leg completed with the expected fault and P restored; K evidence is still pending'
}

k_execute_success_leg() {
  local baseline="$K_EVIDENCE_DIR/baseline.snapshot"
  local records="$K_EVIDENCE_DIR/records.jsonl"
  local forward_status=0
  local phase_file="$K_DEPLOY_ROOT/release-state/deployment-phase.env"
  local post_commit="$K_EVIDENCE_DIR/post-commit.snapshot"
  local post_recovery="$K_EVIDENCE_DIR/post-recovery.snapshot"
  local finalize_status=1
  local phase=""
  local current=""
  local baseline_hash=""
  local post_commit_hash=""
  local post_recovery_hash=""
  local post_recovery_contract_status=0

  k_require_mutation_confirmation || return 1
  k_validate_host_contract || return 1
  k_prepare_p_baseline "$baseline" || return 1
  k_load_runtime_secrets || return 1
  K_PREVIOUS_RELEASE_ID="$(k_read_required_file_value "$baseline" STATE_CURRENT_RELEASE_ID)"
  K_PREVIOUS_APP_SHA="$K_P_APP_SHA"
  export K_PREVIOUS_RELEASE_ID K_PREVIOUS_APP_SHA
  k_capture_previous_release "$K_DEPLOY_ROOT/release-state" "$K_P_VERIFIER_IMAGE" || return 1
  k_initialize_leg_outcomes
  k_initialize_transaction_history || return 1
  k_initialize_transaction_attempt || return 1
  mkdir -p "$K_EVIDENCE_DIR" || return 1
  k_record "$records" identity transaction_id "$K_TRANSACTION_ID" || return 1
  k_record "$records" identity candidate_sha "$K_CANDIDATE_SHA" || return 1
  k_record "$records" identity previous_release_id "$K_PREVIOUS_RELEASE_ID" || return 1
  k_record "$records" identity environment_id "$K_ENVIRONMENT_ID" || return 1
  k_record "$records" identity previous_release_app_sha "$K_PREVIOUS_APP_SHA" || return 1
  k_record "$records" identity candidate_release_id "$K_C_RELEASE_ID" || return 1
  k_record "$records" identity previous_rc_run_id "$K_P_RC_RUN_ID" || return 1
  k_record "$records" identity candidate_rc_run_id "$K_C_RC_RUN_ID" || return 1
  k_record "$records" identity previous_openpath_sha "$K_P_OPENPATH_SHA" || return 1
  k_record "$records" identity candidate_openpath_sha "$K_C_OPENPATH_SHA" || return 1
  k_record "$records" artifact previous_bundle_sha256 "$K_P_BUNDLE_SHA256" || return 1
  k_record "$records" artifact candidate_bundle_sha256 "$K_C_BUNDLE_SHA256" || return 1
  k_record "$records" artifact previous_contract_sha256 "$K_P_CONTRACT_SHA256" || return 1
  k_record "$records" artifact candidate_contract_sha256 "$K_C_CONTRACT_SHA256" || return 1
  k_record "$records" topology compose_project "$K_COMPOSE_PROJECT" || return 1
  k_record "$records" topology normal_staging_allowed "$K_NORMAL_STAGING_ALLOWED" || return 1
  k_record "$records" isolation database_identity "$K_DATABASE_IDENTITY" || return 1
  k_record "$records" isolation database_endpoint_sha256 "$K_DATABASE_ENDPOINT_SHA256" || return 1
  k_record "$records" isolation database_scope "$K_DATABASE_SCOPE" || return 1
  k_record "$records" isolation credentials_scope "$K_CREDENTIALS_SCOPE" || return 1
  k_record "$records" isolation base_url_sha256 "$K_BASE_URL_SHA256" || return 1
  k_record "$records" host node_npm_unavailable "${K_HOST_NODE_NPM_UNAVAILABLE:-false}" || return 1
  k_record "$records" host contract_passed true || return 1
  k_record "$records" host node_observed "${K_HOST_NODE_OBSERVED:-unknown}" || return 1
  k_record "$records" host npm_observed "${K_NPM_OBSERVED:-unknown}" || return 1
  k_record "$records" host docker_daemon_id "${K_DOCKER_DAEMON_ID_OBSERVED:-unknown}" || return 1
  k_record "$records" host gateway_download_device_sha256 "${K_GATEWAY_DOWNLOAD_DEVICE_SHA256_OBSERVED:-unknown}" || return 1
  k_validate_release_inputs C || return 1
  k_validate_candidate_identity || return 1
  k_validate_candidate_source_checkout || return 1
  k_verify_bundle_in_verifier C "$K_EVIDENCE_DIR/c-verifier" || return 1
  k_set_attestation_expectations C || return 1
  k_validate_migration "$K_C_SOURCE_DIR" "$K_PREVIOUS_APP_SHA" "$K_C_APP_SHA" "$K_EVIDENCE_DIR/migration.env" || return 1
  k_validate_recovery_source_checkout || return 1
  k_preflight_recovery_against_previous || return 1
  k_validate_recovery_readiness_record || return 1
  k_stage_recovery_before_boundary || return 1
  k_stage_candidate_entrypoint || return 1
  k_stage_stable_rollback_wrapper || return 1
  k_stage_diagnostic_fallback || return 1
  k_record "$records" recovery source_sha "$K_RECOVERY_SOURCE_SHA" || return 1
  k_record "$records" recovery contract_version "$K_RECOVERY_CONTRACT_VERSION" || return 1
  k_record "$records" recovery source_version "$K_RECOVERY_SOURCE_VERSION" || return 1
  k_record "$records" recovery artifact_sha256 "$K_RECOVERY_ARTIFACT_SHA256" || return 1
  k_record "$records" recovery executor_sha256 "$K_RECOVERY_EXECUTOR_SHA256" || return 1
  k_record "$records" recovery preflight_before_boundary true || return 1
  k_record "$records" migration risk "$(k_read_required_file_value "$K_EVIDENCE_DIR/migration.env" MIGRATION_RISK_LEVEL)" || return 1
  k_record "$records" migration changed_files "$(k_read_file_value "$K_EVIDENCE_DIR/migration.env" MIGRATION_CHANGED_FILES || true)" || return 1
  k_record "$records" migration destructive_files "$(k_read_file_value "$K_EVIDENCE_DIR/migration.env" MIGRATION_DESTRUCTIVE_FILES || true)" || return 1

  if k_run_forward_from_stdin; then forward_status=0; else forward_status="$?"; fi

  # Classify and recover immediately.  In particular, success-leg failures in
  # SWITCHING or ACTIVATED_UNVERIFIED are failures of the leg, not excuses to
  # leave C active.
  k_process_post_forward "$forward_status" success "$records" "$phase_file"
  if [ "$forward_status" -ne 0 ]; then
    k_mark_evidence_incomplete 'success-leg forward executor failed'
  fi

  if [ "${K_FORWARD_OUTCOME:-STATE_UNKNOWN_AFTER_FORWARD}" = FORWARD_SUCCESS_COMMITTED ]; then
    if ! k_require_durable_recovery_artifact; then
      k_mark_evidence_incomplete 'Committed success did not retain exact recovery identity'
    fi
    if ! k_validate_recovery "$K_EVIDENCE_DIR/recovery-identity.env"; then
      k_mark_evidence_incomplete 'Committed success recovery identity evidence is incomplete'
    fi
    if ! k_validate_transition "$phase_file"; then
      k_mark_evidence_incomplete 'Committed success durable transition is invalid'
    fi
    phase="$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE || true)"
    current="$(k_read_file_value "$phase_file" CURRENT_RELEASE_ID || true)"
    [ "$phase" = COMMITTED ] || k_mark_evidence_incomplete 'success-leg did not end in COMMITTED'
    [ "$current" = "$K_C_RELEASE_ID" ] || k_mark_evidence_incomplete 'success-leg current does not point to C'
    if ! k_collect_snapshot "$post_commit"; then
      k_mark_evidence_incomplete 'Post-commit attestation snapshot could not be collected'
    elif ! k_validate_attestation "$post_commit" "$baseline"; then
      k_mark_evidence_incomplete 'Post-commit attestation does not match the baseline contract'
    fi
    post_commit_hash="$(k_hash_file "$post_commit" 2>/dev/null || true)"
    k_record_best_effort "$records" pointer current "$K_C_RELEASE_ID"
    k_record_best_effort "$records" pointer previous "$K_PREVIOUS_RELEASE_ID"
    k_record_best_effort "$records" evidence post_commit_snapshot_sha256 "$post_commit_hash"
  elif [ "${K_RECOVERY_RESULT:-NOT_REQUIRED}" = ROLLED_BACK ]; then
    if ! k_set_attestation_expectations P; then
      k_mark_evidence_incomplete 'P attestation expectations could not be restored after success-leg failure'
      post_recovery_contract_status=1
    fi
    if ! k_collect_snapshot "$post_recovery"; then
      k_mark_evidence_incomplete 'Post-recovery P snapshot could not be collected'
      post_recovery_contract_status=1
    elif ! k_validate_attestation "$post_recovery" "$baseline"; then
      k_mark_evidence_incomplete 'Post-recovery P attestation did not match the baseline'
      post_recovery_contract_status=1
    fi
    if ! k_validate_transition "$phase_file"; then
      k_mark_evidence_incomplete 'Post-recovery durable transition is invalid'
      post_recovery_contract_status=1
    fi
    if [ "$(k_read_file_value "$phase_file" DEPLOYMENT_PHASE || true)" != ROLLED_BACK ]; then
      k_mark_evidence_incomplete 'success-leg recovery did not end in ROLLED_BACK'
      post_recovery_contract_status=1
    fi
    if [ "$(k_read_file_value "$phase_file" CURRENT_RELEASE_ID || true)" != "$K_PREVIOUS_RELEASE_ID" ]; then
      k_mark_evidence_incomplete 'success-leg recovery did not restore P'
      post_recovery_contract_status=1
    fi
    if [ "$post_recovery_contract_status" -eq 0 ]; then
      k_record_best_effort "$records" rollback health 200
      k_record_best_effort "$records" rollback ready true
      k_record_best_effort "$records" rollback same_persistent_topology true
    else
      k_record_best_effort "$records" rollback health unproven
      k_record_best_effort "$records" rollback ready unproven
      k_record_best_effort "$records" rollback same_persistent_topology unproven
    fi
    post_recovery_hash="$(k_hash_file "$post_recovery" 2>/dev/null || true)"
    k_record_best_effort "$records" rollback current "$K_PREVIOUS_RELEASE_ID"
    k_record_best_effort "$records" evidence post_recovery_snapshot_sha256 "$post_recovery_hash"
  else
    k_mark_evidence_incomplete "success-leg forward outcome was ${K_FORWARD_OUTCOME:-unknown}"
  fi

  baseline_hash="$(k_hash_file "$baseline" 2>/dev/null || true)"
  k_record_best_effort "$records" evidence baseline_snapshot_sha256 "$baseline_hash"
  if k_finalize_leg_evidence success "$records" "$K_TRANSACTION_HISTORY_FILE"; then
    finalize_status=0
  else
    finalize_status="$?"
  fi

  if [ "$forward_status" -ne 0 ] ||
    [ "${K_FORWARD_OUTCOME:-STATE_UNKNOWN_AFTER_FORWARD}" != FORWARD_SUCCESS_COMMITTED ] ||
    [ "${K_SAFETY_OUTCOME:-UNDETERMINED}" != COMMITTED ] ||
    [ "${K_EVIDENCE_OUTCOME:-INCOMPLETE}" != COMPLETE ] ||
    [ "$finalize_status" -ne 0 ]; then
    k_error 'success-leg failed; inspect evidence and recovery outcome'
    return 1
  fi
  k_info 'success-leg orchestration completed; K evidence is still pending'
}

k_parse_options() {
  K_CONFIG_OPTION=""
  K_SNAPSHOT_OPTION=""
  K_BASELINE_OPTION=""
  K_OUTPUT_OPTION=""
  K_OUTPUT_DIR_OPTION=""
  K_REPO_OPTION=""
  K_FROM_OPTION=""
  K_TO_OPTION=""
  K_STATE_OPTION=""
  K_RECORDS_OPTION=""
  K_PATH_OPTION="${PATH:-}"
  K_CONFIRM_STAGING_EQUIVALENT=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --config) K_CONFIG_OPTION="${2:-}"; shift 2 ;;
      --snapshot) K_SNAPSHOT_OPTION="${2:-}"; shift 2 ;;
      --baseline) K_BASELINE_OPTION="${2:-}"; shift 2 ;;
      --output) K_OUTPUT_OPTION="${2:-}"; shift 2 ;;
      --output-dir) K_OUTPUT_DIR_OPTION="${2:-}"; shift 2 ;;
      --repo) K_REPO_OPTION="${2:-}"; shift 2 ;;
      --from) K_FROM_OPTION="${2:-}"; shift 2 ;;
      --to) K_TO_OPTION="${2:-}"; shift 2 ;;
      --state) K_STATE_OPTION="${2:-}"; shift 2 ;;
      --records) K_RECORDS_OPTION="${2:-}"; shift 2 ;;
      --path) K_PATH_OPTION="${2:-}"; shift 2 ;;
      --confirm-staging-equivalent) K_CONFIRM_STAGING_EQUIVALENT=1; shift ;;
      -h|--help) k_usage; return 2 ;;
      *) k_error "Unknown option: $1"; return 2 ;;
    esac
  done
}

k_main() {
  local command="${1:-}"
  shift || true

  [ -n "$command" ] || { k_usage >&2; return 2; }
  k_parse_options "$@" || return $?
  case "$command" in
    validate-host-path)
      k_source_host_contract || return 1
      k_validate_effective_host_path "$K_PATH_OPTION"
      ;;
    validate-transition)
      [ -n "$K_STATE_OPTION" ] || { k_error 'validate-transition requires --state FILE'; return 2; }
      k_validate_transition "$K_STATE_OPTION"
      ;;
  validate-environment|validate-attestation|attest-p|prepare-recovery|validate-recovery|validate-migration|evidence|provision|fault-leg|success-leg|rollback)
      [ -n "$K_CONFIG_OPTION" ] || { k_error '--config is required'; return 2; }
      k_load_config "$K_CONFIG_OPTION" || return 1
      k_validate_environment || return 1
      case "$command" in
        validate-environment) ;;
        prepare-recovery)
          K_EVIDENCE_DIR="${K_EVIDENCE_DIR:-$K_DEPLOY_ROOT/k-evidence}"
          mkdir -p "$K_EVIDENCE_DIR"
          k_source_host_contract || return 1
          K_EFFECTIVE_HOST_PATH="$(k_build_effective_host_path)" || return 1
          PATH="$K_EFFECTIVE_HOST_PATH"
          export K_EVIDENCE_DIR K_EFFECTIVE_HOST_PATH PATH
          k_prepare_recovery_artifact
          ;;
        validate-attestation)
          [ -n "$K_SNAPSHOT_OPTION" ] || { k_error '--snapshot is required'; return 2; }
          k_validate_attestation "$K_SNAPSHOT_OPTION" "$K_BASELINE_OPTION"
          ;;
        attest-p)
          k_attest_p
          ;;
        validate-recovery) k_validate_recovery "$K_OUTPUT_OPTION" ;;
        validate-migration)
          [ -n "$K_REPO_OPTION" ] && [ -n "$K_FROM_OPTION" ] && [ -n "$K_TO_OPTION" ] && [ -n "$K_OUTPUT_OPTION" ] || {
            k_error 'migration validation requires --repo, --from, --to, and --output'
            return 2
          }
          k_validate_migration "$K_REPO_OPTION" "$K_FROM_OPTION" "$K_TO_OPTION" "$K_OUTPUT_OPTION"
          ;;
        evidence)
          [ -n "$K_OUTPUT_DIR_OPTION" ] || { k_error '--output-dir is required'; return 2; }
          [ -n "$K_RECORDS_OPTION" ] || { k_error '--records is required'; return 2; }
          k_build_evidence "$K_RECORDS_OPTION" "$K_OUTPUT_DIR_OPTION"
          ;;
        provision)
          K_EVIDENCE_DIR="${K_EVIDENCE_DIR:-$K_DEPLOY_ROOT/k-evidence}"
          k_provision_p
          ;;
        fault-leg)
          K_EVIDENCE_DIR="${K_EVIDENCE_DIR:-$K_DEPLOY_ROOT/k-evidence}"
          mkdir -p "$K_EVIDENCE_DIR"
          k_execute_fault_leg
          ;;
        success-leg)
          K_EVIDENCE_DIR="${K_EVIDENCE_DIR:-$K_DEPLOY_ROOT/k-evidence}"
          mkdir -p "$K_EVIDENCE_DIR"
          k_execute_success_leg
          ;;
        rollback)
          K_EVIDENCE_DIR="${K_EVIDENCE_DIR:-$K_DEPLOY_ROOT/k-evidence}"
          K_APP_DIR="${K_APP_DIR:-$K_DEPLOY_ROOT/app}"
          export K_APP_DIR
          mkdir -p "$K_EVIDENCE_DIR"
          k_require_mutation_confirmation || return 1
          k_validate_host_contract || return 1
          k_load_runtime_secrets || return 1
          K_PREVIOUS_RELEASE_ID="$(k_read_file_value "$K_DEPLOY_ROOT/release-state/deployment-phase.env" PREVIOUS_RELEASE_ID || true)"
          [ -n "$K_PREVIOUS_RELEASE_ID" ] || {
            k_error 'Manual rollback cannot determine the durable baseline P'
            return 1
          }
          export K_PREVIOUS_RELEASE_ID
          K_MANUAL_ROLLBACK=1
          export K_MANUAL_ROLLBACK
          k_run_rollback_from_stdin
          ;;
      esac
      ;;
    *) k_error "Unknown command: $command"; k_usage >&2; return 2 ;;
  esac
}

if [ "${BASH_SOURCE[0]:-}" = "$0" ]; then
  set -euo pipefail
  k_main "$@"
fi
