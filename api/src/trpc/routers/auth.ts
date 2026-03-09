import bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { router, publicProcedure, protectedProcedure, tenantProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import {
  forwardOpenPathAuthProcedure,
  forwardOpenPathSessionMutation,
  getOpenPathMeProfile,
  logoutOpenPathSession,
} from '../../lib/openpath-auth-client.js';
import { callOpenPathTrpc } from '../../lib/openpath-upstream.js';
import { storeSessionFromPayload } from '../../lib/session-cookies.js';
import {
  acceptOrganizationInvitation,
  getInvitationByToken,
} from '../../services/invitations.service.js';
import { synchronizeOpenPathRole } from '../../lib/openpath-roles.js';
import { assertOrgAdminTenantProcedureContext } from '../tenant-procedure-helpers.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import { openpathDb, openpathSchema } from '../../db/openpath.js';
import { generateId } from '../../lib/id.js';
import { config } from '../../config.js';
import { sendTransactionalEmail } from '../../services/email.service.js';

type OpenPathSessionPayload = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    roles?: unknown;
  };
};

function parseOpenPathSessionPayload(payload: unknown): OpenPathSessionPayload {
  if (!payload || typeof payload !== 'object') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Invalid registration payload received from upstream',
    });
  }

  const candidate = payload as Record<string, unknown>;
  const user = candidate.user;

  if (
    typeof candidate.accessToken !== 'string' ||
    typeof candidate.refreshToken !== 'string' ||
    !user ||
    typeof user !== 'object'
  ) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Invalid registration payload received from upstream',
    });
  }

  const userRecord = user as Record<string, unknown>;
  if (
    typeof userRecord.id !== 'string' ||
    typeof userRecord.email !== 'string' ||
    typeof userRecord.name !== 'string'
  ) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Invalid registration payload received from upstream',
    });
  }

  return {
    accessToken: candidate.accessToken,
    refreshToken: candidate.refreshToken,
    user: {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      roles: userRecord.roles,
    },
  };
}

function createPasswordResetToken(): string {
  return randomBytes(6).toString('hex');
}

async function generateTenantResetToken(params: {
  organizationId: string;
  email: string;
}): Promise<{ success: true; emailSent: boolean; resetUrl: string }> {
  const normalizedEmail = params.email.trim().toLowerCase();

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
      'Tu administrador generó un enlace para restablecer tu acceso a ClassroomPath.',
      `Úsalo aquí: ${resetUrl}`,
      '',
      `Este enlace vence el ${expiresAt.toISOString()}.`,
    ].join('\n'),
    html: [
      `<p>Hola ${user.name},</p>`,
      '<p>Tu administrador generó un enlace para restablecer tu acceso a ClassroomPath.</p>',
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

export const authRouter = router({
  /**
   * Login endpoint - forwards to OpenPath API
   */
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) =>
      forwardOpenPathSessionMutation({
        procedure: 'auth.login',
        req: ctx.req,
        res: ctx.res,
        input,
        defaultErrorCode: 'UNAUTHORIZED',
        upstreamFailureMessage: 'Login failed',
        unavailableMessage: 'Authentication service unavailable',
      })
    ),

  /**
   * Register endpoint - forwards to OpenPath API
   */
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(2),
        password: z.string().min(8),
      })
    )
    .mutation(async ({ input, ctx }) =>
      forwardOpenPathSessionMutation({
        procedure: 'auth.register',
        req: ctx.req,
        res: ctx.res,
        input,
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Registration failed',
        unavailableMessage: 'Registration service unavailable',
      })
    ),

  getInvitation: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const invitation = await getInvitationByToken(input.token);
      if (!invitation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found or expired',
        });
      }

      return invitation;
    }),

  acceptInvitation: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        password: z.string().min(8),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const invitation = await getInvitationByToken(input.token);
      if (!invitation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found or expired',
        });
      }

      const payload = await callOpenPathTrpc({
        procedure: 'auth.register',
        req: ctx.req,
        input: {
          email: invitation.email,
          name: invitation.name,
          password: input.password,
        },
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Invitation activation failed',
        unavailableMessage: 'Registration service unavailable',
      });

      const sessionPayload = parseOpenPathSessionPayload(payload);

      await acceptOrganizationInvitation({
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        userId: sessionPayload.user.id,
        invitedBy: invitation.invitedBy,
        role: invitation.role,
      });

      await synchronizeOpenPathRole({
        userId: sessionPayload.user.id,
        actedBy: invitation.invitedBy,
        groupIds: [],
      });

      return storeSessionFromPayload(ctx.res, sessionPayload);
    }),

  /**
   * Google login endpoint - forwards to OpenPath API
   */
  googleLogin: publicProcedure
    .input(
      z.object({
        idToken: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) =>
      forwardOpenPathSessionMutation({
        procedure: 'auth.googleLogin',
        req: ctx.req,
        res: ctx.res,
        input,
        defaultErrorCode: 'UNAUTHORIZED',
        upstreamFailureMessage: 'Google login failed',
        unavailableMessage: 'Authentication service unavailable',
      })
    ),

  /**
   * Get current user profile - forwards to OpenPath API
   */
  me: protectedProcedure.query(async ({ ctx }) =>
    getOpenPathMeProfile({
      req: ctx.req,
      token: ctx.token,
    })
  ),

  generateResetToken: tenantProcedure
    .input(
      z.object({
        email: z.string().email(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
      return generateTenantResetToken({
        organizationId: ctx.organizationId,
        email: input.email,
      });
    }),

  /**
   * Reset password - forwards to OpenPath API
   */
  resetPassword: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        token: z.string(),
        newPassword: z.string().min(8),
      })
    )
    .mutation(async ({ input, ctx }) =>
      forwardOpenPathAuthProcedure({
        procedure: 'auth.resetPassword',
        req: ctx.req,
        input,
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Password reset failed',
        unavailableMessage: 'Authentication service unavailable',
      })
    ),

  /**
   * Logout endpoint - clears cookie session and forwards token invalidation to OpenPath API
   */
  logout: protectedProcedure.mutation(async ({ ctx }) =>
    logoutOpenPathSession({
      req: ctx.req,
      res: ctx.res,
      token: ctx.token,
    })
  ),
});
