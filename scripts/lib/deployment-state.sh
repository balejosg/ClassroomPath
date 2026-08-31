#!/usr/bin/env bash
# shellcheck shell=bash

DEPLOYMENT_STATE_HELPER_CONTRACT_VERSION=1

deployment_state_init_paths() {
  local state_dir="$1"

  DEPLOYMENT_STATE_DIR="$state_dir"
  DEPLOYMENT_STATE_RELEASES_DIR="$state_dir/releases"
  DEPLOYMENT_STATE_CURRENT_POINTER_FILE="$state_dir/current"
  DEPLOYMENT_STATE_PREVIOUS_POINTER_FILE="$state_dir/previous"
  DEPLOYMENT_STATE_PENDING_FILE="$state_dir/pending-images.env"
  DEPLOYMENT_STATE_CURRENT_FILE="$state_dir/current-images.env"
  DEPLOYMENT_STATE_PREVIOUS_FILE="$state_dir/previous-images.env"
  DEPLOYMENT_STATE_CONTEXT_FILE="$state_dir/deploy-context.env"
}

deployment_state_bundle_cli_path() {
  local helper_source="${BASH_SOURCE[0]:-}"
  local helper_dir=""

  if [ -n "$helper_source" ]; then
    helper_dir="$(cd "$(dirname "$helper_source")" && pwd)"
  else
    helper_dir="$(pwd)/scripts/lib"
  fi

  printf '%s\n' "$helper_dir/release-bundle-state.mjs"
}

deployment_state_v2_pointer_present() {
  local pointer="$1"
  [ "$pointer" = "current" ] || [ "$pointer" = "previous" ] || return 1
  [ -s "$DEPLOYMENT_STATE_DIR/$pointer" ]
}

deployment_state_cli_available() {
  command -v node >/dev/null 2>&1 && [ -f "$(deployment_state_bundle_cli_path)" ]
}

deployment_state_verifier_image() {
  local verifier_image="${CLASSROOMPATH_VERIFIER_IMAGE:-}"
  local current_release_id=""
  local current_runtime_file=""

  if [ -z "$verifier_image" ] && deployment_state_v2_pointer_present current; then
    current_release_id="$(tr -d '\r\n' < "$DEPLOYMENT_STATE_CURRENT_POINTER_FILE")"
    if [[ "$current_release_id" =~ ^[0-9a-f]{64}$ ]]; then
      current_runtime_file="$DEPLOYMENT_STATE_RELEASES_DIR/$current_release_id/runtime.env"
      if [ -f "$current_runtime_file" ]; then
        verifier_image="$(awk -F= '$1 == "CLASSROOMPATH_VERIFIER_IMAGE" { print substr($0, index($0, "=") + 1); exit }' "$current_runtime_file")"
      fi
    fi
  fi

  if [[ ! "$verifier_image" =~ @sha256:[0-9a-f]{64}$ ]]; then
    log_error "Release Bundle v2 state helper requires an immutable verifier image" >&2
    return 1
  fi

  printf '%s\n' "$verifier_image"
}

