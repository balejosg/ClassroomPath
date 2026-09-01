#!/usr/bin/env bash
# common.sh - Versioned predecessor contract fixture
# shellcheck shell=bash

log_info() { printf '[INFO] %s\n' "$*"; }
log_success() { printf '[OK] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*"; }
log_error() { printf '[ERROR] %s\n' "$*" >&2; }

die() {
  log_error "$1"
  exit "${2:-1}"
}
