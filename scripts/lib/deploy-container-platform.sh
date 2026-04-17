#!/usr/bin/env bash
# shellcheck shell=bash

normalize_deploy_container_platform() {
  local platform="${1:-linux/amd64}"

  case "$platform" in
    linux/amd64|linux/arm64)
      printf '%s\n' "$platform"
      ;;
    *)
      log_error "Unsupported container platform: $platform"
      log_error "Supported server container platforms are linux/amd64 and linux/arm64"
      return 1
      ;;
  esac
}

configure_deploy_container_platform() {
  local platform=""

  platform="$(normalize_deploy_container_platform "${1:-linux/amd64}")" || return 1
  export CLASSROOMPATH_CONTAINER_PLATFORM="$platform"
  export DOCKER_DEFAULT_PLATFORM="$platform"
  log_info "Container platform: $CLASSROOMPATH_CONTAINER_PLATFORM"
}

host_arch_matches_container_platform() {
  local platform="${1:-}"
  local host_arch=""

  host_arch="$(uname -m 2>/dev/null || true)"
  case "$platform:$host_arch" in
    linux/amd64:x86_64|linux/amd64:amd64)
      return 0
      ;;
    linux/arm64:aarch64|linux/arm64:arm64)
      return 0
      ;;
  esac

  return 1
}

verify_deploy_container_platform() {
  case "${CLASSROOMPATH_CONTAINER_PLATFORM:-linux/amd64}" in
    linux/amd64|linux/arm64)
      if host_arch_matches_container_platform "$CLASSROOMPATH_CONTAINER_PLATFORM"; then
        return 0
      fi

      log_error "This host cannot run $CLASSROOMPATH_CONTAINER_PLATFORM containers natively"
      log_error "Set the deploy target container platform to match the existing server architecture"
      return 1
      ;;
    *)
      normalize_deploy_container_platform "${CLASSROOMPATH_CONTAINER_PLATFORM:-}" >/dev/null
      ;;
  esac
}
