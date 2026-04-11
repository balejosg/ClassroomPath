import { z } from 'zod';
import { TRPCError } from '@trpc/server';

import { protectedProcedure, publicProcedure } from '../trpc.js';
import {
  forwardOpenPathSessionMutation,
  getOpenPathMeProfile,
  logoutOpenPathSession,
} from '../../lib/openpath-auth-client.js';
import { normalizeEmailAddress } from './auth-payloads.js';
import { parseCookieValue, REFRESH_COOKIE_NAME } from '../../lib/session-cookies.js';

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

  refresh: publicProcedure
    .input(z.object({ refreshToken: z.string().min(1).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      const refreshToken =
        input?.refreshToken ??
        parseCookieValue(
          typeof ctx.req.headers.cookie === 'string' ? ctx.req.headers.cookie : undefined,
          REFRESH_COOKIE_NAME
        ) ??
        undefined;

      if (!refreshToken) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Refresh token required' });
      }

      return forwardOpenPathSessionMutation({
        procedure: 'auth.refresh',
        req: ctx.req,
        res: ctx.res,
        input: { refreshToken },
        defaultErrorCode: 'UNAUTHORIZED',
        upstreamFailureMessage: 'Session refresh failed',
        unavailableMessage: 'Authentication service unavailable',
      });
    }),

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
