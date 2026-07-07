import bcrypt from 'bcrypt';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import {
  deletePasswordResetTokensByUserId,
  replacePasswordResetToken,
} from '../db/openpath-repos/auth-tokens.repo.js';
import { getUserByEmail } from '../db/openpath-repos/users.repo.js';
import { config } from '../config.js';
import { apiCopy, getApiCopy } from '../lib/api-content.js';
import { generateId } from '../lib/id.js';
import {
  deleteAuditEventByIdBestEffort,
  recordResetTokenGeneratedAuditEvent,
} from './audit.service.js';
import { sendTransactionalEmail } from './email.service.js';
import { normalizeEmailAddress } from '../trpc/routers/auth-payloads.js';

function createPasswordResetToken(): string {
  return randomBytes(6).toString('hex');
}

const RESET_DELIVERY_FAILED_MESSAGE = apiCopy.en.errors.resetDeliveryFailed;

export async function generateTenantResetToken(params: {
  organizationId: string;
  email: string;
  actedBy: string;
  locale?: string | null;
}): Promise<{ success: true; emailSent: boolean }> {
  const normalizedEmail = normalizeEmailAddress(params.email);

  const user = await getUserByEmail(normalizedEmail);

  if (!user) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'User not found',
    });
  }

  const membership = await db
    .select({ id: schema.cpMemberships.id })
    .from(schema.cpMemberships)
    .where(
      and(
        eq(schema.cpMemberships.organizationId, params.organizationId),
        eq(schema.cpMemberships.userId, user.id)
      )
    )
    .limit(1);

  if (membership.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'User not found or access denied',
    });
  }

  const token = createPasswordResetToken();
  const tokenHash = await bcrypt.hash(token, 10);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const resetUrl = `${config.publicUrl}/reset-password?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(token)}`;

  await replacePasswordResetToken(user.id, { id: generateId('reset'), tokenHash, expiresAt });

  const resetAuditEventId = await recordResetTokenGeneratedAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.actedBy,
    userId: user.id,
    email: user.email,
  });
  const copy = getApiCopy(params.locale).email;

  try {
    const delivery = await sendTransactionalEmail({
      to: user.email,
      subject: copy.resetSubject,
      text: [
        copy.greeting(user.name),
        '',
        copy.resetIntro,
        copy.resetAction(resetUrl),
        '',
        copy.linkExpires(expiresAt.toISOString()),
      ].join('\n'),
      html: [
        `<p>${copy.greeting(user.name)}</p>`,
        `<p>${copy.resetIntro}</p>`,
        `<p><a href="${resetUrl}">${copy.resetActionLabel}</a></p>`,
        `<p>${copy.linkExpires(`<strong>${expiresAt.toISOString()}</strong>`)}</p>`,
      ].join(''),
    });

    if (!delivery.sent) {
      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: RESET_DELIVERY_FAILED_MESSAGE,
      });
    }

    return {
      success: true,
      emailSent: true,
    };
  } catch (error) {
    await deletePasswordResetTokensByUserId(user.id);
    await deleteAuditEventByIdBestEffort({
      auditEventId: resetAuditEventId,
      action: 'user.reset-token-generated',
      targetId: user.id,
    });

    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: RESET_DELIVERY_FAILED_MESSAGE,
    });
  }
}
