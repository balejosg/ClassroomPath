import { z } from 'zod';
import { TRPCError } from '@trpc/server';

import { protectedProcedure, publicProcedure } from '../trpc.js';
import {
  forwardOpenPathAuthProcedure,
  forwardOpenPathSessionMutation,
  getOpenPathMeProfile,
  logoutOpenPathSession,
} from '../../lib/openpath-auth-client.js';
import { normalizeEmailAddress } from './auth-payloads.js';
import {
  normalizeSessionClientMode,
  parseCookieValue,
  parseSessionClientMode,
  REFRESH_COOKIE_NAME,
} from '../../lib/session-cookies.js';

const clientModeInput = z.enum(['web', 'app']).optional();

export const authSessionProcedures = {
  login: publicProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
        password: z.string().min(1),
        clientMode: clientModeInput,
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
        session: { clientMode: input.clientMode ?? 'web' },
        defaultErrorCode: 'UNAUTHORIZED',
        upstreamFailureMessage: 'Login failed',
        unavailableMessage: 'Authentication service unavailable',
      })
    ),

  refresh: publicProcedure
    .input(
      z
        .object({
          refreshToken: z.string().min(1).optional(),
          clientMode: clientModeInput,
        })
        .optional()
    )
    .mutation(async ({ input, ctx }) => {
      const cookieHeader =
        typeof ctx.req.headers.cookie === 'string' ? ctx.req.headers.cookie : undefined;
      const refreshToken =
        input?.refreshToken ?? parseCookieValue(cookieHeader, REFRESH_COOKIE_NAME) ?? undefined;
      const clientMode = input?.clientMode ?? parseSessionClientMode(cookieHeader) ?? 'web';

      if (!refreshToken) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Refresh token required' });
      }

      return forwardOpenPathSessionMutation({
        procedure: 'auth.refresh',
        req: ctx.req,
        res: ctx.res,
        input: { refreshToken },
        session: { clientMode },
        defaultErrorCode: 'UNAUTHORIZED',
        upstreamFailureMessage: 'Session refresh failed',
        unavailableMessage: 'Authentication service unavailable',
      });
    }),

  googleLogin: publicProcedure
    .input(
      z.object({
        idToken: z.string().min(1),
        clientMode: clientModeInput,
      })
    )
    .mutation(async ({ input, ctx }) =>
      forwardOpenPathSessionMutation({
        procedure: 'auth.googleLogin',
        req: ctx.req,
        res: ctx.res,
        input: {
          idToken: input.idToken,
        },
        session: { clientMode: normalizeSessionClientMode(input.clientMode) ?? 'web' },
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

  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8),
      })
    )
    .mutation(async ({ input, ctx }) =>
      forwardOpenPathAuthProcedure({
        procedure: 'auth.changePassword',
        req: ctx.req,
        token: ctx.token,
        includeAuth: true,
        input,
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Password change failed',
        unavailableMessage: 'Authentication service unavailable',
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
