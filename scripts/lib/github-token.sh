#!/usr/bin/env bash
# Shared GitHub token resolution for local operator scripts.
# shellcheck shell=bash

ensure_github_token_env() {
  if [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then
    return 0
  fi

  if ! command -v gh >/dev/null 2>&1; then
    die "GITHUB_TOKEN or GH_TOKEN must be set, or gh must be installed and authenticated" 1
  fi

  local token=""
  token="$(gh auth token 2>/dev/null || true)"
  if [ -z "$token" ]; then
    die "GITHUB_TOKEN or GH_TOKEN must be set, or gh auth token must return a token" 1
  fi

  export GH_TOKEN="$token"
}
