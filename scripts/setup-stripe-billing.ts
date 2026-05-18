#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ONBOARDING_TIERS, PILOT, PRICING_TIERS } from '../react-spa/src/data/pricing-data.ts';

type StripeMode = 'live' | 'test';

type CatalogKind = 'annual' | 'onboarding' | 'pilot';

type CatalogItem = {
  kind: CatalogKind;
  envKey: string;
  catalogKey: string;
  lookupKey: string;
  productName: string;
  productDescription: string;
  priceNickname: string;
  unitAmountCents: number;
  recurringInterval: 'year' | null;
};

type CliOptions = {
  apiKey: string | null;
  publicUrl: string | null;
  webhookUrl: string | null;
  envInputPath: string;
  writeEnvPath: string | null;
  dryRun: boolean;
};

type StripeListResponse<T> = {
  data: T[];
  has_more: boolean;
};

type StripeMetadataCarrier = {
  id: string;
  metadata?: Record<string, string>;
};

type StripeProduct = StripeMetadataCarrier & {
  name: string;
  description: string | null;
  active: boolean;
};

type StripePrice = StripeMetadataCarrier & {
  active: boolean;
  currency: string;
  lookup_key: string | null;
  nickname: string | null;
  product: string;
  recurring: { interval: string } | null;
  tax_behavior: string | null;
  unit_amount: number | null;
};

type StripeWebhookEndpoint = StripeMetadataCarrier & {
  url: string;
  enabled_events: string[];
  description: string | null;
  secret?: string;
  status?: string;
};

type EnsurePriceResult = {
  envKey: string;
  priceId: string;
};

type EnsureWebhookResult = {
  endpointId: string;
  webhookSecret: string | null;
  reused: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');
const DEFAULT_ENV_INPUT = resolve(PROJECT_ROOT, 'config/.env');
const WEBHOOK_EVENT = 'checkout.session.completed';
const WEBHOOK_METADATA_KEY = 'cp_webhook_key';
const WEBHOOK_METADATA_VALUE = 'billing_checkout_completed_v1';
const MANAGED_BY_KEY = 'cp_managed_by';
const MANAGED_BY_VALUE = 'classroompath';

function buildStripeCatalog(): CatalogItem[] {
  const annualItems = PRICING_TIERS.filter(
    (tier) => tier.maxClassrooms !== null && tier.maxClassrooms <= 100
  ).map<CatalogItem>((tier) => {
    const rangeKey = `${tier.minClassrooms}_${tier.maxClassrooms}`.replace(/-/g, '_');
    return {
      kind: 'annual',
      envKey: `STRIPE_ANNUAL_PRICE_${rangeKey}`,
      catalogKey: `annual_${rangeKey}`,
      lookupKey: `classroompath_annual_${rangeKey}`,
      productName: `ClassroomPath cuota anual ${tier.rangeLabel}`,
      productDescription: `${tier.tagline} Cobro anual por aula. IVA no incluido.`,
      priceNickname: `Cuota anual ${tier.rangeLabel}`,
      unitAmountCents: tier.pricePerClassroomPerYear * 100,
      recurringInterval: 'year',
    };
  });

  const onboardingItems = ONBOARDING_TIERS.filter(
    (tier) => tier.oneTimeFee !== null && tier.maxClassrooms !== null && tier.maxClassrooms <= 100
  ).map<CatalogItem>((tier) => {
    const rangeKey = `${tier.minClassrooms}_${tier.maxClassrooms}`.replace(/-/g, '_');
    return {
      kind: 'onboarding',
      envKey: `STRIPE_ONBOARDING_PRICE_${rangeKey}`,
      catalogKey: `onboarding_${rangeKey}`,
      lookupKey: `classroompath_onboarding_${rangeKey}`,
      productName: `ClassroomPath onboarding ${tier.rangeLabel}`,
      productDescription: `Alta inicial y puesta en marcha para ${tier.rangeLabel.toLowerCase()}. IVA no incluido.`,
      priceNickname: `Onboarding ${tier.rangeLabel}`,
      unitAmountCents: (tier.oneTimeFee ?? 0) * 100,
      recurringInterval: null,
    };
  });

  const pilotItem: CatalogItem = {
    kind: 'pilot',
    envKey: 'STRIPE_PILOT_PRICE',
    catalogKey: 'pilot',
    lookupKey: 'classroompath_pilot',
    productName: `ClassroomPath piloto ${PILOT.classrooms} aulas`,
    productDescription: `Piloto de ${PILOT.durationDays} dias para ${PILOT.classrooms} aulas. IVA no incluido.`,
    priceNickname: `Piloto ${PILOT.classrooms} aulas`,
    unitAmountCents: PILOT.totalPrice * 100,
    recurringInterval: null,
  };

  return [...annualItems, ...onboardingItems, pilotItem];
}

function printUsage(): void {
  console.error('Usage:');
  console.error(
    '  node --import tsx scripts/setup-stripe-billing.ts [--dry-run] [--public-url https://classroompath.example.invalid]'
  );
  console.error(
    '      [--webhook-url https://classroompath.example.invalid/cp/stripe/webhook] [--api-key sk_live_...]'
  );
  console.error('      [--env-input config/.env] [--write-env config/.env]');
}

function parseArgs(argv: string[]): CliOptions {
  let apiKey: string | null = null;
  let publicUrl: string | null = null;
  let webhookUrl: string | null = null;
  let envInputPath = DEFAULT_ENV_INPUT;
  let writeEnvPath: string | null = null;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === '--api-key') {
      apiKey = next;
      index += 1;
      continue;
    }

    if (arg === '--public-url') {
      publicUrl = next;
      index += 1;
      continue;
    }

    if (arg === '--webhook-url') {
      webhookUrl = next;
      index += 1;
      continue;
    }

    if (arg === '--env-input') {
      envInputPath = resolve(PROJECT_ROOT, next);
      index += 1;
      continue;
    }

    if (arg === '--write-env') {
      writeEnvPath = resolve(PROJECT_ROOT, next);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    apiKey,
    publicUrl,
    webhookUrl,
    envInputPath,
    writeEnvPath,
    dryRun,
  };
}

