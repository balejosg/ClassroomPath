#!/usr/bin/env bash

STAGING_GATES_SCRIPT_DIR="${SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
STAGING_GATES_PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$STAGING_GATES_SCRIPT_DIR/.." && pwd)}"
STAGING_GATES_RESOLVE_HOST_SCRIPT_PATH="${RESOLVE_HOST_SCRIPT_PATH:-$STAGING_GATES_SCRIPT_DIR/resolve-ssh-host.sh}"

# shellcheck source=common.sh
source "$STAGING_GATES_SCRIPT_DIR/lib/common.sh"

reset_staging_verification_env() {
  SMOKE_TARGET_URL=""
  SMOKE_SKIP_CORS="0"
  STAGING_SMOKE_RESULT=""
  STAGING_SMOKE_STATUS=""
  RELEASE_GATE_TARGET_URL=""
  RELEASE_GATE_EXPECTED_ORIGIN=""
  RELEASE_GATE_RESOLVED_ADDRESS=""
  STAGING_RELEASE_GATE_RESULT=""
  STAGING_ENROLLMENT_DOWNLOAD_RESULT=""
  STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT=""
  STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT=""
  STAGING_VERIFIED_AT=""
  STAGING_EMAIL_PREFLIGHT_MODE=""
  STAGING_EMAIL_DELIVERY_HIGH_RISK=""
  STAGING_EMAIL_PREFLIGHT_RESULT=""
  STAGING_EMAIL_PREFLIGHT_PROVIDER=""
  STAGING_WINDOWS_FIREFOX_HIGH_RISK=""
  STAGING_FIREFOX_RELEASE_ARTIFACTS=""
  STAGING_WINDOWS_BOOTSTRAP_RESULT=""
  STAGING_FIREFOX_POLICY_RESULT=""
  STAGING_FIREFOX_EXTENSION_ID=""
  STAGING_FIREFOX_RELEASE_VERSION=""
  STAGING_FIREFOX_SIGNATURE_SOURCE=""
  STAGING_FIREFOX_SIGNATURE_STATE=""
  STAGING_FIREFOX_METADATA_SHA256=""
  STAGING_FIREFOX_XPI_SHA256=""
  STAGING_LINUX_BOOTSTRAP_RESULT=""
  STAGING_LINUX_BOOTSTRAP_RUN_ID=""
  STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID=""
  STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE=""
  STAGING_WINDOWS_SELF_UPDATE_RESULT="${STAGING_WINDOWS_SELF_UPDATE_RESULT:-}"
  STAGING_LINUX_SELF_UPDATE_RESULT="${STAGING_LINUX_SELF_UPDATE_RESULT:-}"
  STAGING_PREPROMOTION_REHEARSAL_RESULT="${STAGING_PREPROMOTION_REHEARSAL_RESULT:-}"
}

staging_gate_npm_script() {
  case "${1:-}" in
    smoke)
      printf 'test:smoke\n'
      ;;
    release-gate)
      printf 'test:release-gate\n'
      ;;
    windows-bootstrap-gate)
      printf 'test:windows-bootstrap-gate\n'
      ;;
    *)
      echo "Unknown staging gate npm script: ${1:-}" >&2
      return 1
      ;;
  esac
}

staging_gate_results_file() {
  case "${1:-}" in
    smoke)
      printf '/tmp/smoke-results.txt\n'
      ;;
    release-gate)
      printf '/tmp/release-gate-results.txt\n'
      ;;
    windows-bootstrap-gate)
      printf '/tmp/windows-bootstrap-gate-results.txt\n'
      ;;
    linux-bootstrap-gate)
      printf '/tmp/linux-bootstrap-gate.env\n'
      ;;
    enrollment-download-gate)
      printf '/tmp/staging-enrollment-download.env\n'
      ;;
    *)
      echo "Unknown staging gate results file: ${1:-}" >&2
      return 1
      ;;
  esac
}

staging_gate_state_fields() {
  case "${1:-}" in
    smoke)
      cat <<'EOF'
STAGING_SMOKE_RESULT
STAGING_SMOKE_STATUS
EOF
      ;;
    release-gate)
      cat <<'EOF'
STAGING_RELEASE_GATE_RESULT
STAGING_VERIFIED_AT
STAGING_WINDOWS_FIREFOX_HIGH_RISK
STAGING_FIREFOX_RELEASE_ARTIFACTS
STAGING_FIREFOX_EXTENSION_ID
STAGING_FIREFOX_RELEASE_VERSION
STAGING_FIREFOX_SIGNATURE_SOURCE
STAGING_FIREFOX_SIGNATURE_STATE
STAGING_FIREFOX_METADATA_SHA256
STAGING_FIREFOX_XPI_SHA256
EOF
      ;;
    windows-bootstrap-gate)
      cat <<'EOF'
