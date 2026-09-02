#!/usr/bin/env bash
# production-host-contract.sh - Minimal, Node-free production host contract
# shellcheck shell=bash

PRODUCTION_HOST_CONTRACT_HELPER_CONTRACT_VERSION=1
PRODUCTION_HOST_DISK_THRESHOLD_PERCENT="${PRODUCTION_HOST_DISK_THRESHOLD_PERCENT:-80}"
PRODUCTION_HOST_NETWORK_URL="${PRODUCTION_HOST_NETWORK_URL:-https://ghcr.io/v2/}"

# Keep this list deliberately boring and complete for the streamed forward and
# recovery paths. Node/npm are intentionally reported as optional observations
# and are never invoked by this helper. Commands executed inside Docker are not
# host requirements and therefore do not belong here.
PRODUCTION_HOST_REQUIRED_COMMANDS=(
  bash
  git
  docker
  curl
  awk
  sed
  grep
  install
  mktemp
  mv
  cp
  chmod
  df
  id
  tr
  base64
  cat
  cmp
  date
  dirname
  env
  head
  ln
  mkdir
  rm
  sh
  sleep
  tail
  timeout
  touch
  tar
  sha256sum
  stat
  uname
)

production_host_contract_log_error() {
  if declare -f log_error >/dev/null 2>&1; then
    log_error "$*"
  else
    printf '[ERROR] %s\n' "$*" >&2
  fi
}

production_host_contract_log_info() {
  if declare -f log_info >/dev/null 2>&1; then
    log_info "$*"
  else
    printf '[INFO] %s\n' "$*"
  fi
}

production_host_contract_command_available() {
  command -v "$1" >/dev/null 2>&1
}

production_host_contract_disk_usage_percent() {
  local target_path="${1:-${CLASSROOMPATH_DEPLOY_ROOT:-/}}"

  df -P "$target_path" 2>/dev/null | awk 'NR == 2 { gsub(/%/, "", $5); print $5; exit }'
}

production_host_contract_network_reachable() {
  if [ -n "${PRODUCTION_HOST_NETWORK_CHECK_COMMAND:-}" ]; then
    bash -c "$PRODUCTION_HOST_NETWORK_CHECK_COMMAND"
    return $?
  fi

  [ -n "$PRODUCTION_HOST_NETWORK_URL" ] || return 1

  # A registry root commonly returns 401 before authentication. That still
  # proves the network/TLS route exists; registry authentication is checked by
  # the later docker login operation. Fail only when curl cannot obtain an HTTP
  # response at all.
  local http_status=""
  http_status="$(curl -sS --max-time "${PRODUCTION_HOST_NETWORK_TIMEOUT_SECONDS:-10}" \
    -o /dev/null -w '%{http_code}' "$PRODUCTION_HOST_NETWORK_URL")" || return 1
  [[ "$http_status" =~ ^[1-5][0-9][0-9]$ ]]
}

production_host_contract_json_escape() {
  printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g; s/	/\\t/g; s/\r/\\r/g; s/\n/\\n/g'
}

production_host_contract_write_report() {
  local report_path="$1"
  local status="$2"
  local errors_csv="${3:-}"
  local state_root="${4:-${CLASSROOMPATH_DEPLOY_ROOT:-}/release-state}"
  local tmp_file=""
  local node_status="absent"
  local npm_status="absent"
  local disk_usage=""

  [ -n "$report_path" ] || return 0
  tmp_file="$(mktemp "${report_path}.tmp.XXXXXX")" || return 1
  if production_host_contract_command_available node; then node_status="present"; fi
  if production_host_contract_command_available npm; then npm_status="present"; fi
  disk_usage="$(production_host_contract_disk_usage_percent "${CLASSROOMPATH_DEPLOY_ROOT:-/}" || true)"

  {
    printf '{\n'
    printf '  "contractVersion":%s,\n' "$PRODUCTION_HOST_CONTRACT_HELPER_CONTRACT_VERSION"
    printf '  "ok":%s,\n' "$status"
    printf '  "mutationAllowed":%s,\n' "$status"
    printf '  "nodeRequired":false,\n'
    printf '  "npmRequired":false,\n'
    printf '  "nodeObserved":"%s",\n' "$node_status"
    printf '  "npmObserved":"%s",\n' "$npm_status"
    printf '  "deployRoot":"%s",\n' "$(production_host_contract_json_escape "${CLASSROOMPATH_DEPLOY_ROOT:-}")"
    printf '  "stateRoot":"%s",\n' "$(production_host_contract_json_escape "$state_root")"
    printf '  "diskUsagePercent":"%s",\n' "$(production_host_contract_json_escape "$disk_usage")"
    printf '  "errors":[%s]\n' "$errors_csv"
    printf '}\n'
  } > "$tmp_file"
  install -m 600 "$tmp_file" "$report_path"
  rm -f "$tmp_file"
}

production_host_contract_validate() {
  local deploy_root="${1:-${CLASSROOMPATH_DEPLOY_ROOT:-}}"
  local disk_threshold="${2:-$PRODUCTION_HOST_DISK_THRESHOLD_PERCENT}"
  local report_path="${3:-${PRODUCTION_HOST_CONTRACT_REPORT_FILE:-}}"
  local command_name=""
  local errors=()
  local disk_usage=""
  local state_root=""

  for command_name in "${PRODUCTION_HOST_REQUIRED_COMMANDS[@]}"; do
    if ! production_host_contract_command_available "$command_name"; then
      errors+=("missing-command:$command_name")
    fi
  done

  if ! production_host_contract_command_available docker || ! docker info >/dev/null 2>&1; then
    errors+=("docker-daemon-unreachable")
  fi
  if ! production_host_contract_command_available docker || ! docker compose version >/dev/null 2>&1; then
    errors+=("docker-compose-unavailable")
  fi

  if [ -z "$deploy_root" ] || [ ! -d "$deploy_root" ]; then
    errors+=("deploy-root-missing")
  elif [ ! -r "$deploy_root" ] || [ ! -w "$deploy_root" ]; then
    errors+=("deploy-root-not-writable")
  fi

  state_root="${deploy_root%/}/release-state"
  if [ -d "$state_root" ] && { [ ! -r "$state_root" ] || [ ! -w "$state_root" ]; }; then
    errors+=("release-state-root-not-usable")
  fi

  disk_usage="$(production_host_contract_disk_usage_percent "${deploy_root:-/}" || true)"
  if ! [[ "$disk_usage" =~ ^[0-9]+$ ]] || [ "$disk_usage" -gt "$disk_threshold" ]; then
    errors+=("disk-threshold-exceeded")
  fi

  if ! production_host_contract_network_reachable; then
    errors+=("required-network-unreachable")
  fi

  local ok=true
  local error_json=""
  if [ "${#errors[@]}" -gt 0 ]; then
    ok=false
    for command_name in "${errors[@]}"; do
      if [ -n "$error_json" ]; then error_json+=','; fi
      error_json+="\"$(production_host_contract_json_escape "$command_name")\""
    done
  fi

  production_host_contract_write_report "$report_path" "$ok" "$error_json" "$state_root" || return 1
  if [ "$ok" != true ]; then
    production_host_contract_log_error "Production host contract failed: ${errors[*]}"
    return 1
  fi

  production_host_contract_log_info "Production host contract passed; Node/npm are not required"
  return 0
}
