import { readFileSync } from 'node:fs';

function loadRuntimeEnvironmentPolicyCatalog() {
  const catalogUrl = new URL(
    '../../config/runtime-environment-policy.catalog.json',
    import.meta.url
  );
  return JSON.parse(readFileSync(catalogUrl, 'utf8'));
}

const runtimeEnvironmentPolicyCatalog = loadRuntimeEnvironmentPolicyCatalog();

export const BILLING_BASE_REQUIRED_ENV_NAMES =
  runtimeEnvironmentPolicyCatalog.billingBaseRequiredEnvNames;

export const STRIPE_REQUIRED_ENV_NAMES = runtimeEnvironmentPolicyCatalog.stripeRequiredEnvNames;

export const OPTIONAL_BILLING_ENV_NAMES = runtimeEnvironmentPolicyCatalog.optionalBillingEnvNames;

export const PUSH_ENV_NAMES = runtimeEnvironmentPolicyCatalog.pushEnvNames;

export const STAGING_EMAIL_PREFLIGHT_MODES =
  runtimeEnvironmentPolicyCatalog.stagingEmailPreflightModes;

export const BILLING_RUNTIME_ENV_NAMES = [
  ...BILLING_BASE_REQUIRED_ENV_NAMES,
  ...OPTIONAL_BILLING_ENV_NAMES,
  ...STRIPE_REQUIRED_ENV_NAMES,
];

function valueIsSet(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseBoolean(value, defaultValue = false) {
  if (typeof value !== 'string') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

export function allowSelfServiceOrgs(env = process.env) {
  return parseBoolean(env.CP_ALLOW_SELF_SERVICE_ORGS, false);
}

export function resolveBillingMode(env = process.env) {
  return valueIsSet(env.CP_BILLING_MODE) ? env.CP_BILLING_MODE.trim() : '';
}

export function billingRequiredEnvNames(env = process.env) {
  const mode = resolveBillingMode(env);

  if (allowSelfServiceOrgs(env)) {
    return ['CP_BILLING_MODE'];
  }

  return mode === 'stripe'
    ? [...BILLING_BASE_REQUIRED_ENV_NAMES, ...STRIPE_REQUIRED_ENV_NAMES]
    : [...BILLING_BASE_REQUIRED_ENV_NAMES];
}

export function billingRequiredEnvNamesForMode(mode) {
  return billingRequiredEnvNames({ CP_BILLING_MODE: mode });
}

export function listMissingBillingEnv(env = process.env) {
  const mode = resolveBillingMode(env);
  const missing = [];

  for (const name of billingRequiredEnvNames(env)) {
    if (!valueIsSet(env[name])) {
      missing.push(name);
    }
  }

  if (mode && mode !== 'stripe' && mode !== 'manual_only') {
    missing.push('CP_BILLING_MODE');
  }

  return [...new Set(missing)];
}

export function hasCompleteBillingEnv(env = process.env) {
  return listMissingBillingEnv(env).length === 0;
}

export function billingEnvGrepPattern() {
  return `^(${BILLING_RUNTIME_ENV_NAMES.join('|')})=`;
}

export function resolveStagingEmailPreflightPolicy({ mode = 'auto', highRisk = 'false' } = {}) {
  if (!STAGING_EMAIL_PREFLIGHT_MODES.includes(mode)) {
    throw new Error('Invalid STAGING_EMAIL_PREFLIGHT_MODE');
  }

  if (mode === 'required') {
    return {
      cpEmailPreflightMode: 'required',
      stagingEmailDeliveryHighRisk: 'true',
    };
  }

  if (mode === 'skip') {
    return {
      cpEmailPreflightMode: 'skip',
      stagingEmailDeliveryHighRisk: 'false',
    };
  }

  const normalizedHighRisk = highRisk === 'true' ? 'true' : 'false';
  return {
    cpEmailPreflightMode: normalizedHighRisk === 'true' ? 'required' : 'skip',
    stagingEmailDeliveryHighRisk: normalizedHighRisk,
  };
}

function parseOption(argv, name, defaultValue = '') {
  const index = argv.indexOf(name);
  if (index < 0) {
    return defaultValue;
  }
  return argv[index + 1] ?? defaultValue;
}

function printLines(values) {
  process.stdout.write(`${values.join('\n')}\n`);
}

function runCli(argv) {
  const command = argv[2] ?? '';

  switch (command) {
    case 'billing-base-required-env-names':
      printLines(BILLING_BASE_REQUIRED_ENV_NAMES);
      return 0;
    case 'billing-required-env-names':
      printLines(billingRequiredEnvNames(process.env));
      return 0;
    case 'stripe-required-env-names':
      printLines(STRIPE_REQUIRED_ENV_NAMES);
      return 0;
    case 'optional-billing-env-names':
      printLines(OPTIONAL_BILLING_ENV_NAMES);
      return 0;
    case 'push-env-names':
      printLines(PUSH_ENV_NAMES);
      return 0;
    case 'billing-env-names':
      printLines(BILLING_RUNTIME_ENV_NAMES);
      return 0;
    case 'billing-env-grep-pattern':
      process.stdout.write(`${billingEnvGrepPattern()}\n`);
      return 0;
    case 'staging-email-preflight': {
      const decision = resolveStagingEmailPreflightPolicy({
        mode: parseOption(argv, '--mode', 'auto'),
        highRisk: parseOption(argv, '--high-risk', 'false'),
      });
      printLines([
        `CP_EMAIL_PREFLIGHT_MODE=${decision.cpEmailPreflightMode}`,
        `STAGING_EMAIL_DELIVERY_HIGH_RISK=${decision.stagingEmailDeliveryHighRisk}`,
      ]);
      return 0;
    }
    case 'missing-billing-env':
      printLines(listMissingBillingEnv(process.env));
      return 0;
    case 'has-complete-billing-env':
      return hasCompleteBillingEnv(process.env) ? 0 : 1;
    default:
      process.stderr.write(
        [
          'Usage: node scripts/lib/runtime-environment-policy.mjs <command>',
          'Commands:',
          '  billing-base-required-env-names',
          '  billing-required-env-names',
          '  stripe-required-env-names',
          '  optional-billing-env-names',
          '  push-env-names',
          '  billing-env-names',
          '  billing-env-grep-pattern',
          '  staging-email-preflight --mode <auto|required|skip> --high-risk <true|false>',
          '  missing-billing-env',
          '  has-complete-billing-env',
        ].join('\n') + '\n'
      );
      return 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = runCli(process.argv);
}
