# Runbook: Configure Stripe Billing

> Status: maintained
> Applies to: ClassroomPath Stripe catalog setup for staging or production
> Last verified: 2026-04-13
> Source of truth: `docs/runbooks/configure-stripe-billing.md`

Source files:

- `scripts/setup-stripe-billing.ts`
- `tests/stripe-billing-setup.test.ts`
- `react-spa/src/data/pricing-data.ts`

This runbook creates or reuses the Stripe catalog required by ClassroomPath:

- annual recurring prices for `1-10`, `11-25`, `26-50`, `51-100`
- onboarding one-time prices for `1-25` and `26-100`
- a pilot one-time price
- a webhook endpoint for `checkout.session.completed`

The script is idempotent for the current catalog keys.

## Prerequisites

- `STRIPE_SECRET_KEY` for the target Stripe account
- `PUBLIC_URL` for the target ClassroomPath environment
- optional writable env file such as `config/.env`

## Dry Run

```bash
npm run stripe:setup -- --dry-run --public-url https://classroompath.eu
```

## Apply Against Stripe

Using exported environment variables:

```bash
STRIPE_SECRET_KEY=sk_live_xxx \
PUBLIC_URL=https://classroompath.eu \
npm run stripe:setup
```

Using the repo env file and writing generated values back into it:

```bash
npm run stripe:setup -- --write-env config/.env
```

If `STRIPE_SECRET_KEY` or `PUBLIC_URL` are not already exported, the script reads `config/.env` by default.

## Output

On success the script prints the env block required by ClassroomPath:

- `STRIPE_ANNUAL_PRICE_1_10`
- `STRIPE_ANNUAL_PRICE_11_25`
- `STRIPE_ANNUAL_PRICE_26_50`
- `STRIPE_ANNUAL_PRICE_51_100`
- `STRIPE_ONBOARDING_PRICE_1_25`
- `STRIPE_ONBOARDING_PRICE_26_100`
- `STRIPE_PILOT_PRICE`
- `STRIPE_WEBHOOK_SECRET` when a webhook endpoint is newly created

If the webhook endpoint already existed, Stripe does not reveal the signing secret again. Reuse the
current `STRIPE_WEBHOOK_SECRET` from Stripe Dashboard or your secret store.

## Notes

- the script derives pricing from the current public pricing data in the SPA
- Stripe prices are created with `tax_behavior=exclusive`
- Stripe Tax registrations, invoice branding, and business details may still need manual review in Stripe Dashboard
