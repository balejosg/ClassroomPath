#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOLVE_HOST_SCRIPT_PATH="$SCRIPT_DIR/resolve-ssh-host.sh"

# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck source=lib/release-state.sh
source "$SCRIPT_DIR/lib/release-state.sh"

reset_staging_verification_env() {
  SMOKE_TARGET_URL=""
  SMOKE_SKIP_CORS="0"
  STAGING_SMOKE_RESULT=""
  STAGING_SMOKE_STATUS=""
  RELEASE_GATE_TARGET_URL=""
  RELEASE_GATE_EXPECTED_ORIGIN=""
  STAGING_RELEASE_GATE_RESULT=""
  STAGING_VERIFIED_AT=""
  STAGING_FIREFOX_RELEASE_ARTIFACTS=""
  STAGING_WINDOWS_BOOTSTRAP_RESULT=""
  STAGING_FIREFOX_POLICY_RESULT=""
  STAGING_FIREFOX_EXTENSION_ID=""
  STAGING_FIREFOX_RELEASE_VERSION=""
  STAGING_FIREFOX_METADATA_SHA256=""
  STAGING_FIREFOX_XPI_SHA256=""
}

resolve_target_address() {
  local target_host="$1"
  local target_port="${2:-443}"
  local resolver_output=""
  local resolved_address=""

  if [ -z "$target_host" ]; then
    printf '\n'
    return 0
  fi

  resolver_output="$(bash "$RESOLVE_HOST_SCRIPT_PATH" "$target_host" "$target_port" 1 2>/dev/null || true)"
  resolved_address="$(printf '%s\n' "$resolver_output" | awk -F= '$1=="ip"{print $2}' | head -1)"

  if [ -n "$resolved_address" ]; then
    printf '%s\n' "$resolved_address"
    return 0
  fi

  if ! getent hosts "$target_host" >/dev/null 2>&1; then
    echo "Target host does not resolve locally and explicit resolution failed: $target_host" >&2
    return 1
  fi

  printf '\n'
}

run_smoke_checks() {
  local staging_host="$1"
  local smoke_target_url="$2"
  shift 2 || true
  local smoke_target_host=""
  local smoke_test_resolved_address=""
  local smoke_exit_code=0

  SMOKE_TARGET_URL="$smoke_target_url"
  SMOKE_SKIP_CORS="0"
  STAGING_SMOKE_RESULT="failed"
  STAGING_SMOKE_STATUS="FAIL"

  smoke_target_host=$(printf '%s\n' "$SMOKE_TARGET_URL" | sed -E 's#^[A-Za-z]+://([^/:]+).*#\1#')
  smoke_test_resolved_address="$(resolve_target_address "$smoke_target_host" 443)"

  if [ -n "$smoke_test_resolved_address" ]; then
    echo "Smoke target host resolved explicitly: $smoke_target_host -> $smoke_test_resolved_address" >&2
  fi

  echo "Smoke target URL: $SMOKE_TARGET_URL" >&2

  set +e
  (
    cd "$PROJECT_ROOT"
    set +e
    SMOKE_TEST_URL="$SMOKE_TARGET_URL" \
    SMOKE_TEST_TIMEOUT="15000" \
    SMOKE_SKIP_CORS="$SMOKE_SKIP_CORS" \
    SMOKE_ALLOW_MUTATIONS="1" \
    SMOKE_TEST_RESOLVED_ADDRESS="$smoke_test_resolved_address" \
      npm run test:smoke 2>&1 | tee /tmp/smoke-results.txt
    smoke_exit_code=${PIPESTATUS[0]}
    exit "$smoke_exit_code"
  )
  smoke_exit_code=$?
  set -e

  if [ "$smoke_exit_code" -ne 0 ]; then
    echo "Smoke tests FAILED (exit code: $smoke_exit_code)" >&2
    echo "Review output above for details" >&2
    echo >&2
    echo "Common issues:" >&2
    echo "  - NPM reverse proxy not routing correctly" >&2
    echo "  - CORS_ORIGINS missing staging domain" >&2
    echo "  - Container started but not fully ready" >&2
    echo >&2
    echo "Debug commands:" >&2
    echo "  ssh deploy@$staging_host 'docker logs classroompath-gateway --tail 50'" >&2
    echo "  ssh deploy@$staging_host 'docker logs classroompath-api --tail 50'" >&2
    echo "  curl -v $SMOKE_TARGET_URL/health" >&2
    return 1
  fi

  STAGING_SMOKE_RESULT="success"
  STAGING_SMOKE_STATUS="PASS"
  echo "Smoke tests passed" >&2
}

