#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_API_URL = 'https://classroompath.example.invalid';
const LINUX_AJAX_AUTO_ALLOW_ORIGIN_HOST = 'ajax-auto-allow-origin.127.0.0.1.sslip.io';
const LINUX_EXPLICIT_AJAX_ALLOWLIST_HOSTS = Object.freeze([
  'ajax-auto-allow-target.127.0.0.1.sslip.io',
  'ajax-auto-allow-xhr.127.0.0.1.sslip.io',
  'ajax-auto-allow-asset.127.0.0.1.sslip.io',
  'ajax-auto-allow-script.127.0.0.1.sslip.io',
  'ajax-auto-allow-stylesheet.127.0.0.1.sslip.io',
  'ajax-auto-allow-font.127.0.0.1.sslip.io',
]);
const apiUrl = (process.env.PRODUCTION_LINUX_BOOTSTRAP_CANARY_URL ?? DEFAULT_API_URL).replace(
  /\/$/,
  ''
);
const requestApiHost = new URL(apiUrl).hostname;
const requestOrigin =
  process.env.PRODUCTION_LINUX_BOOTSTRAP_CANARY_REQUEST_ORIGIN ?? new URL(apiUrl).origin;
const timeoutMs = Number.parseInt(
  process.env.PRODUCTION_LINUX_BOOTSTRAP_CANARY_TIMEOUT ?? '30000',
  10
);
const stripeWebhookSecret =
  process.env.PRODUCTION_LINUX_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET ?? '';
const adminCanaryToken = process.env.PRODUCTION_LINUX_BOOTSTRAP_CANARY_ADMIN_TOKEN ?? '';
const billingMode = process.env.PRODUCTION_LINUX_BOOTSTRAP_CANARY_BILLING_MODE ?? 'stripe';
const CANARY_MARKER = '[client-canary]';

