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