deployment_state_run_cli_in_verifier() {
  local command_name="$1"
  local bundle_file="${2:-}"
  local contract_file="${3:-}"
  local output_file="${4:-}"
  shift 4

  local verifier_image=""
  local output_dir=""
  local -a docker_mounts=(
    -v
    "$DEPLOYMENT_STATE_DIR:/tmp/classroompath-release-state:rw"
  )
  local -a cli_args=(
    "$command_name"
    --state-root
    /tmp/classroompath-release-state
  )

  verifier_image="$(deployment_state_verifier_image)" || return 1

  if [ -n "$bundle_file" ] || [ -n "$contract_file" ]; then
    if [ -z "$bundle_file" ] || [ -z "$contract_file" ]; then
      log_error "Release Bundle v2 verifier execution requires both bundle and contract files"
      return 1
    fi
    if ! chmod 644 "$bundle_file" "$contract_file"; then
      log_error "Unable to prepare Release Bundle v2 files for verifier execution"
      return 1
    fi
    docker_mounts+=(
      -v
      "$bundle_file:/tmp/classroompath-release-bundle.json:ro"
      -v
      "$contract_file:/tmp/openpath-promotion-contract.json:ro"
    )
    cli_args+=(
      --bundle-file
      /tmp/classroompath-release-bundle.json
      --contract-file
      /tmp/openpath-promotion-contract.json
    )
  fi

  if [ -n "$output_file" ]; then
    output_dir="$(mktemp -d)"
    if ! chmod 777 "$output_dir"; then
      rm -rf "$output_dir"
      log_error "Unable to prepare Release Bundle v2 verifier output directory"
      return 1
    fi
    docker_mounts+=(
      -v
      "$output_dir:/tmp/release-state-output:rw"
    )
    cli_args+=(
      --output-env
      /tmp/release-state-output/runtime.env
    )
  fi

  if ! docker run --rm \
    --user "$(id -u):$(id -g)" \
    --entrypoint node \
    "${docker_mounts[@]}" \
    "$verifier_image" \
    "/app/scripts/lib/release-bundle-state.mjs" \
    "${cli_args[@]}" \
    "$@"; then
    [ -n "$output_dir" ] && rm -rf "$output_dir"
    log_error "Release Bundle v2 state CLI failed inside the verifier image"
    return 1
  fi

  if [ -n "$output_file" ]; then
    if [ ! -s "$output_dir/runtime.env" ] || ! cp "$output_dir/runtime.env" "$output_file"; then
      rm -rf "$output_dir"
      log_error "Verifier image did not emit the Release Bundle v2 runtime projection"
      return 1
    fi
    rm -rf "$output_dir"
  fi
}

deployment_state_read_v2_pointer() {
  local pointer="$1"
  local runtime_file=""
  local metadata=""
  local release_id=""

  if ! deployment_state_v2_pointer_present "$pointer"; then
    log_error "Release Bundle v2 $pointer pointer is missing"
    return 1
  fi
  runtime_file="$(mktemp)"
  if deployment_state_cli_available; then
    if ! metadata="$(node "$(deployment_state_bundle_cli_path)" read \
      --state-root "$DEPLOYMENT_STATE_DIR" \
      --pointer "$pointer" \
      --output-env "$runtime_file")"; then
      rm -f "$runtime_file"
      return 1
    fi
  elif ! metadata="$(deployment_state_run_cli_in_verifier read "" "" "$runtime_file" --pointer "$pointer")"; then
    rm -f "$runtime_file"
    return 1
  fi

  release_id="$(printf '%s\n' "$metadata" | sed -n 's/.*"releaseId":"\([0-9a-f]*\)".*/\1/p')"
  if [ -z "$release_id" ]; then
    rm -f "$runtime_file"
    log_error "Release Bundle v2 $pointer pointer did not return a releaseId"
    return 1
  fi

  set -a
  # shellcheck disable=SC1090 # generated from verified immutable bundle state
  . "$runtime_file"
  set +a
  rm -f "$runtime_file"
  DEPLOYMENT_STATE_RELEASE_ID="$release_id"
  DEPLOYMENT_STATE_POINTER="$pointer"
  export DEPLOYMENT_STATE_RELEASE_ID DEPLOYMENT_STATE_POINTER
}

deployment_state_persist_v2_release() {
  local bundle_file="$1"
  local contract_file="$2"
  local release_id="$3"
  local rc_run_id="${4:-${RC_RUN_ID:-}}"
  local -a persist_args=(
    persist
    --state-root
    "$DEPLOYMENT_STATE_DIR"
    --bundle-file
    "$bundle_file"
    --contract-file
    "$contract_file"
    --release-id
    "$release_id"
  )

  if [ -z "$bundle_file" ] || [ -z "$contract_file" ] || [ -z "$release_id" ]; then
    log_error "Release Bundle v2 persistence requires bundle, contract, and releaseId"
    return 1
  fi
  if [ -n "$rc_run_id" ]; then
    persist_args+=(--rc-run-id "$rc_run_id")
  fi
  if deployment_state_cli_available; then
    node "$(deployment_state_bundle_cli_path)" "${persist_args[@]}" >/dev/null
  else
    local -a verifier_args=(--release-id "$release_id")
    if [ -n "$rc_run_id" ]; then
      verifier_args+=(--rc-run-id "$rc_run_id")
    fi
    deployment_state_run_cli_in_verifier \
      persist \
      "$bundle_file" \
      "$contract_file" \
      "" \
      "${verifier_args[@]}" >/dev/null
  fi
}

