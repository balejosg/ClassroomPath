import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { TRPCError } from '@trpc/server';

import { publicProcedure } from '../trpc.js';
import { openpathDb, openpathSchema } from '../../db/openpath.js';
import { forwardOpenPathAuthProcedure } from '../../lib/openpath-auth-client.js';
import { generateId } from '../../lib/id.js';
import { logger } from '../../lib/logger.js';
import { storeSessionFromPayload } from '../../lib/session-cookies.js';
import { googleLoginOpenPathUser, registerOpenPathUser } from '../../lib/openpath-upstream.js';
import { recordTermsAcceptance } from '../../services/legal-consent.service.js';
import {
  deliverEmailVerification,
  issueOpenPathEmailVerificationToken,
} from './auth-email-delivery.js';
import {
  assertCurrentTermsVersion,
  normalizeDisplayName,
  normalizeEmailAddress,
} from './auth-payloads.js';
import { deliverRegistrationEmailVerification } from './auth-verification-flow.js';

const googleClient = new OAuth2Client();

type OpenPathSignupUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isActive: boolean;
  googleId: string | null;
};

type GoogleIdentity = {
  email: string;
  name: string;
  googleId: string;
};

async function getOpenPathUserByEmail(email: string): Promise<OpenPathSignupUser | null> {
  const [user] = await openpathDb
    .select({
      id: openpathSchema.users.id,
      email: openpathSchema.users.email,
      name: openpathSchema.users.name,
      emailVerified: openpathSchema.users.emailVerified,
      isActive: openpathSchema.users.isActive,
      googleId: openpathSchema.users.googleId,
    })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.email, email))
    .limit(1);

  return user ?? null;
}

async function getOpenPathUserByGoogleId(googleId: string): Promise<OpenPathSignupUser | null> {
  const [user] = await openpathDb
    .select({
      id: openpathSchema.users.id,
      email: openpathSchema.users.email,
      name: openpathSchema.users.name,
      emailVerified: openpathSchema.users.emailVerified,
      isActive: openpathSchema.users.isActive,
      googleId: openpathSchema.users.googleId,
    })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.googleId, googleId))
    .limit(1);

  return user ?? null;
}

function getGoogleClientId(): string {
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!googleClientId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Google OAuth not configured',
    });
  }

  return googleClientId;
}

function getGoogleDisplayName(name: string | undefined, email: string): string {
  const trimmedName = normalizeDisplayName(name ?? '');
  if (trimmedName.length > 0) {
    return trimmedName;
  }

  return email.split('@')[0] ?? 'Google User';
}

async function verifyGoogleIdentity(idToken: string): Promise<GoogleIdentity> {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: getGoogleClientId(),
    });
    const payload = ticket.getPayload();

    if (!payload?.email || !payload.sub) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Invalid Google token',
      });
    }

    const email = normalizeEmailAddress(payload.email);

    return {
      email,
      name: getGoogleDisplayName(payload.name, email),
      googleId: payload.sub,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    logger.warn('Google signup verification failed', {
      error: error instanceof Error ? error.message : String(error),
    });

    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Google authentication failed',
    });
  }
}

async function ensureOpenPathGoogleUser(identity: GoogleIdentity): Promise<OpenPathSignupUser> {
  const googleUser = await getOpenPathUserByGoogleId(identity.googleId);
  if (googleUser) {
    if (!googleUser.isActive) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Account inactive',
      });
    }

    return googleUser;
  }

  const emailUser = await getOpenPathUserByEmail(identity.email);
  if (emailUser) {
    if (!emailUser.isActive) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Account inactive',
      });
    }

    if (emailUser.googleId && emailUser.googleId !== identity.googleId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Google account does not match the linked account',
      });
    }

    await openpathDb
      .update(openpathSchema.users)
      .set({
        googleId: identity.googleId,
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(openpathSchema.users.id, emailUser.id));

    return {
      ...emailUser,
      googleId: identity.googleId,
      emailVerified: true,
    };
  }

  const [createdUser] = await openpathDb
    .insert(openpathSchema.users)
    .values({
      id: generateId('user'),
      email: identity.email,
      name: identity.name,
      googleId: identity.googleId,
      isActive: true,
      emailVerified: true,
    })
    .onConflictDoNothing()
    .returning({
      id: openpathSchema.users.id,
      email: openpathSchema.users.email,
      name: openpathSchema.users.name,
      emailVerified: openpathSchema.users.emailVerified,
      isActive: openpathSchema.users.isActive,
      googleId: openpathSchema.users.googleId,
    });

  if (createdUser) {
    return createdUser;
  }

  const existingUser =
    (await getOpenPathUserByGoogleId(identity.googleId)) ??
    (await getOpenPathUserByEmail(identity.email));

  if (!existingUser) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Google signup failed',
    });
  }

  return existingUser;
}

export const authRegistrationProcedures = {
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

      assertCurrentTermsVersion(input.termsVersion);

      const registration = await registerOpenPathUser({
        req: ctx.req,
        input: {
          email,
          name,
          password: input.password,
        },
        unavailableMessage: 'Registration service unavailable',
        upstreamFailureMessage: 'Registration failed',
      });

      await recordTermsAcceptance({
        userId: registration.user.id,
        termsVersion: input.termsVersion,
      });

      const delivery = await deliverRegistrationEmailVerification({ registration });

      return {
        ...delivery,
        termsVersion: input.termsVersion,
      };
    }),

  googleSignup: publicProcedure
    .input(
      z.object({
        idToken: z.string().min(1),
        termsAccepted: z.literal(true),
        termsVersion: z.string().min(1).max(50),
      })
    )
    .mutation(async ({ input, ctx }) => {
      assertCurrentTermsVersion(input.termsVersion);

      const identity = await verifyGoogleIdentity(input.idToken);
      await ensureOpenPathGoogleUser(identity);

      const session = await googleLoginOpenPathUser({
        req: ctx.req,
        input: { idToken: input.idToken },
        unavailableMessage: 'Authentication service unavailable',
        upstreamFailureMessage: 'Google signup failed',
      });

      await recordTermsAcceptance({
        userId: session.user.id,
        termsVersion: input.termsVersion,
      });

      return storeSessionFromPayload(ctx.res, session);
    }),

  generateEmailVerificationToken: publicProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
      })
    )
    .mutation(async ({ input }) => {
      const email = normalizeEmailAddress(input.email);
      const user = await getOpenPathUserByEmail(email);
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      if (user.emailVerified) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Email is already verified',
        });
      }

      const verification = await issueOpenPathEmailVerificationToken(user.id);

      return deliverEmailVerification({
        email: user.email,
        name: user.name,
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
};