run_release_gate_checks() {
  local CANONICAL_STAGING_URL="$1"
  local STAGING_USE_RELEASE_CANDIDATE="$2"
  shift 2
  local -a ssh_cmd=("$@")
  local release_gate_target_host=""
  local release_gate_resolved_address=""
  local release_gate_request_origin=""
  local release_gate_exit_code=0
  local windows_bootstrap_exit_code=0
  local staging_firefox_metadata_json=""

  RELEASE_GATE_TARGET_URL="$CANONICAL_STAGING_URL"
  RELEASE_GATE_EXPECTED_ORIGIN="$(node -e 'console.log(new URL(process.argv[1]).origin)' "$CANONICAL_STAGING_URL")"
  STAGING_RELEASE_GATE_RESULT="failed"
  STAGING_WINDOWS_BOOTSTRAP_RESULT="failed"
  STAGING_FIREFOX_POLICY_RESULT="failed"

  release_gate_target_host=$(printf '%s\n' "$CANONICAL_STAGING_URL" | sed -E 's#^[A-Za-z]+://([^/:]+).*#\1#')
  release_gate_resolved_address="$(resolve_target_address "$release_gate_target_host" 443)"

  if [ -n "$release_gate_resolved_address" ]; then
    echo "Release gate host resolved explicitly: $release_gate_target_host -> $release_gate_resolved_address" >&2
  fi

  release_gate_request_origin="$RELEASE_GATE_EXPECTED_ORIGIN"

  echo "Release gate target URL: $CANONICAL_STAGING_URL" >&2
  echo "Release gate expected origin: $RELEASE_GATE_EXPECTED_ORIGIN" >&2

  set +e
  (
    cd "$PROJECT_ROOT"
    set +e
    RELEASE_GATE_URL="$CANONICAL_STAGING_URL" \
    RELEASE_GATE_EXPECTED_ORIGIN="$RELEASE_GATE_EXPECTED_ORIGIN" \
    RELEASE_GATE_REQUEST_ORIGIN="$release_gate_request_origin" \
    RELEASE_GATE_TIMEOUT="30000" \
    RELEASE_GATE_ALLOW_MUTATIONS="1" \
    RELEASE_GATE_RESOLVED_ADDRESS="$release_gate_resolved_address" \
      npm run test:release-gate 2>&1 | tee /tmp/release-gate-results.txt
    release_gate_exit_code=${PIPESTATUS[0]}
    exit "$release_gate_exit_code"
  )
  release_gate_exit_code=$?
  set -e

  if [ "$release_gate_exit_code" -ne 0 ]; then
    echo "Release gate FAILED (exit code: $release_gate_exit_code)" >&2
    echo "Staging was deployed, but promotion evidence was not recorded" >&2
    return 1
  fi

  STAGING_RELEASE_GATE_RESULT="success"
  STAGING_VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Release gate passed" >&2

  echo "Verifying Firefox release artifacts inside classroompath-api..." >&2
  "${ssh_cmd[@]}" \
    "docker exec classroompath-api test -f /app/firefox-extension/build/firefox-release/metadata.json && docker exec classroompath-api test -f /app/firefox-extension/build/firefox-release/openpath-firefox-extension.xpi"

  echo "Verifying shared browser policy spec inside classroompath-api..." >&2
  "${ssh_cmd[@]}" \
    "docker exec classroompath-api test -f /app/runtime/browser-policy-spec.json"

  STAGING_FIREFOX_RELEASE_ARTIFACTS="present"
  staging_firefox_metadata_json="$("${ssh_cmd[@]}" "docker exec classroompath-api cat /app/firefox-extension/build/firefox-release/metadata.json")"
  STAGING_FIREFOX_EXTENSION_ID="$(printf '%s' "$staging_firefox_metadata_json" | node "$SCRIPT_DIR/read-firefox-release-metadata.mjs" --field extensionId)"
  STAGING_FIREFOX_RELEASE_VERSION="$(printf '%s' "$staging_firefox_metadata_json" | node "$SCRIPT_DIR/read-firefox-release-metadata.mjs" --field version)"
  STAGING_FIREFOX_METADATA_SHA256="$("${ssh_cmd[@]}" "docker exec classroompath-api sha256sum /app/firefox-extension/build/firefox-release/metadata.json | awk '{print \$1}'")"
  STAGING_FIREFOX_XPI_SHA256="$("${ssh_cmd[@]}" "docker exec classroompath-api sha256sum /app/firefox-extension/build/firefox-release/openpath-firefox-extension.xpi | awk '{print \$1}'")"

  echo "Running Windows bootstrap gate against staging..." >&2

  set +e
  (
    cd "$PROJECT_ROOT"
    set +e
    WINDOWS_BOOTSTRAP_GATE_URL="$CANONICAL_STAGING_URL" \
    WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN="$RELEASE_GATE_EXPECTED_ORIGIN" \
    WINDOWS_BOOTSTRAP_GATE_PUBLIC_FIREFOX_XPI_PATH="/api/extensions/firefox/openpath.xpi" \
    WINDOWS_BOOTSTRAP_GATE_EXPECTED_EXTENSION_ID="$STAGING_FIREFOX_EXTENSION_ID" \
    WINDOWS_BOOTSTRAP_GATE_EXPECTED_VERSION="$STAGING_FIREFOX_RELEASE_VERSION" \
    WINDOWS_BOOTSTRAP_GATE_EXPECTED_METADATA_SHA256="$STAGING_FIREFOX_METADATA_SHA256" \
    WINDOWS_BOOTSTRAP_GATE_EXPECTED_XPI_SHA256="$STAGING_FIREFOX_XPI_SHA256" \
    WINDOWS_BOOTSTRAP_GATE_TIMEOUT="30000" \
    WINDOWS_BOOTSTRAP_GATE_RESOLVED_ADDRESS="$release_gate_resolved_address" \
      npm run test:windows-bootstrap-gate 2>&1 | tee /tmp/windows-bootstrap-gate-results.txt
    windows_bootstrap_exit_code=${PIPESTATUS[0]}
    exit "$windows_bootstrap_exit_code"
  )
  windows_bootstrap_exit_code=$?
  set -e

  if [ "$windows_bootstrap_exit_code" -eq 0 ]; then
    STAGING_WINDOWS_BOOTSTRAP_RESULT="success"
    STAGING_FIREFOX_POLICY_RESULT="success"
    echo "Windows bootstrap gate passed" >&2
    return 0
  fi

  echo "Windows bootstrap gate FAILED (exit code: $windows_bootstrap_exit_code)" >&2

  if [ "${STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE:-0}" = "1" ]; then
    echo "Release-candidate staging deploys must prove the live Windows bootstrap contract" >&2
    return 1
  fi

  echo "Continuing because STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE=${STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE:-0}" >&2
}

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
  run_smoke_checks "$staging_host" "$smoke_target_url" "${ssh_cmd[@]}"
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
  run_release_gate_checks "$canonical_staging_url" "$staging_use_release_candidate" "${ssh_cmd[@]}"
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
  run_smoke_checks "$staging_host" "$smoke_target_url" "${ssh_cmd[@]}"
  run_release_gate_checks "$canonical_staging_url" "$staging_use_release_candidate" "${ssh_cmd[@]}"
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
