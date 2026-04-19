const trackedEnvKeys = [
  'CP_ALLOW_ORG_DIRECTORY',
  'CP_ALLOW_SELF_SERVICE_ORGS',
  'CP_BILLING_MODE',
  'CP_ENABLE_RATE_LIMIT_IN_TEST',
  'CP_FAKE_EMAIL_DELIVERY',
  'CP_GLOBAL_RATE_LIMIT_MAX',
  'CP_GLOBAL_RATE_LIMIT_WINDOW_MS',
  'CP_JSON_LIMIT',
  'CP_ONBOARDING_RATE_LIMIT_MAX',
  'CP_ONBOARDING_RATE_LIMIT_WINDOW_MS',
  'CP_PLATFORM_ADMIN_EMAILS',
  'CP_REQUIRE_PUSH_NOTIFICATIONS',
  'CP_SERVE_SPA',
  'CORS_ORIGINS',
  'JWT_SECRET',
  'NODE_ENV',
  'OPENPATH_API_URL',
  'PUBLIC_URL',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'STRIPE_ANNUAL_PRICE_1_10',
  'STRIPE_ANNUAL_PRICE_11_25',
  'STRIPE_ANNUAL_PRICE_26_50',
  'STRIPE_ANNUAL_PRICE_51_100',
  'STRIPE_ONBOARDING_PRICE_1_25',
  'STRIPE_ONBOARDING_PRICE_26_100',
  'STRIPE_PILOT_PRICE',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'VAPID_CONTACT',
  'VAPID_PRIVATE_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_SUBJECT',
] as const;

type TrackedEnvKey = (typeof trackedEnvKeys)[number];

export type EnvSnapshot = Record<TrackedEnvKey, string | undefined>;

export function snapshotTrackedEnv(): EnvSnapshot {
  return trackedEnvKeys.reduce((snapshot, key) => {
    snapshot[key] = process.env[key];
    return snapshot;
  }, {} as EnvSnapshot);
}

export function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

export function restoreTrackedEnv(snapshot: EnvSnapshot): void {
  for (const key of trackedEnvKeys) {
    setEnv(key, snapshot[key]);
  }
}