STAGING_WINDOWS_BOOTSTRAP_RESULT
STAGING_FIREFOX_POLICY_RESULT
EOF
      ;;
    linux-bootstrap-gate)
      cat <<'EOF'
STAGING_LINUX_BOOTSTRAP_RESULT
STAGING_LINUX_BOOTSTRAP_RUN_ID
STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID
STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE
STAGING_WINDOWS_SELF_UPDATE_RESULT
STAGING_LINUX_SELF_UPDATE_RESULT
STAGING_PREPROMOTION_REHEARSAL_RESULT
EOF
      ;;
    enrollment-download-gate)
      cat <<'EOF'
STAGING_ENROLLMENT_DOWNLOAD_RESULT
STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT
STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT
EOF
      ;;
    *)
      echo "Unknown staging gate state fields: ${1:-}" >&2
      return 1
      ;;
  esac
}

staging_canary_boundary_value() {
  local value="${1:-}"

  if [ -z "$value" ]; then
    printf 'unknown\n'
    return 0
  fi

  printf '%s' "$value" \
    | tr '\r\n' '  ' \
    | sed -E \
      -e 's#https?://([^/[:space:]@]+):([^@[:space:]/]+)@#https://[redacted]@#gI' \
      -e 's#\b(Bearer[[:space:]]+)[A-Za-z0-9._~+/=-]+#\1[redacted]#gI' \
      -e 's#\b(token|secret|password|key)=([^[:space:]&|]+)#\1=[redacted]#gI' \
      -e 's#[[:space:]]+# #g'
  printf '\n'
}

print_staging_canary_failure_boundary() {
  local canary=""
  local result=""
  local boundary=""
  local message=""
  local run_id=""

  canary="$(staging_canary_boundary_value "${1:-}")"
  result="$(staging_canary_boundary_value "${2:-}")"
  boundary="$(staging_canary_boundary_value "${3:-}")"
  message="$(staging_canary_boundary_value "${4:-}")"
  run_id="$(staging_canary_boundary_value "${5:-}")"

  echo "Staging canary failure boundary:" >&2
  echo "  canary: $canary" >&2
  echo "  result: $result" >&2
  echo "  boundary: $boundary" >&2
  echo "  message: $message" >&2
  echo "  run: $run_id" >&2
}

staging_gate_target_is_private_lan() {
  local target_url="${1:-}"

  node - "$target_url" <<'NODE'
const value = process.argv[2] ?? '';
let host = '';

try {
  host = new URL(value).hostname.toLowerCase();
} catch {
  process.exit(1);
}

const privateHost =
  host === 'localhost' ||
  host.endsWith('.local') ||
  /^127\./.test(host) ||
  /^10\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
  host === '::1';

process.exit(privateHost ? 0 : 1);
NODE
}

run_staging_linux_bootstrap_gate() {
  local canonical_staging_url="$1"
  local output_file=""

  output_file="$(staging_gate_results_file linux-bootstrap-gate)"
  STAGING_LINUX_BOOTSTRAP_RESULT="skipped-low-risk"
  STAGING_LINUX_BOOTSTRAP_RUN_ID=""
  STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID="skipped-low-risk"
  STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE="Linux bootstrap gate skipped for low-risk staging deploy."

  if [ "${STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE:-0}" != "1" ]; then
    echo "Skipping Linux bootstrap gate because high-risk live browser evidence is not required" >&2
    return 0
  fi

  if staging_gate_target_is_private_lan "$canonical_staging_url"; then
    STAGING_LINUX_BOOTSTRAP_RESULT="skipped-lan-staging"
    STAGING_LINUX_BOOTSTRAP_RUN_ID=""
    STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID="skipped-lan-staging"
    STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE="Linux bootstrap GitHub-hosted gate skipped because LAN staging is not reachable from GitHub-hosted runners."
    echo "Skipping Linux bootstrap gate because LAN staging is not reachable from GitHub-hosted runners" >&2
    return 0
  fi

  echo "Running Linux bootstrap gate against staging..." >&2
  if ! CANONICAL_STAGING_URL="$canonical_staging_url" \
    STAGING_LINUX_BOOTSTRAP_GATE_OUTPUT="$output_file" \
    node "$STAGING_GATES_SCRIPT_DIR/run-staging-linux-bootstrap-gate.mjs"; then
    if [ -f "$output_file" ]; then
      # shellcheck disable=SC1090
      . "$output_file"
    fi
    print_staging_canary_failure_boundary \
      "linux-bootstrap" \
      "${STAGING_LINUX_BOOTSTRAP_RESULT:-failure}" \
      "${STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID:-unknown}" \
      "${STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE:-unknown}" \
      "${STAGING_LINUX_BOOTSTRAP_RUN_ID:-unknown}"
    echo "Linux bootstrap gate FAILED (${STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID:-unknown})" >&2
    return 1
  fi

  # shellcheck disable=SC1090
  . "$output_file"
  echo "Linux bootstrap gate passed" >&2
}