function readCurrentTermsVersion() {
  const sourcePath = resolve('api/src/services/legal-consent.service.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const match = source.match(/CURRENT_TERMS_VERSION\s*=\s*'([^']+)'/);
  assert.ok(match, 'CURRENT_TERMS_VERSION should be declared in legal-consent.service.ts');
  return match[1];
}

function uniqueValue(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractTrpcData(envelope) {
  const data = envelope?.result?.data;
  if (!data) {
    return undefined;
  }

  return data.json ?? data;
}

function extractRetryAfterMs(envelope) {
  const retryAfterMs = envelope?.error?.data?.retryAfterMs;
  return typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : null;
}

function extractCookies(response) {
  const headers = response.headers;
  const getSetCookie = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const fallback = headers.get('set-cookie');
  const rawCookies = getSetCookie.length > 0 ? getSetCookie : fallback ? [fallback] : [];

  return rawCookies
    .flatMap((header) => header.split(/,(?=[^;,\s]+=)/))
    .map((cookie) => cookie.split(';', 1)[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function extractTokenFromVerificationUrl(verificationUrl) {
  const url = new URL(verificationUrl);
  const token = url.searchParams.get('token');
  assert.ok(token, 'verificationUrl should include a token');
  return token;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function stripeSignature(payload) {
  assert.ok(
    stripeWebhookSecret,
    'PRODUCTION_LINUX_BOOTSTRAP_CANARY_STRIPE_WEBHOOK_SECRET must be set'
  );

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', stripeWebhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  return `t=${timestamp},v1=${signature}`;
}

async function activateStripeBilling({ cookieHeader, organizationName }) {
  const { data: checkout } = await postTrpc(
    'billing.createCheckout',
    {
      kind: 'annual',
      organizationName,
      classrooms: 12,
    },
    cookieHeader
  );

  assert.equal(
    typeof checkout.checkoutSessionId,
    'string',
    'billing.createCheckout should return a checkout session id'
  );
  assert.equal(
    typeof checkout.checkoutUrl,
    'string',
    'billing.createCheckout should return a checkout URL'
  );

  const webhookPayload = JSON.stringify({
    id: `evt_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: checkout.checkoutSessionId,
        customer: `cus_${Date.now()}`,
        subscription: `sub_${Date.now()}`,
        payment_status: 'paid',
      },
    },
  });

  const webhookResponse = await fetchWithRetry(`${apiUrl}/cp/stripe/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': stripeSignature(webhookPayload),
    },
    body: webhookPayload,
  });

  assert.equal(webhookResponse.status, 200, 'stripe webhook should activate the checkout');

  return { activationMode: 'stripe' };
}

async function activateManualBilling({ cookieHeader, organizationName }) {
  assert.ok(
    adminCanaryToken,
    'PRODUCTION_LINUX_BOOTSTRAP_CANARY_ADMIN_TOKEN must be set for manual_only canaries'
  );

  const { data: manualRequest } = await postTrpc(
    'billing.createManualRequest',
    {
      kind: 'custom_quote',
      organizationName,
      classrooms: 12,
      note: `${CANARY_MARKER} automated production client canary`,
    },
    cookieHeader
  );

  assert.equal(
    typeof manualRequest.requestId,
    'string',
    'billing.createManualRequest should return a request id'
  );

  const approvalResponse = await fetchWithRetry(
    `${apiUrl}/cp/internal/client-canary/manual-request/${encodeURIComponent(manualRequest.requestId)}/approve`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminCanaryToken}`,
        'Content-Type': 'application/json',
        Origin: requestOrigin,
      },
      body: JSON.stringify({}),
    }
  );

  assert.equal(
    approvalResponse.status,
    200,
    'client canary manual billing approval should succeed'
  );
  const approval = await approvalResponse.json();
  assert.equal(approval.status, 'approved', 'manual billing approval should report approved');
  assert.equal(typeof approval.organizationId, 'string');

  return {
    activationMode: 'manual_only',
    manualRequestId: manualRequest.requestId,
    organizationId: approval.organizationId,
  };
}

async function fetchWithTimeout(input, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function describeFetchError(error) {
  const cause = error?.cause;
  const code = cause?.code ?? error?.code ?? '';
  const message = error instanceof Error ? error.message : String(error);
  return code ? `${message} (${code})` : message;
}

async function fetchWithRetry(input, init = {}, attempts = 6) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchWithTimeout(input, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      process.stderr.write(
        `Fetch attempt ${attempt}/${attempts} failed for ${input}: ${describeFetchError(error)}\n`
      );
      await sleep(1_000 * attempt);
    }
  }

  throw lastError;
}

async function postTrpc(procedure, payload, cookieHeader = '') {
  const headers = {
    'Content-Type': 'application/json',
    Origin: requestOrigin,
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetchWithRetry(`${apiUrl}/cp/trpc/${procedure}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const raw = await response.json();
    const envelope = Array.isArray(raw) ? raw[0] : raw;

    if (response.status === 429) {
      const retryAfterMs = extractRetryAfterMs(envelope);
      if (retryAfterMs && attempt < 3) {
        await sleep(retryAfterMs + 250);
        continue;
      }
    }

    assert.equal(response.status, 200, `${procedure} returned ${response.status}`);
    assert.ok(!envelope?.error, `${procedure} returned tRPC error ${JSON.stringify(raw)}`);
    const data = extractTrpcData(envelope);
    assert.ok(data, `${procedure} returned no JSON payload`);
    return {
      data,
      response,
    };
  }

  throw new Error(`${procedure} exhausted retry attempts`);
}

async function getTrpc(procedure, input, cookieHeader = '') {
  const headers = {
    Origin: requestOrigin,
  };

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  let url = `${apiUrl}/cp/trpc/${procedure}`;
  if (input !== undefined) {
    url += `?input=${encodeURIComponent(JSON.stringify(input))}`;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetchWithRetry(url, { headers });
    const raw = await response.json();
    const envelope = Array.isArray(raw) ? raw[0] : raw;

    if (response.status === 429) {
      const retryAfterMs = extractRetryAfterMs(envelope);
      if (retryAfterMs && attempt < 3) {
        await sleep(retryAfterMs + 250);
        continue;
      }
    }

    assert.equal(response.status, 200, `${procedure} returned ${response.status}`);
    assert.ok(!envelope?.error, `${procedure} returned tRPC error ${JSON.stringify(raw)}`);
    const data = extractTrpcData(envelope);
    assert.ok(data, `${procedure} returned no JSON payload`);
    return {
      data,
      response,
    };
  }

  throw new Error(`${procedure} exhausted retry attempts`);
}

function setGithubOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value)}\n`, 'utf8');
}

function maskGithubSecret(value) {
  if (!process.env.GITHUB_ACTIONS || !value) {
    return;
  }

  process.stdout.write(`::add-mask::${String(value)}\n`);
}

async function timedCanaryStep(name, operation) {
  const startedAt = Date.now();
  let status = 'success';

  try {
    return await operation();
  } catch (error) {
    status = 'failure';
    throw error;
  } finally {
    const durationSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
    process.stdout.write(
      `Production Linux bootstrap canary timing: ${name} ${status} ${durationSeconds}s\n`
    );
  }
}

async function waitForTeacherMembership(cookieHeader) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const { data: status } = await getTrpc('onboarding.status', undefined, cookieHeader);
    if (status.hasMembership === true) {
      return status;
    }

    await sleep(1000);
  }

  throw new Error('Teacher membership did not become visible after billing activation');
}

async function resolveTeacherCookieAfterBilling({ cookieHeader, email, password }) {
  let refreshedCookieHeader = cookieHeader;

  try {
    const refreshResult = await timedCanaryStep('refresh teacher session', () =>
      postTrpc('auth.refresh', {}, cookieHeader)
    );
    refreshedCookieHeader = extractCookies(refreshResult.response) || cookieHeader;
  } catch {
    const fallbackLoginResult = await timedCanaryStep('fallback relogin teacher', () =>
      postTrpc('auth.login', { email, password })
    );
    refreshedCookieHeader = extractCookies(fallbackLoginResult.response) || cookieHeader;
  }

  await timedCanaryStep('poll onboarding status', () =>
    waitForTeacherMembership(refreshedCookieHeader)
  );

  return refreshedCookieHeader;
}

function sanitizeSummaryForArtifact(summary) {
  return {
    ...summary,
    enrollmentToken: summary.enrollmentToken ? '[redacted]' : '',
    enrollmentTokenPresent: Boolean(summary.enrollmentToken),
  };
}

async function main() {
  const email = `${uniqueValue('linux-production-bootstrap-canary')}@test.local`;
  const password = `SecurePassword123!-${Math.random().toString(36).slice(2, 8)}`;
  const termsVersion = readCurrentTermsVersion();

  const { data: registration } = await postTrpc('auth.register', {
    email,
    name: 'Linux Production Bootstrap Canary',
    password,
    termsAccepted: true,
    termsVersion,
  });

  assert.equal(registration.email, email, 'auth.register should echo the email');
  assert.equal(typeof registration.verificationUrl, 'string');

  await postTrpc('auth.verifyEmail', {
    email,
    token: extractTokenFromVerificationUrl(registration.verificationUrl),
  });

  const loginResult = await postTrpc('auth.login', { email, password });
  const initialCookieHeader = extractCookies(loginResult.response);
  assert.ok(initialCookieHeader, 'auth.login should issue a session cookie');

  const organizationName = `${CANARY_MARKER} Linux Production Bootstrap Canary Org ${Date.now()}`;
  const activation =
    billingMode === 'stripe'
      ? await activateStripeBilling({ cookieHeader: initialCookieHeader, organizationName })
      : billingMode === 'manual_only'
        ? await activateManualBilling({ cookieHeader: initialCookieHeader, organizationName })
        : null;

  assert.ok(
    activation,
    'PRODUCTION_LINUX_BOOTSTRAP_CANARY_BILLING_MODE must be stripe or manual_only'
  );

  const cookieHeader = await resolveTeacherCookieAfterBilling({
    cookieHeader: initialCookieHeader,
    email,
    password,
  });
  assert.ok(cookieHeader, 'auth.refresh should preserve a session cookie after billing activation');

  const canaryGroupName = uniqueValue('linux-production-bootstrap-canary-group');
  const { data: group } = await postTrpc(
    'groups.create',
    {
      name: canaryGroupName,
      displayName: 'Linux Production Bootstrap Canary Group',
    },
    cookieHeader
  );

  assert.ok(group.id, 'groups.create should return a group id');

  const explicitSeedHosts = [
    LINUX_AJAX_AUTO_ALLOW_ORIGIN_HOST,
    ...LINUX_EXPLICIT_AJAX_ALLOWLIST_HOSTS,
  ];
  for (const host of explicitSeedHosts) {
    const { data: canaryRule } = await postTrpc(
      'groups.createRule',
      {
        groupId: group.id,
        type: 'whitelist',
        value: host,
        comment: 'Production Linux bootstrap canary explicit AJAX seed rule',
      },
      cookieHeader
    );

    assert.ok(canaryRule.id, 'groups.createRule should return a rule id');
  }

  const { data: requestApiRule } = await postTrpc(
    'groups.createRule',
    {
      groupId: group.id,
      type: 'whitelist',
      value: requestApiHost,
      comment: 'Production Linux bootstrap canary request API seed rule',
    },
    cookieHeader
  );

  assert.ok(requestApiRule.id, 'groups.createRule should return a request API rule id');

  const { data: classroom } = await postTrpc(
    'classrooms.create',
    {
      name: uniqueValue('linux-production-bootstrap-canary'),
      displayName: 'Linux Production Bootstrap Canary',
      defaultGroupId: group.id,
    },
    cookieHeader
  );

  assert.ok(classroom.id, 'classrooms.create should return a classroom id');
  assert.equal(
    classroom.defaultGroupId,
    group.id,
    'classrooms.create should bind the seeded group as defaultGroupId'
  );

  const ticketResponse = await fetchWithRetry(`${apiUrl}/api/enroll/${classroom.id}/ticket`, {
    method: 'POST',
    headers: {
      Cookie: cookieHeader,
      Origin: requestOrigin,
    },
  });

  assert.equal(ticketResponse.status, 200, `/api/enroll/${classroom.id}/ticket should succeed`);
  const ticketPayload = await ticketResponse.json();
  assert.equal(ticketPayload.success, true, 'ticket endpoint should confirm success');
  assert.equal(
    typeof ticketPayload.enrollmentToken,
    'string',
    'ticket endpoint should return an enrollment token'
  );
  maskGithubSecret(ticketPayload.enrollmentToken);

  const summary = {
    apiUrl,
    requestOrigin,
    billingMode,
    activationMode: activation.activationMode,
    manualRequestId: activation.manualRequestId ?? null,
    email,
    groupId: group.id,
    explicitAjaxAllowlistHosts: LINUX_EXPLICIT_AJAX_ALLOWLIST_HOSTS,
    fontHost: 'ajax-auto-allow-font.127.0.0.1.sslip.io',
    classroomId: classroom.id,
    enrollmentToken: ticketPayload.enrollmentToken,
    linuxScriptUrl: `${apiUrl}/api/enroll/${classroom.id}`,
    publicFirefoxXpiUrl: `${apiUrl}/api/extensions/firefox/openpath.xpi`,
    extensionId: 'monitor-bloqueos@openpath',
    extensionVersion: '',
    bootstrapManifestVersion: '',
  };
  const artifactSummary = sanitizeSummaryForArtifact(summary);

  writeFileSync(
    resolve(
      process.env.PRODUCTION_LINUX_BOOTSTRAP_CANARY_ARTIFACT_PATH ??
        'production-linux-bootstrap-canary.json'
    ),
    `${JSON.stringify(artifactSummary, null, 2)}\n`,
    'utf8'
  );

  for (const [key, value] of Object.entries({
    api_url: summary.apiUrl,
    request_origin: summary.requestOrigin,
    billing_mode: summary.billingMode,
    activation_mode: summary.activationMode,
    manual_request_id: summary.manualRequestId ?? '',
    email: summary.email,
    classroom_id: summary.classroomId,
    group_id: summary.groupId,
    enrollment_token: summary.enrollmentToken,
    linux_script_url: summary.linuxScriptUrl,
    public_firefox_xpi_url: summary.publicFirefoxXpiUrl,
    extension_id: summary.extensionId,
    extension_version: summary.extensionVersion,
    bootstrap_manifest_version: summary.bootstrapManifestVersion,
  })) {
    setGithubOutput(key, value);
  }

  process.stdout.write(`${JSON.stringify(artifactSummary, null, 2)}\n`);
}

await main();
