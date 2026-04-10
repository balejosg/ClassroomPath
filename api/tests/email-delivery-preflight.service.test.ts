import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EmailDeliveryProviderError } from '../src/services/email.service.js';
import { checkTransactionalEmailDelivery } from '../src/services/email-delivery-preflight.service.js';

describe('email delivery preflight', () => {
  it('passes only when a real Resend delivery succeeds', async () => {
    const result = await checkTransactionalEmailDelivery({
      now: () => 1234567890,
      sendEmail: async (params) => ({
        sent: true,
        provider: 'resend',
        id: `sent-to-${params.to}`,
      }),
    });

    assert.deepEqual(result, {
      ok: true,
      code: 'success',
      provider: 'resend',
      id: 'sent-to-delivered+cpdiag1234567890@resend.dev',
    });
  });

  it('fails when delivery is mocked or disabled', async () => {
    const result = await checkTransactionalEmailDelivery({
      now: () => 1234567890,
      sendEmail: async () => ({
        sent: true,
        provider: 'mock',
        id: 'mock-email',
      }),
    });

    assert.deepEqual(result, {
      ok: false,
      code: 'provider_mismatch',
      provider: 'mock',
    });
  });

  it('classifies provider failures without exposing credentials', async () => {
    const result = await checkTransactionalEmailDelivery({
      now: () => 1234567890,
      sendEmail: async () => {
        throw new EmailDeliveryProviderError('Email delivery failed', {
          status: 404,
          body: '{"status":"error","message":"Application not found","request_id":"abc"}',
        });
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'provider_application_not_found');
    assert.equal(result.provider, 'resend');
    assert.equal(result.status, 404);
    assert.match(result.message ?? '', /Application not found/);
    assert.doesNotMatch(JSON.stringify(result), /Bearer|re_[A-Za-z0-9]/);
  });
});
