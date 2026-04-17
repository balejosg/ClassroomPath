#!/usr/bin/env bash
# shellcheck shell=bash

normalize_deploy_container_platform() {
  local platform="${1:-linux/amd64}"

  case "$platform" in
    linux/amd64)
      printf '%s\n' "$platform"
      ;;
    *)
      log_error "Unsupported container platform: $platform"
      log_error "ARM64 release images are discontinued for now; supported platform is linux/amd64"
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

host_supports_amd64_containers() {
  local host_arch=""

  host_arch="$(uname -m 2>/dev/null || true)"
  case "$host_arch" in
    x86_64|amd64)
      return 0
      ;;
  esac

  return 1
}

verify_deploy_container_platform() {
  case "${CLASSROOMPATH_CONTAINER_PLATFORM:-linux/amd64}" in
    linux/amd64)
      if host_supports_amd64_containers; then
        return 0
      fi

      log_error "This host cannot run linux/amd64 containers"
      log_error "ARM64 hosts are unsupported while ARM64 release images are discontinued; move the target to amd64 before deploying"
      return 1
      ;;
    *)
      normalize_deploy_container_platform "${CLASSROOMPATH_CONTAINER_PLATFORM:-}" >/dev/null
      ;;
  esac
}
