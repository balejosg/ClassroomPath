#!/usr/bin/env bash
set -euo pipefail

write_github_output() {
  local key="$1"
  local value="$2"

  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$key" "$value" >> "$GITHUB_OUTPUT"
  fi
}

write_install_failure_artifact() {
  local message="$1"

  FAILURE_MESSAGE="$message" node -e 'const fs = require("node:fs"); const message = process.env.FAILURE_MESSAGE; fs.writeFileSync("production-linux-ajax-auto-allow-canary.json", JSON.stringify({ success: false, boundarySource: "infrastructure", error: message, failureBoundary: { id: "linux-install-openpath", message }, diagnosticPhases: [{ id: "linux-install-openpath", status: "failed", message, evidence: { artifactWritten: true } }], artifactWritten: true }, null, 2));'
}

pin_linux_bootstrap_canary_api_host() {
  local api_url="${LINUX_AJAX_AUTO_ALLOW_CANARY_API_URL:-}"
  if [ -z "$api_url" ]; then
    return 0
  fi

  local api_host
  api_host="$(API_URL="$api_url" node -e 'const value = process.env.API_URL; try { process.stdout.write(new URL(value).hostname); } catch { process.exit(0); }')"
  if [ -z "$api_host" ]; then
    return 0
  fi

  local api_ip
  api_ip="$(getent ahostsv4 "$api_host" | awk '{print $1; exit}')"
  if [ -z "$api_ip" ]; then
    echo "Could not pre-resolve $api_host before Linux bootstrap; continuing without /etc/hosts pin"
    return 0
  fi

  echo "Pinning $api_host to $api_ip for Linux bootstrap registration"
  printf '%s %s\n' "$api_ip" "$api_host" | sudo tee -a /etc/hosts >/dev/null
}

restore_linux_bootstrap_canary_external_dns() {
  set +e
  echo "Restoring Linux runner DNS/connectivity after OpenPath canary runtime"

  if [ -n "${original_unprivileged_port_start:-}" ]; then
    sudo sysctl -w "net.ipv4.ip_unprivileged_port_start=$original_unprivileged_port_start" || true
  fi

  timeout --kill-after=5s 20s sudo systemctl stop openpath-sse-listener.service openpath-update.timer openpath-update.service dnsmasq || true
  timeout --kill-after=5s 20s sudo systemctl reset-failed dnsmasq || true

  if [ -x /usr/local/lib/openpath/uninstall.sh ]; then
    timeout --kill-after=5s 30s sudo /usr/local/lib/openpath/uninstall.sh --auto-yes || true
  elif command -v openpath >/dev/null 2>&1; then
    timeout --kill-after=5s 30s sudo openpath disable || true
  fi

  export DEBIAN_FRONTEND=noninteractive
  timeout --kill-after=5s 30s sudo apt-get purge -y openpath-dnsmasq || true

  sudo rm -f \
    /etc/systemd/system/dnsmasq.service.d/openpath-override.conf \
    /etc/systemd/system/dnsmasq.service.d/whitelist-override.conf \
    /etc/dnsmasq.d/openpath.conf \
    /etc/tmpfiles.d/openpath-dnsmasq.conf || true
  sudo rmdir /etc/systemd/system/dnsmasq.service.d 2>/dev/null || true
  sudo systemctl daemon-reload || true
  sudo systemctl reset-failed dnsmasq || true

  if command -v resolvectl >/dev/null 2>&1 && systemctl is-active --quiet systemd-resolved; then
    default_interface="$(ip route show default 2>/dev/null | awk '{print $5; exit}')"
    if [ -n "$default_interface" ]; then
      sudo resolvectl dns "$default_interface" 1.1.1.1 8.8.8.8 || true
    fi
    sudo resolvectl flush-caches || true
  else
    printf '%s\n' 'nameserver 1.1.1.1' 'nameserver 8.8.8.8' | sudo tee /etc/resolv.conf >/dev/null || true
  fi

  getent hosts raw.githubusercontent.com || getent hosts github.com || true
}

main() {
  trap restore_linux_bootstrap_canary_external_dns EXIT

  local artifact_dir="${LINUX_BOOTSTRAP_CANARY_ARTIFACT_DIR:-$PWD}"
  mkdir -p "$artifact_dir"
  cd "$artifact_dir"

  original_unprivileged_port_start="$(sysctl -n net.ipv4.ip_unprivileged_port_start 2>/dev/null || true)"
  sudo sysctl -w net.ipv4.ip_unprivileged_port_start=0
  pin_linux_bootstrap_canary_api_host

  local installer_path="${LINUX_BOOTSTRAP_CANARY_INSTALLER_PATH:-${RUNNER_TEMP:-}/linux-production-bootstrap-canary/install-openpath.sh}"
  : > linux-install-openpath.log
  : > linux-ajax-auto-allow-canary.log

  if [ ! -x "$installer_path" ]; then
    local message='Linux enrollment script was not downloaded before the AJAX canary.'
    write_github_output canary_result failure
    write_github_output failure_boundary_id linux-install-openpath
    write_github_output failure_boundary_message "$message"
    write_install_failure_artifact "$message"
    exit 1
  fi

  set +e
  sudo env OPENPATH_ALLOW_DEFERRED_FIREFOX_REGISTRATION=1 bash "$installer_path" 2>&1 | tee linux-install-openpath.log
  local install_status="${PIPESTATUS[0]}"
  set -e

  if [ "$install_status" -ne 0 ]; then
    local message='Linux enrollment script failed before the AJAX auto-allow canary could run.'
    write_github_output canary_result failure
    write_github_output failure_boundary_id linux-install-openpath
    write_github_output failure_boundary_message "$message"
    write_install_failure_artifact "$message"
    exit "$install_status"
  fi

  set +e
  LINUX_AJAX_AUTO_ALLOW_CANARY_PORT=80 timeout --kill-after=30s 10m node scripts/linux-ajax-auto-allow-canary.mjs 2>&1 | tee linux-ajax-auto-allow-canary.log
  local ajax_status="${PIPESTATUS[0]}"
  set -e

  if [ "$ajax_status" -eq 0 ]; then
    write_github_output canary_result success
  fi

  exit "$ajax_status"
}

main "$@"
