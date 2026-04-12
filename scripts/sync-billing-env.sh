#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

ENV_FILE="${1:-$SCRIPT_DIR/../config/.env}"

stripe_vars=(
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_ANNUAL_PRICE_1_10
  STRIPE_ANNUAL_PRICE_11_25
  STRIPE_ANNUAL_PRICE_26_50
  STRIPE_ANNUAL_PRICE_51_100
  STRIPE_ONBOARDING_PRICE_1_25
  STRIPE_ONBOARDING_PRICE_26_100
  STRIPE_PILOT_PRICE
)

required_vars=(
  CP_BILLING_MODE
  CP_PLATFORM_ADMIN_EMAILS
)

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

CP_BILLING_MODE="${CP_BILLING_MODE:-manual_only}"

for name in "${required_vars[@]}"; do
  if [ -z "${!name:-}" ]; then
    log_error "$name must be set"
    exit 1
  fi
done

for name in "${required_vars[@]}"; do
  upsert_env_var "$ENV_FILE" "$name" "${!name}"
done

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
