#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

ENV_FILE="${1:-$SCRIPT_DIR/../config/.env}"
RUNTIME_ENV_POLICY_SCRIPT="$SCRIPT_DIR/lib/runtime-environment-policy.mjs"
CP_BILLING_MODE="${CP_BILLING_MODE:-manual_only}"

runtime_policy_names() {
  node "$RUNTIME_ENV_POLICY_SCRIPT" "$1"
}

readarray -t stripe_vars < <(runtime_policy_names stripe-required-env-names)
readarray -t required_vars < <(runtime_policy_names billing-required-env-names)
readarray -t optional_billing_vars < <(runtime_policy_names optional-billing-env-names)
readarray -t push_vars < <(runtime_policy_names push-env-names)

upsert_env_var() {
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

remove_env_var() {
  local path="$1"
  local key="$2"
  local tmp_file=""

  touch "$path"
  tmp_file="$(mktemp)"

  awk -v key="$key" 'index($0, key "=") != 1 { print }' "$path" > "$tmp_file"
  mv "$tmp_file" "$path"
}

for name in "${required_vars[@]}"; do
  if [ -z "${!name:-}" ]; then
    log_error "$name must be set"
    exit 1
  fi
done

for name in "${required_vars[@]}"; do
  upsert_env_var "$ENV_FILE" "$name" "${!name}"
done

for name in "${optional_billing_vars[@]}"; do
  if [ -n "${!name:-}" ]; then
    upsert_env_var "$ENV_FILE" "$name" "${!name}"
  fi
done

push_required="${CP_REQUIRE_PUSH_NOTIFICATIONS:-}"
push_configured="0"
for name in "${push_vars[@]}"; do
  if [ -n "${!name:-}" ]; then
    push_configured="1"
  fi
done

if [ "$push_required" = "1" ] || [ "$push_configured" = "1" ]; then
  for name in "${push_vars[@]}"; do
    if [ -z "${!name:-}" ]; then
      log_error "$name must be set when push notifications are required or partially configured"
      exit 1
    fi
  done

  for name in "${push_vars[@]}"; do
    upsert_env_var "$ENV_FILE" "$name" "${!name}"
  done
  upsert_env_var "$ENV_FILE" VAPID_SUBJECT "$VAPID_CONTACT"
fi

if [ -n "$push_required" ]; then
  upsert_env_var "$ENV_FILE" CP_REQUIRE_PUSH_NOTIFICATIONS "$push_required"
fi

case "$CP_BILLING_MODE" in
  manual_only)
    for name in "${stripe_vars[@]}"; do
      remove_env_var "$ENV_FILE" "$name"
    done
    ;;
  stripe)
    for name in "${stripe_vars[@]}"; do
      if [ -z "${!name:-}" ]; then
        log_error "$name must be set when CP_BILLING_MODE=stripe"
        exit 1
      fi
      upsert_env_var "$ENV_FILE" "$name" "${!name}"
    done
    ;;
  *)
    log_error "CP_BILLING_MODE must be stripe or manual_only"
    exit 1
    ;;
esac

log_success "Billing runtime env synced to $ENV_FILE"