run_staging_enrollment_download_gate() {
  local output_file=""

  output_file="$(staging_gate_results_file enrollment-download-gate)"
  STAGING_ENROLLMENT_DOWNLOAD_RESULT="${STAGING_ENROLLMENT_DOWNLOAD_RESULT:-failed}"
  STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT="${STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT:-failed}"
  STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT="${STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT:-failed}"

  if [ -f "$output_file" ]; then
    # shellcheck disable=SC1090
    . "$output_file"
  fi

  if [ "${STAGING_ENROLLMENT_DOWNLOAD_RESULT:-}" = "success" ] &&
    [ "${STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT:-}" = "success" ] &&
    [ "${STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT:-}" = "success" ]; then
    echo "Enrollment download gate passed" >&2
    return 0
  fi

  print_staging_canary_failure_boundary \
    "enrollment-download" \
    "${STAGING_ENROLLMENT_DOWNLOAD_RESULT:-failed}" \
    "enrollment-script-download" \
    "Linux=${STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT:-unset}; Windows=${STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT:-unset}" \
    "${GITHUB_RUN_ID:-unknown}"
  echo "Enrollment download gate FAILED" >&2
  return 1
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

  resolver_output="$(bash "$STAGING_GATES_RESOLVE_HOST_SCRIPT_PATH" "$target_host" "$target_port" 1 2>/dev/null || true)"
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

run_gate_command() {
  local gate_name="$1"
  shift
  local gate_exit_code=0
  local npm_script=""
  local results_file=""

  npm_script="$(staging_gate_npm_script "$gate_name")"
  results_file="$(staging_gate_results_file "$gate_name")"

  set +e
  (
    cd "$STAGING_GATES_PROJECT_ROOT"
    set +e
    if [ "$gate_name" = "smoke" ] && [ -n "${CLASSROOMPATH_VERIFIER_IMAGE:-}" ]; then
      env "$@" CLASSROOMPATH_VERIFIER_IMAGE="$CLASSROOMPATH_VERIFIER_IMAGE" \
        bash scripts/run-smoke-in-verifier.sh 2>&1 | tee "$results_file"
    else
      env "$@" npm run "$npm_script" 2>&1 | tee "$results_file"
    fi
    gate_exit_code=${PIPESTATUS[0]}
    exit "$gate_exit_code"
  )
  gate_exit_code=$?
  set -e

  return "$gate_exit_code"
}

print_staging_public_ingress_diagnostics() {
  local target_host="$1"
  local target_url="$2"
  local public_ip=""

  echo "Public ingress diagnostics:" >&2
  echo "  target_url=$target_url" >&2
  echo "  target_host=$target_host" >&2

  if command -v getent >/dev/null 2>&1; then
    {
      printf '  getent ahostsv4: '
      getent ahostsv4 "$target_host" 2>/dev/null | awk '{print $1}' | sort -u | paste -sd ',' -
    } >&2 || true
  fi

  if command -v dig >/dev/null 2>&1; then
    {
      printf '  dig default: '
      dig +short "$target_host" A 2>/dev/null | sort -u | paste -sd ',' -
      printf '  dig @1.1.1.1: '
      dig @1.1.1.1 +short "$target_host" A 2>/dev/null | sort -u | paste -sd ',' -
      printf '  dig @8.8.8.8: '
      dig @8.8.8.8 +short "$target_host" A 2>/dev/null | sort -u | paste -sd ',' -
    } >&2 || true
  fi

  if command -v curl >/dev/null 2>&1; then
    public_ip="$(curl --max-time 5 -fsS https://api.ipify.org 2>/dev/null || true)"
    if [ -n "$public_ip" ]; then
      echo "  local egress public IP: $public_ip" >&2
    fi

    echo "  curl public endpoint:" >&2
    curl --max-time 10 -Ik "$target_url" >&2 || true
  fi
}

run_staging_smoke_gate() {
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

  if run_gate_command smoke \
    "SMOKE_TEST_URL=$SMOKE_TARGET_URL" \
    "SMOKE_TEST_TIMEOUT=15000" \
    "SMOKE_SKIP_CORS=$SMOKE_SKIP_CORS" \
    "SMOKE_ALLOW_MUTATIONS=1" \
    "SMOKE_TEST_RESOLVED_ADDRESS=$smoke_test_resolved_address"; then
    smoke_exit_code=0
  else
    smoke_exit_code=$?
  fi

  if [ "$smoke_exit_code" -ne 0 ]; then
    echo "Smoke tests FAILED (exit code: $smoke_exit_code)" >&2
    echo "Review output above for details" >&2
    print_staging_public_ingress_diagnostics "$smoke_target_host" "$SMOKE_TARGET_URL"
    echo >&2
    echo "Common issues:" >&2
    echo "  - NPM reverse proxy not routing correctly" >&2
    echo "  - CORS_ORIGINS missing staging public origin" >&2
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

run_staging_release_gate() {
  local canonical_staging_url="$1"
  local staging_use_release_candidate="$2"
  shift 2
  local release_gate_target_host=""
  local release_gate_resolved_address=""
  local release_gate_request_origin=""
  local release_gate_exit_code=0
  local -a ssh_cmd=("$@")

  RELEASE_GATE_TARGET_URL="$canonical_staging_url"
  RELEASE_GATE_EXPECTED_ORIGIN="$(node -e 'console.log(new URL(process.argv[1]).origin)' "$canonical_staging_url")"
  STAGING_RELEASE_GATE_RESULT="failed"
  STAGING_WINDOWS_BOOTSTRAP_RESULT="failed"
  STAGING_FIREFOX_POLICY_RESULT="failed"

  if [ "$staging_use_release_candidate" != "1" ]; then
    echo "Staging runtime cannot produce promotion evidence when IMAGE_SOURCE=source-build" >&2
    return 1
  fi

  release_gate_target_host=$(printf '%s\n' "$canonical_staging_url" | sed -E 's#^[A-Za-z]+://([^/:]+).*#\1#')
  release_gate_resolved_address="$(resolve_target_address "$release_gate_target_host" 443)"

  if [ -n "$release_gate_resolved_address" ]; then
    echo "Release gate host resolved explicitly: $release_gate_target_host -> $release_gate_resolved_address" >&2
  fi

  release_gate_request_origin="$RELEASE_GATE_EXPECTED_ORIGIN"

  echo "Release gate target URL: $canonical_staging_url" >&2
  echo "Release gate expected origin: $RELEASE_GATE_EXPECTED_ORIGIN" >&2

  if run_gate_command release-gate \
    "RELEASE_GATE_URL=$canonical_staging_url" \
    "RELEASE_GATE_EXPECTED_ORIGIN=$RELEASE_GATE_EXPECTED_ORIGIN" \
    "RELEASE_GATE_REQUEST_ORIGIN=$release_gate_request_origin" \
    "RELEASE_GATE_TIMEOUT=30000" \
    "RELEASE_GATE_ALLOW_MUTATIONS=1" \
    "RELEASE_GATE_RESOLVED_ADDRESS=$release_gate_resolved_address"; then
    release_gate_exit_code=0
  else
    release_gate_exit_code=$?
  fi

  if [ "$release_gate_exit_code" -ne 0 ]; then
    echo "Release gate FAILED (exit code: $release_gate_exit_code)" >&2
    echo "Staging was deployed, but promotion evidence was not recorded" >&2
    return 1
  fi

  STAGING_RELEASE_GATE_RESULT="success"
  STAGING_VERIFIED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  STAGING_WINDOWS_FIREFOX_HIGH_RISK="${STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE:-0}"
  if [ "$STAGING_WINDOWS_FIREFOX_HIGH_RISK" = "1" ]; then
    STAGING_WINDOWS_FIREFOX_HIGH_RISK="true"
  elif [ "$STAGING_WINDOWS_FIREFOX_HIGH_RISK" = "0" ]; then
    STAGING_WINDOWS_FIREFOX_HIGH_RISK="false"
  fi
  echo "Release gate passed" >&2

  echo "Verifying Firefox release artifacts inside classroompath-api..." >&2
  "${ssh_cmd[@]}" \
    "docker exec classroompath-api test -f /openpath-firefox-release/metadata.json && docker exec classroompath-api test -f /openpath-firefox-release/openpath-firefox-extension.xpi"

  echo "Verifying shared browser policy spec inside classroompath-api..." >&2
  "${ssh_cmd[@]}" "docker exec classroompath-api test -f /app/runtime/browser-policy-spec.json"

  STAGING_FIREFOX_RELEASE_ARTIFACTS="present"
  local staging_firefox_metadata_json=""
  staging_firefox_metadata_json="$("${ssh_cmd[@]}" "docker exec classroompath-api cat /openpath-firefox-release/metadata.json")"
  STAGING_FIREFOX_EXTENSION_ID="$(printf '%s' "$staging_firefox_metadata_json" | node "$STAGING_GATES_SCRIPT_DIR/read-firefox-release-metadata.mjs" --field extensionId)"
  STAGING_FIREFOX_RELEASE_VERSION="$(printf '%s' "$staging_firefox_metadata_json" | node "$STAGING_GATES_SCRIPT_DIR/read-firefox-release-metadata.mjs" --field version)"
  STAGING_FIREFOX_SIGNATURE_SOURCE="$(printf '%s' "$staging_firefox_metadata_json" | node "$STAGING_GATES_SCRIPT_DIR/read-firefox-release-metadata.mjs" --field signatureSource)"
  STAGING_FIREFOX_SIGNATURE_STATE="$(printf '%s' "$staging_firefox_metadata_json" | node "$STAGING_GATES_SCRIPT_DIR/read-firefox-release-metadata.mjs" --field signatureState)"
  STAGING_FIREFOX_METADATA_SHA256="$("${ssh_cmd[@]}" "docker exec classroompath-api sha256sum /openpath-firefox-release/metadata.json | awk '{print \$1}'")"
  STAGING_FIREFOX_XPI_SHA256="$("${ssh_cmd[@]}" "docker exec classroompath-api sha256sum /openpath-firefox-release/openpath-firefox-extension.xpi | awk '{print \$1}'")"

  RELEASE_GATE_RESOLVED_ADDRESS="$release_gate_resolved_address"
}

run_staging_windows_bootstrap_gate() {
  local canonical_staging_url="$1"
  shift
  local -a ssh_cmd=("$@")
  local windows_bootstrap_exit_code=0
  local windows_bootstrap_webhook_secret=""
  local enrollment_download_output_file=""

  windows_bootstrap_webhook_secret="$("${ssh_cmd[@]}" "docker exec classroompath-api printenv STRIPE_WEBHOOK_SECRET" | tr -d '\r\n')"
  if [ -z "$windows_bootstrap_webhook_secret" ]; then
    echo "Windows bootstrap gate requires STRIPE_WEBHOOK_SECRET in classroompath-api" >&2
    return 1
  fi

  enrollment_download_output_file="$(staging_gate_results_file enrollment-download-gate)"
  rm -f "$enrollment_download_output_file"

  echo "Running Windows bootstrap gate against staging..." >&2

  if run_gate_command windows-bootstrap-gate \
    "WINDOWS_BOOTSTRAP_GATE_URL=$canonical_staging_url" \
    "WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN=$RELEASE_GATE_EXPECTED_ORIGIN" \
    "WINDOWS_BOOTSTRAP_GATE_PUBLIC_FIREFOX_XPI_PATH=/api/extensions/firefox/openpath.xpi" \
    "WINDOWS_BOOTSTRAP_GATE_EXPECTED_EXTENSION_ID=$STAGING_FIREFOX_EXTENSION_ID" \
    "WINDOWS_BOOTSTRAP_GATE_EXPECTED_VERSION=$STAGING_FIREFOX_RELEASE_VERSION" \
    "WINDOWS_BOOTSTRAP_GATE_EXPECTED_METADATA_SHA256=$STAGING_FIREFOX_METADATA_SHA256" \
    "WINDOWS_BOOTSTRAP_GATE_EXPECTED_XPI_SHA256=$STAGING_FIREFOX_XPI_SHA256" \
    "WINDOWS_BOOTSTRAP_GATE_EXPECTED_LINUX_AGENT_VERSION=${OPENPATH_LINUX_AGENT_VERSION:-}" \
    "WINDOWS_BOOTSTRAP_GATE_ENROLLMENT_DOWNLOAD_OUTPUT=$enrollment_download_output_file" \
    "WINDOWS_BOOTSTRAP_GATE_ENROLLMENT_DOWNLOAD_EVIDENCE_OUTPUT=/tmp/staging-enrollment-download.json" \
    "WINDOWS_BOOTSTRAP_GATE_STRIPE_WEBHOOK_SECRET=$windows_bootstrap_webhook_secret" \
    "WINDOWS_BOOTSTRAP_GATE_TIMEOUT=30000" \
    "WINDOWS_BOOTSTRAP_GATE_RESOLVED_ADDRESS=${RELEASE_GATE_RESOLVED_ADDRESS:-}"; then
    windows_bootstrap_exit_code=0
  else
    windows_bootstrap_exit_code=$?
  fi

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
