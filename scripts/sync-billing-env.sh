#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

ENV_FILE="${1:-$SCRIPT_DIR/../config/.env}"
RUNTIME_ENV_POLICY_SCRIPT="$SCRIPT_DIR/lib/runtime-environment-policy.mjs"
CP_BILLING_MODE="${CP_BILLING_MODE:-manual_only}"
NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || true)}"

fallback_bool_is_true() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

runtime_policy_names() {
  if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
    "$NODE_BIN" "$RUNTIME_ENV_POLICY_SCRIPT" "$1"
    return 0
  fi

  case "$1" in
    stripe-required-env-names)
      printf '%s\n' \
        STRIPE_SECRET_KEY \
        STRIPE_WEBHOOK_SECRET \
        STRIPE_ANNUAL_PRICE_1_10 \
        STRIPE_ANNUAL_PRICE_11_25 \
        STRIPE_ANNUAL_PRICE_26_50 \
        STRIPE_ANNUAL_PRICE_51_100 \
        STRIPE_ONBOARDING_PRICE_1_25 \
        STRIPE_ONBOARDING_PRICE_26_100 \
        STRIPE_PILOT_PRICE
      ;;
    billing-required-env-names)
      printf '%s\n' CP_BILLING_MODE
      if ! fallback_bool_is_true "${CP_ALLOW_SELF_SERVICE_ORGS:-}"; then
        printf '%s\n' CP_PLATFORM_ADMIN_EMAILS
        if [ "$CP_BILLING_MODE" = "stripe" ]; then
          runtime_policy_names stripe-required-env-names
        fi
      fi
      ;;
    optional-billing-env-names)
      printf '%s\n' CP_ALLOW_SELF_SERVICE_ORGS CP_CLIENT_CANARY_ADMIN_TOKEN
      ;;
    push-env-names)
      printf '%s\n' VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_CONTACT
      ;;
    *)
      log_error "Unsupported runtime policy command without node: $1"
      return 1
      ;;
  esac
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
