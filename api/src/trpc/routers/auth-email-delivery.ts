import { randomUUID } from 'node:crypto';

import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';

import { config } from '../../config.js';
import { openpathDb, openpathSchema } from '../../db/openpath.js';
import { getApiCopy } from '../../lib/api-content.js';
import { logger } from '../../lib/logger.js';
import { sendTransactionalEmail } from '../../services/email.service.js';

export interface EmailVerificationDeliveryResult {
  email: string;
  verificationRequired: true;
  emailSent: boolean;
  verificationUrl: string;
  verificationExpiresAt: string;
}

export interface EmailVerificationTokenIssueResult {
  verificationToken: string;
  verificationExpiresAt: string;
}

const EMAIL_VERIFICATION_TTL_HOURS = 24;
const EMAIL_VERIFICATION_BCRYPT_ROUNDS = 12;

function buildEmailVerificationUrl(params: { email: string; token: string }): string {
  return `${config.publicUrl}/login?email=${encodeURIComponent(params.email)}&token=${encodeURIComponent(params.token)}`;
}

export async function issueOpenPathEmailVerificationToken(
  userId: string
): Promise<EmailVerificationTokenIssueResult> {
  const verificationToken = randomUUID().replace(/-/g, '').slice(0, 12);
  const verificationExpiresAt = new Date();
  verificationExpiresAt.setHours(verificationExpiresAt.getHours() + EMAIL_VERIFICATION_TTL_HOURS);

  await openpathDb
    .delete(openpathSchema.emailVerificationTokens)
    .where(eq(openpathSchema.emailVerificationTokens.userId, userId));

  await openpathDb.insert(openpathSchema.emailVerificationTokens).values({
    id: `verify_${randomUUID().slice(0, 8)}`,
    userId,
    tokenHash: await bcrypt.hash(verificationToken, EMAIL_VERIFICATION_BCRYPT_ROUNDS),
    expiresAt: verificationExpiresAt,
  });

  return {
    verificationToken,
    verificationExpiresAt: verificationExpiresAt.toISOString(),
  };
}

export async function deliverEmailVerification(params: {
  email: string;
  locale?: string | null;
  name: string;
  verificationToken: string;
  verificationExpiresAt: string;
}): Promise<EmailVerificationDeliveryResult> {
  const verificationUrl = buildEmailVerificationUrl({
    email: params.email,
    token: params.verificationToken,
  });

  let emailSent = false;
  const copy = getApiCopy(params.locale).email;
  try {
    const delivery = await sendTransactionalEmail({
      to: params.email,
      subject: copy.verificationSubject,
      text: [
        copy.greeting(params.name),
        '',
        copy.verificationIntro,
        copy.verificationAction(verificationUrl),
        '',
        copy.linkExpires(params.verificationExpiresAt),
      ].join('\n'),
      html: [
        `<p>${copy.greeting(params.name)}</p>`,
        `<p>${copy.verificationIntro}</p>`,
        `<p><a href="${verificationUrl}">${copy.verificationActionLabel}</a></p>`,
        `<p>${copy.linkExpires(`<strong>${params.verificationExpiresAt}</strong>`)}</p>`,
      ].join(''),
    });

    emailSent = delivery.sent;
  } catch (error) {
    logger.warn('Email verification delivery failed', {
      email: params.email,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    email: params.email,
    verificationRequired: true,
    emailSent,
    verificationUrl,
    verificationExpiresAt: params.verificationExpiresAt,
  };
}

export async function issueEmailVerificationDelivery(params: {
  userId: string;
  email: string;
  locale?: string | null;
  name: string;
}): Promise<EmailVerificationDeliveryResult> {
  const verification = await issueOpenPathEmailVerificationToken(params.userId);
  return deliverEmailVerification({
    email: params.email,
    locale: params.locale,
    name: params.name,
    verificationToken: verification.verificationToken,
    verificationExpiresAt: verification.verificationExpiresAt,
  });
}
