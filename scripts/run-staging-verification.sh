#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOLVE_HOST_SCRIPT_PATH="$SCRIPT_DIR/resolve-ssh-host.sh"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/staging-gates.sh
source "$SCRIPT_DIR/lib/staging-gates.sh"
# shellcheck source=lib/release-state.sh
source "$SCRIPT_DIR/lib/release-state.sh"

persist_staging_verification_evidence() {
  local state_dir="${STATE_DIR:-/opt/classroompath/release-state}"
  local app_dir="${APP_DIR:-/opt/classroompath/app}"
  local openpath_sha=""

  mkdir -p "$state_dir"

  if [ ! -f "$state_dir/current-images.env" ]; then
    echo "current-images.env is missing" >&2
    return 1
  fi

  load_release_state_env "$state_dir/current-images.env"
  openpath_sha="$(git -C "$app_dir/upstream/openpath" rev-parse HEAD)"

  STAGING_VERIFIED_BY="deploy-staging-local.sh" \
  STAGING_VERIFIED_APP_SHA="${APP_SHA:-}" \
  STAGING_VERIFIED_OPENPATH_SHA="${openpath_sha:-}" \
  STAGING_VERIFIED_IMAGE_SOURCE="${IMAGE_SOURCE:-}" \
  STAGING_VERIFIED_GATEWAY_IMAGE="${CLASSROOMPATH_GATEWAY_IMAGE:-}" \
  STAGING_VERIFIED_MIGRATIONS_IMAGE="${CLASSROOMPATH_MIGRATIONS_IMAGE:-}" \
  STAGING_VERIFIED_OPENPATH_API_IMAGE="${OPENPATH_API_IMAGE:-}" \
  STAGING_VERIFIED_OPENPATH_VERSION="${OPENPATH_VERSION:-}" \
  STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION="${OPENPATH_LINUX_AGENT_VERSION:-}" \
  STAGING_VERIFIED_SPA_IMAGE="${CLASSROOMPATH_SPA_IMAGE:-}" \
    write_staging_verification_state "$state_dir/staging-verification.env"
}

run_smoke_subcommand() {
  if [ "$#" -lt 4 ]; then
    echo "Usage: run-staging-verification.sh smoke <state-file> <staging-host> <smoke-url> <ssh-cmd...>" >&2
    exit 2
  fi

  local state_file="$1"
  local staging_host="$2"
  local smoke_target_url="$3"
  shift 3
  local -a ssh_cmd=("$@")

  reset_staging_verification_env
  run_staging_smoke_gate "$staging_host" "$smoke_target_url" "${ssh_cmd[@]}"
  write_staging_verification_run_state "$state_file"
}

run_release_gate_subcommand() {
  if [ "$#" -lt 5 ]; then
    echo "Usage: run-staging-verification.sh release-gate <state-file> <staging-host> <canonical-staging-url> <staging-use-release-candidate> <ssh-cmd...>" >&2
    exit 2
  fi

  local state_file="$1"
  local staging_host="$2"
  local canonical_staging_url="$3"
  local staging_use_release_candidate="$4"
  shift 4
  local -a ssh_cmd=("$@")

  reset_staging_verification_env
  run_staging_release_gate "$canonical_staging_url" "$staging_use_release_candidate" "${ssh_cmd[@]}"
  run_staging_windows_bootstrap_gate "$canonical_staging_url" "${ssh_cmd[@]}"
  write_staging_verification_run_state "$state_file"
}

run_collect_subcommand() {
  if [ "$#" -lt 6 ]; then
    echo "Usage: run-staging-verification.sh collect <state-file> <staging-host> <smoke-url> <canonical-staging-url> <staging-use-release-candidate> <ssh-cmd...>" >&2
    exit 2
  fi

  local state_file="$1"
  local staging_host="$2"
  local smoke_target_url="$3"
  local canonical_staging_url="$4"
  local staging_use_release_candidate="$5"
  shift 5
  local -a ssh_cmd=("$@")

  reset_staging_verification_env
  run_staging_smoke_gate "$staging_host" "$smoke_target_url" "${ssh_cmd[@]}"
  run_staging_release_gate "$canonical_staging_url" "$staging_use_release_candidate" "${ssh_cmd[@]}"
  run_staging_windows_bootstrap_gate "$canonical_staging_url" "${ssh_cmd[@]}"
  write_staging_verification_run_state "$state_file"
}

main() {
  local command="${1:-}"
  shift || true

  case "$command" in
    smoke)
      run_smoke_subcommand "$@"
      ;;
    release-gate)
      run_release_gate_subcommand "$@"
      ;;
    collect)
      run_collect_subcommand "$@"
      ;;
    persist-evidence)
      persist_staging_verification_evidence "$@"
      ;;
    *)
      echo "Usage: run-staging-verification.sh <smoke|release-gate|collect|persist-evidence> ..." >&2
      exit 2
      ;;
  esac
}

main "$@"
