import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { publicProcedure } from '../trpc.js';
import { openpathDb, openpathSchema } from '../../db/openpath.js';
import { forwardOpenPathAuthProcedure } from '../../lib/openpath-auth-client.js';
import { callOpenPathTrpc } from '../../lib/openpath-upstream.js';
import { recordTermsAcceptance } from '../../services/legal-consent.service.js';
import { deliverEmailVerification, issueEmailVerificationDelivery } from './auth-email-delivery.js';
import {
  assertCurrentTermsVersion,
  normalizeDisplayName,
  normalizeEmailAddress,
  parseOpenPathEmailVerificationPayload,
  parseOpenPathRegistrationPayload,
} from './auth-payloads.js';

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

      const delivery =
        typeof registration.verificationToken === 'string' &&
        typeof registration.verificationExpiresAt === 'string'
          ? await deliverEmailVerification({
              email: registration.user.email,
              name: registration.user.name,
              verificationToken: registration.verificationToken,
              verificationExpiresAt: registration.verificationExpiresAt,
            })
          : await issueEmailVerificationDelivery({
              userId: registration.user.id,
              email: registration.user.email,
              name: registration.user.name,
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
};
