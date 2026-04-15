import { z } from 'zod';

import { TRPCError } from '@trpc/server';

import { publicProcedure } from '../trpc.js';
import { forwardOpenPathAuthProcedure } from '../../lib/openpath-auth-client.js';
import {
  generateEmailVerificationDelivery,
  registerSelfServiceUser,
  signUpWithGoogle,
} from '../../services/auth-registration.service.js';
import { assertCurrentTermsVersion, normalizeEmailAddress } from './auth-payloads.js';

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
    .mutation(async ({ input, ctx }) =>
      registerSelfServiceUser({
        req: ctx.req,
        email: input.email,
        name: input.name,
        password: input.password,
        termsVersion: input.termsVersion,
      })
    ),

  googleSignup: publicProcedure
    .input(
      z.object({
        idToken: z.string().min(1),
        termsAccepted: z.literal(true),
        termsVersion: z.string().min(1).max(50),
      })
    )
    .mutation(async ({ input, ctx }) =>
      signUpWithGoogle({
        req: ctx.req,
        res: ctx.res,
        idToken: input.idToken,
        termsVersion: input.termsVersion,
      })
    ),

  generateEmailVerificationToken: publicProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
      })
    )
    .mutation(async ({ input }) => generateEmailVerificationDelivery({ email: input.email })),

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
