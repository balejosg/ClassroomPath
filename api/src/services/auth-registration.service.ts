/**
 * Self-service user registration and Google OAuth sign-up service.
 *
 * Owns the multi-step flow that lands a new user in the system: validate
 * terms version, register the account in the upstream OpenPath database,
 * record the ClassroomPath terms-acceptance row, and trigger email
 * verification delivery.  Also handles Google OAuth sign-up, which includes
 * identity verification via google-auth-library, upsert of the OpenPath user
 * row, and session cookie issuance via api/src/lib/session-cookies.ts.
 *
 * Consumed by the auth tRPC routers under api/src/trpc/routers/auth*.ts.
 *
 * Non-obvious constraint: Google sign-up calls googleLoginOpenPathUser on the
 * upstream AFTER ensureOpenPathGoogleUser completes the upsert -- if the
 * upstream login step fails after the local upsert succeeds the user row will
 * exist without a session cookie, so callers should not treat the upsert as
 * evidence of a complete login.
 */
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { TRPCError } from '@trpc/server';

import { openpathDb, openpathSchema } from '../db/openpath.js';
import { generateId } from '../lib/id.js';
import { logger } from '../lib/logger.js';
import { storeSessionFromPayload } from '../lib/session-cookies.js';
import type { SessionClientMode } from '../lib/session-cookies.js';
import { googleLoginOpenPathUser, registerOpenPathUser } from '../lib/openpath/auth-client.js';
import { recordTermsAcceptance } from './legal-consent.service.js';
import {
  deliverEmailVerification,
  issueOpenPathEmailVerificationToken,
} from '../trpc/routers/auth-email-delivery.js';
import {
  assertCurrentTermsVersion,
  normalizeDisplayName,
  normalizeEmailAddress,
} from '../trpc/routers/auth-payloads.js';
import { deliverRegistrationEmailVerification } from '../trpc/routers/auth-verification-flow.js';

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

export async function registerSelfServiceUser(params: {
  req: { headers: Record<string, unknown> };
  email: string;
  name: string;
  password: string;
  termsVersion: string;
}) {
  const email = normalizeEmailAddress(params.email);
  const name = normalizeDisplayName(params.name);

  assertCurrentTermsVersion(params.termsVersion);

  const registration = await registerOpenPathUser({
    req: params.req,
    input: {
      email,
      name,
      password: params.password,
    },
    unavailableMessage: 'Registration service unavailable',
    upstreamFailureMessage: 'Registration failed',
  });

  await recordTermsAcceptance({
    userId: registration.user.id,
    termsVersion: params.termsVersion,
  });

  const delivery = await deliverRegistrationEmailVerification({ registration });

  return {
    ...delivery,
    termsVersion: params.termsVersion,
  };
}

export async function signUpWithGoogle(params: {
  req: { headers: Record<string, unknown> };
  res: Pick<Response, 'cookie'>;
  idToken: string;
  termsVersion: string;
  clientMode: SessionClientMode;
}) {
  assertCurrentTermsVersion(params.termsVersion);

  const identity = await verifyGoogleIdentity(params.idToken);
  await ensureOpenPathGoogleUser(identity);

  const session = await googleLoginOpenPathUser({
    req: params.req,
    input: { idToken: params.idToken },
    unavailableMessage: 'Authentication service unavailable',
    upstreamFailureMessage: 'Google signup failed',
  });

  await recordTermsAcceptance({
    userId: session.user.id,
    termsVersion: params.termsVersion,
  });

  return storeSessionFromPayload(params.res, session, { clientMode: params.clientMode });
}

export async function generateEmailVerificationDelivery(params: { email: string }) {
  const email = normalizeEmailAddress(params.email);
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
}