deployment_state_activate_v2_release() {
  local release_id="$1"

  if [ -z "$release_id" ]; then
    log_error "Release Bundle v2 activation requires releaseId"
    return 1
  fi
  if deployment_state_cli_available; then
    node "$(deployment_state_bundle_cli_path)" activate \
      --state-root "$DEPLOYMENT_STATE_DIR" \
      --release-id "$release_id" >/dev/null
  else
    deployment_state_run_cli_in_verifier \
      activate \
      "" \
      "" \
      "" \
      --release-id "$release_id" >/dev/null
  fi
}

deployment_state_activate_v2_previous_release() {
  if deployment_state_cli_available; then
    node "$(deployment_state_bundle_cli_path)" activate-previous \
      --state-root "$DEPLOYMENT_STATE_DIR" >/dev/null
  else
    deployment_state_run_cli_in_verifier \
      activate-previous \
      "" \
      "" \
      "" >/dev/null
  fi
}

deployment_state_capture_previous_release() {
  if deployment_state_v2_pointer_present current; then
    if deployment_state_cli_available; then
      if ! node "$(deployment_state_bundle_cli_path)" capture-previous \
        --state-root "$DEPLOYMENT_STATE_DIR" >/dev/null; then
        log_error "Unable to capture the active Release Bundle v2 as the rollback target"
        return 1
      fi
    elif ! deployment_state_run_cli_in_verifier capture-previous "" "" "" >/dev/null; then
      log_error "Unable to capture the active Release Bundle v2 as the rollback target"
      return 1
    fi
  fi

  if [ -f "$DEPLOYMENT_STATE_CURRENT_FILE" ]; then
    cp "$DEPLOYMENT_STATE_CURRENT_FILE" "$DEPLOYMENT_STATE_PREVIOUS_FILE"
    PREVIOUS_APP_SHA="$(awk -F= '/^APP_SHA=/{print $2}' "$DEPLOYMENT_STATE_CURRENT_FILE" | head -1)"
  else
    PREVIOUS_APP_SHA="${PREVIOUS_APP_SHA:-}"
  fi
}

deployment_state_load_previous_release() {
  if deployment_state_v2_pointer_present previous; then
    deployment_state_read_v2_pointer previous
    return $?
  fi

  if [ ! -f "$DEPLOYMENT_STATE_PREVIOUS_FILE" ]; then
    log_error "No previous release metadata available: $DEPLOYMENT_STATE_PREVIOUS_FILE"
    return 1
  fi

  load_release_state_env "$DEPLOYMENT_STATE_PREVIOUS_FILE"
}

deployment_state_load_context() {
  if [ -f "$DEPLOYMENT_STATE_CONTEXT_FILE" ]; then
    load_release_state_env "$DEPLOYMENT_STATE_CONTEXT_FILE"
  fi
}

deployment_state_activate_previous_release() {
  if deployment_state_v2_pointer_present previous; then
    if ! deployment_state_activate_v2_previous_release; then
      return 1
    fi
    if declare -f write_current_release_state >/dev/null 2>&1; then
      write_current_release_state "$DEPLOYMENT_STATE_CURRENT_FILE"
    elif [ -f "$DEPLOYMENT_STATE_PREVIOUS_FILE" ]; then
      cp "$DEPLOYMENT_STATE_PREVIOUS_FILE" "$DEPLOYMENT_STATE_CURRENT_FILE"
    fi
    return 0
  fi

  if [ ! -f "$DEPLOYMENT_STATE_PREVIOUS_FILE" ]; then
    log_error "No previous release metadata available: $DEPLOYMENT_STATE_PREVIOUS_FILE"
    return 1
  fi

  cp "$DEPLOYMENT_STATE_PREVIOUS_FILE" "$DEPLOYMENT_STATE_CURRENT_FILE"
}

deployment_state_publish_pending_release() {
  if [ ! -f "$DEPLOYMENT_STATE_PENDING_FILE" ]; then
    log_error "Pending release runtime state is missing: $DEPLOYMENT_STATE_PENDING_FILE"
    return 1
  fi

  mkdir -p "$DEPLOYMENT_STATE_DIR"
  mv -f "$DEPLOYMENT_STATE_PENDING_FILE" "$DEPLOYMENT_STATE_CURRENT_FILE"
}
