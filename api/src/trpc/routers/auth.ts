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
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';
import { sendTransactionalEmail } from '../../services/email.service.js';
import {
  CURRENT_TERMS_VERSION,
  recordTermsAcceptance,
} from '../../services/legal-consent.service.js';

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

type OpenPathRegistrationPayload = {
  user: {
    id: string;
    email: string;
    name: string;
    roles?: unknown;
  };
  verificationRequired: true;
  verificationToken: string;
  verificationExpiresAt: string;
};

type OpenPathEmailVerificationPayload = {
  email: string;
  verificationRequired: true;
  verificationToken: string;
  verificationExpiresAt: string;
};

function parseOpenPathSessionPayload(payload: unknown): OpenPathSessionPayload {
  if (!payload || typeof payload !== 'object') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Invalid session payload received from upstream',
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
      message: 'Invalid session payload received from upstream',
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
      message: 'Invalid session payload received from upstream',
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

function parseOpenPathRegistrationPayload(payload: unknown): OpenPathRegistrationPayload {
  if (!payload || typeof payload !== 'object') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Invalid registration payload received from upstream',
    });
  }

  const candidate = payload as Record<string, unknown>;
  const user = candidate.user;

  if (
    candidate.verificationRequired !== true ||
    typeof candidate.verificationToken !== 'string' ||
    typeof candidate.verificationExpiresAt !== 'string' ||
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
    verificationRequired: true,
    verificationToken: candidate.verificationToken,
    verificationExpiresAt: candidate.verificationExpiresAt,
    user: {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      roles: userRecord.roles,
    },
  };
}

function parseOpenPathEmailVerificationPayload(payload: unknown): OpenPathEmailVerificationPayload {
  if (!payload || typeof payload !== 'object') {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Invalid email verification payload received from upstream',
    });
  }

  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.email !== 'string' ||
    candidate.verificationRequired !== true ||
    typeof candidate.verificationToken !== 'string' ||
    typeof candidate.verificationExpiresAt !== 'string'
  ) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Invalid email verification payload received from upstream',
    });
  }

  return {
    email: candidate.email,
    verificationRequired: true,
    verificationToken: candidate.verificationToken,
    verificationExpiresAt: candidate.verificationExpiresAt,
  };
}

function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(name: string): string {
  return name.trim();
}

function createPasswordResetToken(): string {
  return randomBytes(6).toString('hex');
}

function buildEmailVerificationUrl(params: { email: string; token: string }): string {
  return `${config.publicUrl}/login?email=${encodeURIComponent(params.email)}&token=${encodeURIComponent(params.token)}`;
}

async function getOpenPathUserByEmail(email: string): Promise<{
  id: string;
  email: string;
  name: string;
} | null> {
  const [user] = await openpathDb
    .select({
      id: openpathSchema.users.id,
      email: openpathSchema.users.email,
      name: openpathSchema.users.name,
    })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.email, email))
    .limit(1);

  return user ?? null;
}

