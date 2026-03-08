import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import {
  forwardOpenPathAuthProcedure,
  forwardOpenPathSessionMutation,
  getOpenPathMeProfile,
  logoutOpenPathSession,
} from '../../lib/openpath-auth-client.js';

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
