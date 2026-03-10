import bcrypt from 'bcrypt';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { openpathDb, openpathSchema } from '../../db/openpath.js';
import { config } from '../../config.js';
import { generateId } from '../../lib/id.js';
import { forwardOpenPathAuthProcedure } from '../../lib/openpath-auth-client.js';
import { sendTransactionalEmail } from '../../services/email.service.js';
import { assertOrgAdminTenantProcedureContext } from '../tenant-procedure-helpers.js';
import { publicProcedure, tenantProcedure } from '../trpc.js';
import { normalizeEmailAddress } from './auth-payloads.js';

function createPasswordResetToken(): string {
  return randomBytes(6).toString('hex');
}

async function generateTenantResetToken(params: {
  organizationId: string;
  email: string;
}): Promise<{ success: true; emailSent: boolean; resetUrl: string }> {
  const normalizedEmail = normalizeEmailAddress(params.email);

  const [user] = await openpathDb
    .select({
      id: openpathSchema.users.id,
      email: openpathSchema.users.email,
      name: openpathSchema.users.name,
    })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.email, normalizedEmail))
    .limit(1);

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

  await openpathDb
    .delete(openpathSchema.passwordResetTokens)
    .where(eq(openpathSchema.passwordResetTokens.userId, user.id));

  await openpathDb.insert(openpathSchema.passwordResetTokens).values({
    id: generateId('reset'),
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  const delivery = await sendTransactionalEmail({
    to: user.email,
    subject: 'Restablece tu acceso a ClassroomPath',
    text: [
      `Hola ${user.name},`,
      '',
      'Tu administrador genero un enlace para restablecer tu acceso a ClassroomPath.',
      `Usalo aqui: ${resetUrl}`,
      '',
      `Este enlace vence el ${expiresAt.toISOString()}.`,
    ].join('\n'),
    html: [
      `<p>Hola ${user.name},</p>`,
      '<p>Tu administrador genero un enlace para restablecer tu acceso a ClassroomPath.</p>',
      `<p><a href="${resetUrl}">Restablecer acceso</a></p>`,
      `<p>Este enlace vence el <strong>${expiresAt.toISOString()}</strong>.</p>`,
    ].join(''),
  });

  return {
    success: true,
    emailSent: delivery.sent,
    resetUrl,
  };
}

export const authRecoveryProcedures = {
  generateResetToken: tenantProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
      return generateTenantResetToken({
        organizationId: ctx.organizationId,
        email: input.email,
      });
    }),

  resetPassword: publicProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
        token: z.string(),
        newPassword: z.string().min(8),
      })
    )
    .mutation(async ({ input, ctx }) =>
      forwardOpenPathAuthProcedure({
        procedure: 'auth.resetPassword',
        req: ctx.req,
        input: {
          email: normalizeEmailAddress(input.email),
          token: input.token,
          newPassword: input.newPassword,
        },
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Password reset failed',
        unavailableMessage: 'Authentication service unavailable',
      })
    ),
};