async function deliverEmailVerification(params: {
  email: string;
  name: string;
  verificationToken: string;
  verificationExpiresAt: string;
}): Promise<{
  email: string;
  verificationRequired: true;
  emailSent: boolean;
  verificationUrl: string;
  verificationExpiresAt: string;
}> {
  const verificationUrl = buildEmailVerificationUrl({
    email: params.email,
    token: params.verificationToken,
  });

  let emailSent = false;
  try {
    const delivery = await sendTransactionalEmail({
      to: params.email,
      subject: 'Verifica tu correo de ClassroomPath',
      text: [
        `Hola ${params.name},`,
        '',
        'Tu cuenta de ClassroomPath ya esta creada.',
        `Verifica tu correo aqui: ${verificationUrl}`,
        '',
        `Este enlace vence el ${params.verificationExpiresAt}.`,
      ].join('\n'),
      html: [
        `<p>Hola ${params.name},</p>`,
        '<p>Tu cuenta de ClassroomPath ya esta creada.</p>',
        `<p><a href="${verificationUrl}">Verificar correo</a></p>`,
        `<p>Este enlace vence el <strong>${params.verificationExpiresAt}</strong>.</p>`,
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
        email: z.string().trim().email(),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) =>
      forwardOpenPathSessionMutation({
        procedure: 'auth.login',
        req: ctx.req,
        res: ctx.res,
        input: {
          email: normalizeEmailAddress(input.email),
          password: input.password,
        },
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
        email: z.string().trim().email(),
        name: z.string().trim().min(2),
        password: z.string().min(8),
        termsAccepted: z.literal(true),
        termsVersion: z.string().min(1).max(50),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const email = normalizeEmailAddress(input.email);
      const name = normalizeDisplayName(input.name);

      if (input.termsVersion !== CURRENT_TERMS_VERSION) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Debes aceptar la version vigente de los terminos',
        });
      }

      const payload = await callOpenPathTrpc({
        procedure: 'auth.register',
        req: ctx.req,
        input: {
          email,
          name,
          password: input.password,
        },
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Registration failed',
        unavailableMessage: 'Registration service unavailable',
      });

      const registration = parseOpenPathRegistrationPayload(payload);

      await recordTermsAcceptance({
        userId: registration.user.id,
        termsVersion: input.termsVersion,
      });

      const delivery = await deliverEmailVerification({
        email: registration.user.email,
        name: registration.user.name,
        verificationToken: registration.verificationToken,
        verificationExpiresAt: registration.verificationExpiresAt,
      });

      return {
        ...delivery,
        termsVersion: input.termsVersion,
      };
    }),

  generateEmailVerificationToken: publicProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const email = normalizeEmailAddress(input.email);
      const payload = await callOpenPathTrpc({
        procedure: 'auth.generateEmailVerificationToken',
        req: ctx.req,
        input: { email },
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Verification token generation failed',
        unavailableMessage: 'Authentication service unavailable',
      });

      const verification = parseOpenPathEmailVerificationPayload(payload);
      const user = await getOpenPathUserByEmail(email);

      return deliverEmailVerification({
        email: verification.email,
        name: user?.name ?? verification.email,
        verificationToken: verification.verificationToken,
        verificationExpiresAt: verification.verificationExpiresAt,
      });
    }),

  verifyEmail: publicProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
        token: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) =>
      forwardOpenPathAuthProcedure({
        procedure: 'auth.verifyEmail',
        req: ctx.req,
        input: {
          email: normalizeEmailAddress(input.email),
          token: input.token,
        },
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Email verification failed',
        unavailableMessage: 'Authentication service unavailable',
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
        termsAccepted: z.literal(true),
        termsVersion: z.string().min(1).max(50),
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

      if (input.termsVersion !== CURRENT_TERMS_VERSION) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Debes aceptar la version vigente de los terminos',
        });
      }

      const registrationPayload = await callOpenPathTrpc({
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

      const registration = parseOpenPathRegistrationPayload(registrationPayload);

      await recordTermsAcceptance({
        userId: registration.user.id,
        termsVersion: input.termsVersion,
      });

      await callOpenPathTrpc({
        procedure: 'auth.verifyEmail',
        req: ctx.req,
        input: {
          email: invitation.email,
          token: registration.verificationToken,
        },
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Invitation activation failed',
        unavailableMessage: 'Authentication service unavailable',
      });

      await acceptOrganizationInvitation({
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        userId: registration.user.id,
        invitedBy: invitation.invitedBy,
        role: invitation.role,
      });

      await synchronizeOpenPathRole({
        userId: registration.user.id,
        actedBy: invitation.invitedBy,
        groupIds: [],
      });

      const loginPayload = await callOpenPathTrpc({
        procedure: 'auth.login',
        req: ctx.req,
        input: {
          email: invitation.email,
          password: input.password,
        },
        defaultErrorCode: 'UNAUTHORIZED',
        upstreamFailureMessage: 'Invitation activation failed',
        unavailableMessage: 'Authentication service unavailable',
      });

      const sessionPayload = parseOpenPathSessionPayload(loginPayload);
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
        email: z.string().trim().email(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
      return generateTenantResetToken({
        organizationId: ctx.organizationId,
        email: normalizeEmailAddress(input.email),
      });
    }),

  /**
   * Reset password - forwards to OpenPath API
   */
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
