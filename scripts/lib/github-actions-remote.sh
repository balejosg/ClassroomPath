#!/usr/bin/env bash
# github-actions-remote.sh - Shared remote host/bootstrap helpers for GitHub Actions
# shellcheck shell=bash
# shellcheck disable=SC2034

GITHUB_ACTIONS_REMOTE_HELPER_CONTRACT_VERSION=1
GITHUB_ACTIONS_REMOTE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GITHUB_ACTIONS_RESOLVE_HOST_SCRIPT_PATH="$GITHUB_ACTIONS_REMOTE_SCRIPT_DIR/resolve-ssh-host.sh"

github_actions_remote_require_values() {
  local context="$1"
  shift

  local missing=()
  local variable_name=""
  local variable_value=""

  while [ "$#" -gt 0 ]; do
    variable_name="$1"
    variable_value="${2:-}"
    shift 2 || true

    if [ -z "$variable_value" ]; then
      missing+=("$variable_name")
    fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    printf '::error::%s must be configured for %s\n' "$(IFS=', '; printf '%s' "${missing[*]}")" "$context" >&2
    return 1
  fi
}

github_actions_resolve_ssh_host() {
  local host="$1"
  local port="${2:-22}"

  bash "$GITHUB_ACTIONS_RESOLVE_HOST_SCRIPT_PATH" "$host" "$port"
}

github_actions_remote_write_resolved_host_outputs() {
  local host="$1"
  local port="${2:-22}"
  local user="${3:-}"
  local context="${4:-remote access}"

  github_actions_remote_require_values "$context" DEPLOY_HOST "$host" || return 1
  github_actions_resolve_ssh_host "$host" "$port"
  if [ -n "$user" ]; then
    printf 'user=%s\n' "$user"
  fi
}

github_actions_remote_install_ssh_key() {
  local ssh_key="$1"
  local key_path="$2"

  mkdir -p "$(dirname "$key_path")"
  printf '%s\n' "$ssh_key" > "$key_path"
  chmod 600 "$key_path"
}

github_actions_remote_ssh() {
  local key_path="$1"
  local port="$2"
  local user="$3"
  local ip="$4"
  shift 4

  ssh \
    -o ConnectTimeout=10 \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=accept-new \
    -i "$key_path" \
    -p "$port" \
    "$user@$ip" \
    "$@"
}

github_actions_remote_read_env_key() {
  local key_path="$1"
  local port="$2"
  local user="$3"
  local ip="$4"
  local env_key="$5"
  local env_file="${6:-/opt/classroompath/app/config/.env}"

  github_actions_remote_ssh \
    "$key_path" \
    "$port" \
    "$user" \
    "$ip" \
    "grep '^${env_key}=' '$env_file' | sed 's/^${env_key}=//' | head -n1"
}

github_actions_remote_read_file() {
  local key_path="$1"
  local port="$2"
  local user="$3"
  local ip="$4"
  local file_path="$5"

  github_actions_remote_ssh "$key_path" "$port" "$user" "$ip" "cat '$file_path'"
}

github_actions_remote_file_size() {
  local key_path="$1"
  local port="$2"
  local user="$3"
  local ip="$4"
  local file_path="$5"

  github_actions_remote_ssh \
    "$key_path" \
    "$port" \
    "$user" \
    "$ip" \
    "test -f '$file_path' && wc -c < '$file_path' | tr -d ' '"
}

github_actions_remote_sha256_file() {
  local key_path="$1"
  local port="$2"
  local user="$3"
  local ip="$4"
  local file_path="$5"

  github_actions_remote_ssh \
    "$key_path" \
    "$port" \
    "$user" \
    "$ip" \
    "test -f '$file_path' && if command -v sha256sum >/dev/null 2>&1; then sha256sum '$file_path' | awk '{print \$1}'; else shasum -a 256 '$file_path' | awk '{print \$1}'; fi"
}
