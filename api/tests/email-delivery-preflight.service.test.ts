import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EmailDeliveryProviderError } from '../src/services/email.service.js';
import {
  checkTransactionalEmailDelivery,
  shouldAcceptEmailPreflightFailure,
} from '../src/services/email-delivery-preflight.service.js';

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

  it('retries transient provider failures before succeeding', async () => {
    let attempts = 0;

    const result = await checkTransactionalEmailDelivery({
      now: () => 1234567890,
      retryDelayMs: 0,
      sendEmail: async (params) => {
        attempts += 1;

        if (attempts < 3) {
          throw new EmailDeliveryProviderError('Email delivery failed', {
            status: 408,
            body: 'Operation timed out. Please try again later.',
          });
        }

        return {
          sent: true,
          provider: 'resend',
          id: `sent-to-${params.to}`,
        };
      },
    });

    assert.equal(attempts, 3);
    assert.deepEqual(result, {
      ok: true,
      code: 'success',
      provider: 'resend',
      id: 'sent-to-delivered+cpdiag1234567890@resend.dev',
    });
  });

  it('returns provider_unavailable after exhausting transient retries', async () => {
    let attempts = 0;

    const result = await checkTransactionalEmailDelivery({
      now: () => 1234567890,
      retryDelayMs: 0,
      sendEmail: async () => {
        attempts += 1;
        throw new EmailDeliveryProviderError('Email delivery failed', {
          status: 408,
          body: 'Operation timed out. Please try again later.',
        });
      },
    });

    assert.equal(attempts, 3);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'provider_unavailable');
    assert.equal(result.provider, 'resend');
    assert.equal(result.status, 408);
  });

  it('classifies Resend daily quota exhaustion separately after retries are exhausted', async () => {
    let attempts = 0;

    const result = await checkTransactionalEmailDelivery({
      now: () => 1234567890,
      retryDelayMs: 0,
      sendEmail: async () => {
        attempts += 1;
        throw new EmailDeliveryProviderError('Email delivery failed', {
          status: 429,
          body: '{"statusCode":429,"message":"You have reached your daily email sending quota.","name":"daily_quota_exceeded"}',
        });
      },
    });

    assert.equal(attempts, 3);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'provider_daily_quota_exceeded');
    assert.equal(result.provider, 'resend');
    assert.equal(result.status, 429);
    assert.match(result.message ?? '', /daily email sending quota/);
  });

  it('keeps non-quota 429 provider failures unavailable', async () => {
    const result = await checkTransactionalEmailDelivery({
      now: () => 1234567890,
      maxAttempts: 1,
      retryDelayMs: 0,
      sendEmail: async () => {
        throw new EmailDeliveryProviderError('Email delivery failed', {
          status: 429,
          body: '{"statusCode":429,"message":"Rate limit exceeded","name":"rate_limit_exceeded"}',
        });
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'provider_unavailable');
    assert.equal(result.provider, 'resend');
    assert.equal(result.status, 429);
  });

  it('only accepts daily quota failures when the deploy policy flag is enabled', () => {
    const dailyQuotaResult = {
      ok: false as const,
      code: 'provider_daily_quota_exceeded' as const,
      provider: 'resend' as const,
      status: 429,
      message: 'daily_quota_exceeded',
    };

    assert.equal(
      shouldAcceptEmailPreflightFailure(dailyQuotaResult, {
        CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA: '1',
      }),
      true
    );
    assert.equal(shouldAcceptEmailPreflightFailure(dailyQuotaResult, {}), false);
    assert.equal(
      shouldAcceptEmailPreflightFailure(
        { ...dailyQuotaResult, code: 'provider_unavailable' },
        { CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA: '1' }
      ),
      false
    );
  });
});