function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    result[key] = value.replace(/^"(.*)"$/u, '$1').replace(/^'(.*)'$/u, '$1');
  }
  return result;
}

function loadEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) return {};
  return parseEnvFile(readFileSync(envPath, 'utf8'));
}

function normalizePublicUrl(value: string): string {
  return value.replace(/\/+$/u, '');
}

function buildWebhookUrl(publicUrl: string): string {
  return `${normalizePublicUrl(publicUrl)}/cp/stripe/webhook`;
}

function detectStripeMode(apiKey: string): StripeMode {
  return apiKey.startsWith('sk_live_') ? 'live' : 'test';
}

function renderEnvBlock(values: Record<string, string | null>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function updateEnvFileContents(
  existingContents: string,
  values: Record<string, string | null>
): string {
  const lines = existingContents.length > 0 ? existingContents.split(/\r?\n/u) : [];
  const handled = new Set<string>();

  const nextLines = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=.*$/u.exec(line);
    if (!match) return line;
    const key = match[1];
    if (!(key in values) || values[key] === null) return line;
    handled.add(key);
    return `${key}=${values[key]}`;
  });

  const missingLines = Object.entries(values)
    .filter(([key, value]) => value !== null && !handled.has(key))
    .map(([key, value]) => `${key}=${value}`);

  const joined = [...nextLines, ...missingLines].filter(Boolean).join('\n');
  return joined.endsWith('\n') ? joined : `${joined}\n`;
}

