#!/usr/bin/env node

import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_API_URL = 'https://classroompath.eu';
const apiUrl = (process.env.PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_URL ?? DEFAULT_API_URL).replace(
  /\/$/,
  ''
);
const requestOrigin =
  process.env.PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_REQUEST_ORIGIN ?? new URL(apiUrl).origin;
const timeoutMs = Number.parseInt(
  process.env.PRODUCTION_WINDOWS_BOOTSTRAP_CANARY_TIMEOUT ?? '30000',
  10
);

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

async function fetchWithRetry(input, init = {}, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchWithTimeout(input, init);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      await sleep(500 * attempt);
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

function setGithubOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value)}\n`, 'utf8');
}

async function main() {
  const email = `${uniqueValue('windows-production-bootstrap-canary')}@test.local`;
  const password = `SecurePassword123!-${Math.random().toString(36).slice(2, 8)}`;
  const termsVersion = readCurrentTermsVersion();

  const { data: registration } = await postTrpc('auth.register', {
    email,
    name: 'Windows Production Bootstrap Canary',
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

  await postTrpc(
    'onboarding.createOrganization',
    {
      name: `Windows Production Bootstrap Canary Org ${Date.now()}`,
    },
    initialCookieHeader
  );

  const refreshedLoginResult = await postTrpc('auth.login', { email, password });
  const cookieHeader = extractCookies(refreshedLoginResult.response);
  assert.ok(cookieHeader, 'auth.login should reissue a session cookie after organization setup');

  const { data: classroom } = await postTrpc(
    'classrooms.create',
    {
      name: uniqueValue('windows-production-bootstrap-canary'),
      displayName: 'Windows Production Bootstrap Canary',
    },
    cookieHeader
  );

  assert.ok(classroom.id, 'classrooms.create should return a classroom id');

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

  const authHeaders = {
    Authorization: `Bearer ${ticketPayload.enrollmentToken}`,
    Origin: requestOrigin,
  };
  const manifestResponse = await fetchWithRetry(
    `${apiUrl}/api/agent/windows/bootstrap/latest.json`,
    {
      headers: authHeaders,
    }
  );

  assert.equal(manifestResponse.status, 200, 'bootstrap manifest should be available');
  const manifest = await manifestResponse.json();
  assert.equal(manifest.success, true, 'bootstrap manifest should report success');

  const runtimeSpecEntry = manifest.files.find(
    (file) => file.path === 'runtime/browser-policy-spec.json'
  );
  const metadataEntry = manifest.files.find(
    (file) => file.path === 'browser-extension/firefox-release/metadata.json'
  );
  const xpiEntry = manifest.files.find(
    (file) => file.path === 'browser-extension/firefox-release/openpath-firefox-extension.xpi'
  );

  assert.ok(runtimeSpecEntry, 'bootstrap manifest should include runtime/browser-policy-spec.json');
  assert.ok(metadataEntry, 'bootstrap manifest should include Firefox release metadata');
  assert.ok(xpiEntry, 'bootstrap manifest should include the signed Firefox XPI');

  const metadataResponse = await fetchWithRetry(
    `${apiUrl}/api/agent/windows/bootstrap/file?path=${encodeURIComponent('browser-extension/firefox-release/metadata.json')}`,
    {
      headers: authHeaders,
    }
  );
  assert.equal(metadataResponse.status, 200, 'Firefox release metadata should be downloadable');
  const metadata = await metadataResponse.json();
  assert.equal(typeof metadata.extensionId, 'string');
  assert.equal(typeof metadata.version, 'string');
  assert.ok(metadata.extensionId, 'metadata should include extensionId');
  assert.ok(metadata.version, 'metadata should include version');

  const runtimeSpecResponse = await fetchWithRetry(
    `${apiUrl}/api/agent/windows/bootstrap/file?path=${encodeURIComponent('runtime/browser-policy-spec.json')}`,
    {
      headers: authHeaders,
    }
  );
  assert.equal(runtimeSpecResponse.status, 200, 'browser policy spec should be downloadable');
  const runtimeSpec = await runtimeSpecResponse.json();
  assert.ok(runtimeSpec.firefox, 'browser policy spec should include firefox settings');
  assert.ok(runtimeSpec.chromium, 'browser policy spec should include chromium settings');

  const summary = {
    apiUrl,
    requestOrigin,
    email,
    classroomId: classroom.id,
    enrollmentToken: ticketPayload.enrollmentToken,
    windowsScriptUrl: `${apiUrl}/api/enroll/${classroom.id}/windows.ps1`,
    publicFirefoxXpiUrl: `${apiUrl}/api/extensions/firefox/openpath.xpi`,
    extensionId: metadata.extensionId,
    extensionVersion: metadata.version,
    bootstrapManifestVersion: manifest.version ?? '',
  };

  writeFileSync(
    resolve('production-windows-bootstrap-canary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  );

  for (const [key, value] of Object.entries({
    api_url: summary.apiUrl,
    request_origin: summary.requestOrigin,
    email: summary.email,
    classroom_id: summary.classroomId,
    enrollment_token: summary.enrollmentToken,
    windows_script_url: summary.windowsScriptUrl,
    public_firefox_xpi_url: summary.publicFirefoxXpiUrl,
    extension_id: summary.extensionId,
    extension_version: summary.extensionVersion,
    bootstrap_manifest_version: summary.bootstrapManifestVersion,
  })) {
    setGithubOutput(key, value);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

await main();
