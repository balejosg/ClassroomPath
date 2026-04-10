import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { CURRENT_TERMS_VERSION } from '../api/src/services/legal-consent.service.js';
import { createReleaseGateClient, getVerificationToken } from './helpers/release-gate-client.js';
import { assertVerificationDeliveryPolicy } from './release-gate-policy.js';

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

const releaseGateClient = RELEASE_GATE_URL
  ? createReleaseGateClient({
      baseUrl: RELEASE_GATE_URL,
      expectedOrigin: RELEASE_GATE_EXPECTED_ORIGIN,
      requestOrigin: RELEASE_GATE_REQUEST_ORIGIN,
      resolvedAddress: RELEASE_GATE_RESOLVED_ADDRESS,
      timeoutMs: RELEASE_GATE_TIMEOUT,
    })
  : null;

async function postTrpc<T>(procedure: string, payload: Record<string, unknown>): Promise<T> {
  assert.ok(releaseGateClient, 'RELEASE_GATE_URL must be set');
  return releaseGateClient.postTrpc<T>(procedure, payload);
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
