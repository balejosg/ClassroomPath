import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CURRENT_TERMS_VERSION } from '../api/src/services/legal-consent.service.js';
import { resolvedFetch } from './helpers/resolved-fetch.js';
import { assertVerificationDeliveryPolicy } from './release-gate-policy.js';

type TrpcEnvelope<T> = {
  result?: {
    data?: {
      json?: T;
    };
  };
  error?: unknown;
};

type VerificationPayload = {
  email?: string;
  verificationRequired?: boolean;
  emailSent?: boolean;
  verificationUrl?: string;
  termsVersion?: string;
};

const RELEASE_GATE_URL = process.env.RELEASE_GATE_URL;
const RELEASE_GATE_EXPECTED_ORIGIN =
  process.env.RELEASE_GATE_EXPECTED_ORIGIN ??
  (RELEASE_GATE_URL ? new URL(RELEASE_GATE_URL).origin : '');
const RELEASE_GATE_REQUEST_ORIGIN =
  process.env.RELEASE_GATE_REQUEST_ORIGIN ?? RELEASE_GATE_EXPECTED_ORIGIN;
const RELEASE_GATE_TIMEOUT = Number.parseInt(process.env.RELEASE_GATE_TIMEOUT ?? '30000', 10);
const RELEASE_GATE_ALLOW_MUTATIONS = process.env.RELEASE_GATE_ALLOW_MUTATIONS === '1';
const RELEASE_GATE_RESOLVED_ADDRESS = process.env.RELEASE_GATE_RESOLVED_ADDRESS;

function uniqueReleaseGateEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = RELEASE_GATE_TIMEOUT
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await resolvedFetch(
      input,
      {
        ...init,
        signal: controller.signal,
      },
      {
        resolvedAddress: RELEASE_GATE_RESOLVED_ADDRESS,
        timeoutMs,
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(
  input: string,
  init: RequestInit = {},
  attempts = 3
): Promise<Response> {
  let lastError: unknown;

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

async function postTrpc<T>(procedure: string, payload: Record<string, unknown>): Promise<T> {
  assert.ok(RELEASE_GATE_URL, 'RELEASE_GATE_URL must be set');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (RELEASE_GATE_REQUEST_ORIGIN) {
    headers.Origin = RELEASE_GATE_REQUEST_ORIGIN;
  }

  const response = await fetchWithRetry(`${RELEASE_GATE_URL}/cp/trpc/${procedure}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  assert.strictEqual(response.status, 200, `${procedure} returned ${response.status}`);

  const raw = (await response.json()) as TrpcEnvelope<T> | Array<TrpcEnvelope<T>>;
  const envelope = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(!envelope?.error, `${procedure} returned tRPC error ${JSON.stringify(raw)}`);
  assert.ok(envelope?.result?.data, `${procedure} returned no result data`);

  const data = envelope.result?.data as T | { json?: T } | undefined;
  const json =
    data && typeof data === 'object' && 'json' in data ? (data.json as T | undefined) : (data as T);
  assert.ok(json, `${procedure} returned no JSON payload`);
  return json;
}

function getVerificationToken(verificationUrl: string): string {
  const token = new URL(verificationUrl).searchParams.get('token');
  assert.ok(token, 'verificationUrl must include a token');
  return token;
}

async function registerFreshUser(email = uniqueReleaseGateEmail('release-gate')) {
  const payload = await postTrpc<VerificationPayload>('auth.register', {
    email,
    name: 'Release Gate User',
    password: 'ReleaseGate123!',
    termsAccepted: true,
    termsVersion: CURRENT_TERMS_VERSION,
  });

  assertVerificationDeliveryPolicy({
    context: 'auth.register',
    expectedOrigin: RELEASE_GATE_EXPECTED_ORIGIN,
    expectedTermsVersion: CURRENT_TERMS_VERSION,
    payload,
  });

  assert.strictEqual(payload.email, email);
  return { email, payload };
}

describe(
  'Production release gate',
  {
    skip: !RELEASE_GATE_URL || !RELEASE_GATE_ALLOW_MUTATIONS,
  },
  () => {
    test('auth.register returns a launch-safe verification payload', async () => {
      await registerFreshUser();
    });

    test('auth.generateEmailVerificationToken returns a fresh public verification link', async () => {
      const { email, payload: registrationPayload } = await registerFreshUser(
        uniqueReleaseGateEmail('release-gate-resend')
      );
      const resendPayload = await postTrpc<VerificationPayload>(
        'auth.generateEmailVerificationToken',
        {
          email,
        }
      );

      assertVerificationDeliveryPolicy({
        context: 'auth.generateEmailVerificationToken',
        expectedOrigin: RELEASE_GATE_EXPECTED_ORIGIN,
        payload: resendPayload,
      });
      assert.strictEqual(resendPayload.email, email);
      assert.notStrictEqual(
        getVerificationToken(resendPayload.verificationUrl!),
        getVerificationToken(registrationPayload.verificationUrl!),
        'resend verification should issue a fresh token'
      );
    });
  }
);
