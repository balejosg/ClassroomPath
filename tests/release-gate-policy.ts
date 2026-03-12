import assert from 'node:assert/strict';

type VerificationDeliveryPayload = {
  email?: unknown;
  verificationRequired?: unknown;
  emailSent?: unknown;
  verificationUrl?: unknown;
  termsVersion?: unknown;
};

type VerificationDeliveryPolicyOptions = {
  context: string;
  expectedOrigin: string;
  expectedTermsVersion?: string;
  payload: VerificationDeliveryPayload;
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

export function assertVerificationDeliveryPolicy(options: VerificationDeliveryPolicyOptions): void {
  assert.equal(
    options.payload.verificationRequired,
    true,
    `${options.context} must return verificationRequired=true`
  );
  assert.equal(options.payload.emailSent, true, `${options.context} must return emailSent=true`);

  const verificationUrl = options.payload.verificationUrl;
  assert.equal(
    typeof verificationUrl,
    'string',
    `${options.context} must return a verificationUrl string`
  );
  assert.ok(
    verificationUrl.length > 0,
    `${options.context} must return a non-empty verificationUrl`
  );

  const parsedUrl = new URL(verificationUrl);
  assert.equal(
    parsedUrl.protocol,
    'https:',
    `${options.context} must return a public verification URL over HTTPS`
  );
  assert.equal(
    LOCAL_HOSTNAMES.has(parsedUrl.hostname),
    false,
    `${options.context} must return a public verification URL, not localhost`
  );
  assert.equal(
    parsedUrl.origin,
    options.expectedOrigin,
    `${options.context} verificationUrl must match the expected origin ${options.expectedOrigin}`
  );
  assert.ok(
    parsedUrl.searchParams.get('token'),
    `${options.context} verificationUrl must include a token`
  );

  if (options.expectedTermsVersion) {
    assert.equal(
      options.payload.termsVersion,
      options.expectedTermsVersion,
      `${options.context} must echo termsVersion=${options.expectedTermsVersion}`
    );
  }
}