async function stripeRequest<T>(params: {
  apiKey: string;
  method: 'GET' | 'POST';
  path: string;
  body?: URLSearchParams;
}): Promise<T> {
  const response = await fetch(`https://api.stripe.com${params.path}`, {
    method: params.method,
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      ...(params.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params.body,
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | T
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload.error?.message ?? `Stripe API error on ${params.path}`)
        : `Stripe API error on ${params.path}`;
    throw new Error(message);
  }

  return payload as T;
}

async function stripeListAll<T extends { id: string }>(params: {
  apiKey: string;
  path: string;
}): Promise<T[]> {
  const items: T[] = [];
  let startingAfter: string | null = null;

  while (true) {
    const query = new URLSearchParams({ limit: '100' });
    if (startingAfter) {
      query.set('starting_after', startingAfter);
    }

    const page = await stripeRequest<StripeListResponse<T>>({
      apiKey: params.apiKey,
      method: 'GET',
      path: `${params.path}?${query.toString()}`,
    });

    items.push(...page.data);
    if (!page.has_more || page.data.length === 0) {
      return items;
    }

    startingAfter = page.data[page.data.length - 1]?.id ?? null;
    if (!startingAfter) {
      return items;
    }
  }
}

function buildManagedMetadata(catalogKey: string, envKey: string): Record<string, string> {
  return {
    [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
    cp_catalog_key: catalogKey,
    cp_env_key: envKey,
  };
}

async function ensureProduct(params: {
  apiKey: string;
  item: CatalogItem;
  existingProducts: StripeProduct[];
}): Promise<StripeProduct> {
  const existing = params.existingProducts.find(
    (product) => product.metadata?.cp_catalog_key === params.item.catalogKey
  );
  const metadata = buildManagedMetadata(params.item.catalogKey, params.item.envKey);

  if (existing) {
    const needsUpdate =
      existing.name !== params.item.productName ||
      (existing.description ?? '') !== params.item.productDescription ||
      existing.metadata?.cp_env_key !== params.item.envKey;

    if (!needsUpdate) return existing;

    const body = new URLSearchParams({
      name: params.item.productName,
      description: params.item.productDescription,
      active: 'true',
    });
    for (const [key, value] of Object.entries(metadata)) {
      body.set(`metadata[${key}]`, value);
    }

    return stripeRequest<StripeProduct>({
      apiKey: params.apiKey,
      method: 'POST',
      path: `/v1/products/${existing.id}`,
      body,
    });
  }

  const body = new URLSearchParams({
    name: params.item.productName,
    description: params.item.productDescription,
    active: 'true',
  });
  for (const [key, value] of Object.entries(metadata)) {
    body.set(`metadata[${key}]`, value);
  }

  return stripeRequest<StripeProduct>({
    apiKey: params.apiKey,
    method: 'POST',
    path: '/v1/products',
    body,
  });
}

function validateExistingPrice(item: CatalogItem, price: StripePrice, productId: string): void {
  if (!price.active) {
    throw new Error(`Price ${price.id} for ${item.envKey} exists but is not active`);
  }
  if (price.product !== productId) {
    throw new Error(`Price ${price.id} for ${item.envKey} is attached to a different product`);
  }
  if (price.currency !== 'eur') {
    throw new Error(`Price ${price.id} for ${item.envKey} must use EUR`);
  }
  if (price.unit_amount !== item.unitAmountCents) {
    throw new Error(
      `Price ${price.id} for ${item.envKey} has ${price.unit_amount} cents, expected ${item.unitAmountCents}`
    );
  }
  if ((price.tax_behavior ?? 'unspecified') !== 'exclusive') {
    throw new Error(`Price ${price.id} for ${item.envKey} must use tax_behavior=exclusive`);
  }

  if (item.recurringInterval === null && price.recurring !== null) {
    throw new Error(`Price ${price.id} for ${item.envKey} should be one-time`);
  }

  if (item.recurringInterval !== null && price.recurring?.interval !== item.recurringInterval) {
    throw new Error(
      `Price ${price.id} for ${item.envKey} should recur ${item.recurringInterval}, got ${price.recurring?.interval ?? 'one-time'}`
    );
  }
}

async function ensurePrice(params: {
  apiKey: string;
  item: CatalogItem;
  product: StripeProduct;
  existingPrices: StripePrice[];
}): Promise<EnsurePriceResult> {
  const existing = params.existingPrices.find(
    (price) => price.lookup_key === params.item.lookupKey
  );

  if (existing) {
    validateExistingPrice(params.item, existing, params.product.id);
    return { envKey: params.item.envKey, priceId: existing.id };
  }

  const body = new URLSearchParams({
    product: params.product.id,
    currency: 'eur',
    lookup_key: params.item.lookupKey,
    nickname: params.item.priceNickname,
    tax_behavior: 'exclusive',
    unit_amount: String(params.item.unitAmountCents),
  });
  if (params.item.recurringInterval) {
    body.set('recurring[interval]', params.item.recurringInterval);
  }
  for (const [key, value] of Object.entries(
    buildManagedMetadata(params.item.catalogKey, params.item.envKey)
  )) {
    body.set(`metadata[${key}]`, value);
  }

  const created = await stripeRequest<StripePrice>({
    apiKey: params.apiKey,
    method: 'POST',
    path: '/v1/prices',
    body,
  });

  return { envKey: params.item.envKey, priceId: created.id };
}

async function ensureWebhookEndpoint(params: {
  apiKey: string;
  webhookUrl: string;
  existingEndpoints: StripeWebhookEndpoint[];
}): Promise<EnsureWebhookResult> {
  const existing = params.existingEndpoints.find((endpoint) => endpoint.url === params.webhookUrl);

  const body = new URLSearchParams({
    url: params.webhookUrl,
    description: 'ClassroomPath billing checkout webhook',
  });
  body.set('enabled_events[0]', WEBHOOK_EVENT);
  body.set(`metadata[${MANAGED_BY_KEY}]`, MANAGED_BY_VALUE);
  body.set(`metadata[${WEBHOOK_METADATA_KEY}]`, WEBHOOK_METADATA_VALUE);

  if (existing) {
    const needsUpdate =
      existing.url !== params.webhookUrl ||
      existing.description !== 'ClassroomPath billing checkout webhook' ||
      !existing.enabled_events.includes(WEBHOOK_EVENT) ||
      existing.metadata?.[WEBHOOK_METADATA_KEY] !== WEBHOOK_METADATA_VALUE;

    if (needsUpdate) {
      await stripeRequest<StripeWebhookEndpoint>({
        apiKey: params.apiKey,
        method: 'POST',
        path: `/v1/webhook_endpoints/${existing.id}`,
        body,
      });
    }

    return {
      endpointId: existing.id,
      webhookSecret: null,
      reused: true,
    };
  }

  const created = await stripeRequest<StripeWebhookEndpoint>({
    apiKey: params.apiKey,
    method: 'POST',
    path: '/v1/webhook_endpoints',
    body,
  });

  return {
    endpointId: created.id,
    webhookSecret: created.secret ?? null,
    reused: false,
  };
}

async function configureStripeBilling(options: CliOptions): Promise<void> {
  const envFile = loadEnvFile(options.envInputPath);
  const apiKey =
    options.apiKey ?? process.env.STRIPE_SECRET_KEY ?? envFile.STRIPE_SECRET_KEY ?? null;
  const publicUrl = options.publicUrl ?? process.env.PUBLIC_URL ?? envFile.PUBLIC_URL ?? null;

  if (!publicUrl) {
    throw new Error('Missing PUBLIC_URL. Pass --public-url or set it in env/config/.env.');
  }

  const normalizedPublicUrl = normalizePublicUrl(publicUrl);
  const webhookUrl = options.webhookUrl ?? buildWebhookUrl(normalizedPublicUrl);
  const catalog = buildStripeCatalog();

  if (!options.dryRun && !apiKey) {
    throw new Error('Missing STRIPE_SECRET_KEY. Pass --api-key or set it in env/config/.env.');
  }

  console.log(`Stripe mode: ${apiKey ? detectStripeMode(apiKey) : 'n/a (dry-run)'}`);
  console.log(`Public URL: ${normalizedPublicUrl}`);
  console.log(`Webhook URL: ${webhookUrl}`);
  console.log('');

  if (options.dryRun) {
    for (const item of catalog) {
      const amount = (item.unitAmountCents / 100).toFixed(2);
      console.log(`${item.envKey} -> ${item.lookupKey} -> EUR ${amount}`);
    }
    console.log('');
    console.log('Dry run only. No changes were sent to Stripe.');
    return;
  }

  const [existingProducts, existingPrices, existingEndpoints] = await Promise.all([
    stripeListAll<StripeProduct>({ apiKey, path: '/v1/products' }),
    stripeListAll<StripePrice>({ apiKey, path: '/v1/prices' }),
    stripeListAll<StripeWebhookEndpoint>({ apiKey, path: '/v1/webhook_endpoints' }),
  ]);

  const envValues: Record<string, string | null> = {};

  for (const item of catalog) {
    const product = await ensureProduct({
      apiKey,
      item,
      existingProducts,
    });
    const price = await ensurePrice({
      apiKey,
      item,
      product,
      existingPrices,
    });
    envValues[price.envKey] = price.priceId;
  }

  const webhook = await ensureWebhookEndpoint({
    apiKey,
    webhookUrl,
    existingEndpoints,
  });
  envValues.STRIPE_WEBHOOK_SECRET = webhook.webhookSecret;

  console.log('');
  console.log('Stripe billing catalog is ready.');
  console.log(
    `Webhook endpoint: ${webhook.endpointId}${webhook.reused ? ' (reused)' : ' (created)'}`
  );
  if (webhook.reused) {
    console.log(
      'Webhook secret not returned because the endpoint already existed. Keep the current STRIPE_WEBHOOK_SECRET from Stripe/Dashboard.'
    );
  }
  console.log('');
  console.log(renderEnvBlock(envValues));

  if (options.writeEnvPath) {
    const existingContents = existsSync(options.writeEnvPath)
      ? readFileSync(options.writeEnvPath, 'utf8')
      : '';
    const nextContents = updateEnvFileContents(existingContents, envValues);
    writeFileSync(options.writeEnvPath, nextContents, 'utf8');
    console.log('');
    console.log(`Updated ${options.writeEnvPath}`);
  }
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    await configureStripeBilling(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  await main();
}

export {
  buildStripeCatalog,
  buildWebhookUrl,
  detectStripeMode,
  normalizePublicUrl,
  renderEnvBlock,
  updateEnvFileContents,
};
