#!/usr/bin/env bash
# common.sh - Shared helpers for ClassroomPath scripts
# shellcheck shell=bash

if [ -t 1 ]; then
  _CP_RED='\033[0;31m'
  _CP_GREEN='\033[0;32m'
  _CP_YELLOW='\033[1;33m'
  _CP_BLUE='\033[0;34m'
  _CP_NC='\033[0m'
else
  _CP_RED=''
  _CP_GREEN=''
  _CP_YELLOW=''
  _CP_BLUE=''
  _CP_NC=''
fi

log_info() { printf '%b[INFO]%b %s\n' "$_CP_BLUE" "$_CP_NC" "$*"; }
log_success() { printf '%b[OK]%b %s\n' "$_CP_GREEN" "$_CP_NC" "$*"; }
log_warn() { printf '%b[WARN]%b %s\n' "$_CP_YELLOW" "$_CP_NC" "$*"; }
log_error() { printf '%b[ERROR]%b %s\n' "$_CP_RED" "$_CP_NC" "$*"; }

die() {
  log_error "$1"
  exit "${2:-1}"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    die "Missing required command: $cmd"
  fi
}

resolve_node_bin() {
  local candidate=""

  for candidate in \
    "${NODE_BIN:-}" \
    "$(command -v node 2>/dev/null || true)" \
    /usr/bin/node \
    /usr/local/bin/node; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  die "Missing required command: node"
}

configure_node_path() {
  local node_bin=""
  local node_dir=""

  node_bin="$(resolve_node_bin)"
  node_dir="$(dirname "$node_bin")"
  export NODE_BIN="$node_bin"

  case ":$PATH:" in
    *":$node_dir:"*) ;;
    *) export PATH="$node_dir:$PATH" ;;
  esac
}

load_env_file() {
  local path="$1"
  if [ -f "$path" ]; then
    log_info "Loading $path"
    set -a
    # shellcheck disable=SC1090
    source "$path"
    set +a
    return 0
  fi
  return 1
}

upsert_env_file_var() {
  local path="$1"
  local key="$2"
  local value="$3"
  local tmp_file=""

  mkdir -p "$(dirname "$path")"
  touch "$path"
  tmp_file="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    BEGIN { updated = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print key "=" value
      }
    }
  ' "$path" > "$tmp_file"

  mv "$tmp_file" "$path"
}

remove_env_file_var() {
  local path="$1"
  local key="$2"
  local tmp_file=""

  if [ ! -f "$path" ]; then
    return 0
  fi

  tmp_file="$(mktemp)"
  awk -v key="$key" 'index($0, key "=") != 1 { print }' "$path" > "$tmp_file"
  mv "$tmp_file" "$path"
}

remote_assignment() {
  local key="$1"
  local value="$2"
  printf '%s=%q ' "$key" "$value"
}

is_tty_stdin() {
  [ -t 0 ]
}

confirm_with_timeout() {
  local prompt="$1"
  local timeout="${2:-10}"
  local assume_yes="${DEPLOY_ASSUME_YES:-0}"

  if [ "$assume_yes" = "1" ]; then
    return 0
  fi

  if ! is_tty_stdin; then
    return 1
  fi

  local reply=""
  read -r -t "$timeout" -p "$prompt [y/N] " reply || reply="n"
  printf '\n'

  case "$reply" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

expand_tilde() {
  local path="$1"
  if [[ "$path" == "~"* ]]; then
    printf '%s\n' "${path/#\~/$HOME}"
  else
    printf '%s\n' "$path"
  fi
}
