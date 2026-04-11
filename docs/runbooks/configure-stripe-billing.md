# Configure Stripe Billing

> Status: maintained
> Applies to: ClassroomPath production/staging billing setup
> Last verified: 2026-04-11
> Source of truth: `docs/runbooks/configure-stripe-billing.md`

This runbook creates or reuses the Stripe catalog required by ClassroomPath:

- annual recurring prices per classroom for `1-10`, `11-25`, `26-50`, `51-100`
- onboarding one-time prices for `1-25` and `26-100`
- pilot one-time price
- webhook endpoint for `checkout.session.completed`

The script is idempotent for the current catalog keys. It does not create the `101+` manual tier or the public-campaign exception, because those stay outside automatic checkout.

## Prerequisites

- `STRIPE_SECRET_KEY` for the target Stripe account
- `PUBLIC_URL` for the ClassroomPath environment
- optional writable env file such as `config/.env`

## Dry Run

```bash
npm run stripe:setup -- --dry-run --public-url https://classroompath.eu
```

## Apply Against Stripe

Using environment variables:

```bash
STRIPE_SECRET_KEY=sk_live_xxx \
PUBLIC_URL=https://classroompath.eu \
npm run stripe:setup
```

Using the repo env file and writing back the generated price ids:

```bash
npm run stripe:setup -- --write-env config/.env
```

The script reads from `config/.env` by default when `STRIPE_SECRET_KEY` or `PUBLIC_URL` are not already exported.

## Output

On success the script prints the env block required by ClassroomPath:

- `STRIPE_ANNUAL_PRICE_1_10`
- `STRIPE_ANNUAL_PRICE_11_25`
- `STRIPE_ANNUAL_PRICE_26_50`
- `STRIPE_ANNUAL_PRICE_51_100`
- `STRIPE_ONBOARDING_PRICE_1_25`
- `STRIPE_ONBOARDING_PRICE_26_100`
- `STRIPE_PILOT_PRICE`
- `STRIPE_WEBHOOK_SECRET` (only when a webhook endpoint is created)

If the webhook endpoint already existed, Stripe does not reveal its signing secret again. In that case keep the current `STRIPE_WEBHOOK_SECRET` from Stripe Dashboard or your existing secret store.

## Notes

- The script creates Stripe prices with `tax_behavior=exclusive` because ClassroomPath public pricing states `IVA no incluido`.
- Stripe Tax registrations, business address, and invoice branding may still need final review in Stripe Dashboard even after the API setup is complete.
- Re-running the script is safe while the existing Stripe prices still match the current public catalog.
