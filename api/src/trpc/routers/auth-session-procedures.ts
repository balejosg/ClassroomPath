import { z } from 'zod';

import { protectedProcedure, publicProcedure } from '../trpc.js';
import {
  forwardOpenPathSessionMutation,
  getOpenPathMeProfile,
  logoutOpenPathSession,
} from '../../lib/openpath-auth-client.js';
import { normalizeEmailAddress } from './auth-payloads.js';

export const authSessionProcedures = {
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

  me: protectedProcedure.query(async ({ ctx }) =>
    getOpenPathMeProfile({
      req: ctx.req,
      token: ctx.token,
    })
  ),

  logout: protectedProcedure.mutation(async ({ ctx }) =>
    logoutOpenPathSession({
      req: ctx.req,
      res: ctx.res,
      token: ctx.token,
    })
  ),
};
