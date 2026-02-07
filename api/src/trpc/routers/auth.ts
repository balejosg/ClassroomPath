import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import type { Context } from '../context.js';

// Forward auth requests to OpenPath API
const OPENPATH_API_URL = process.env.OPENPATH_API_URL || 'http://api:3000';

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
    .mutation(async ({ input }) => {
      try {
        const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: { message: 'Login failed' } }));
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: error.error?.message || 'Invalid credentials',
          });
        }

        const data = await response.json();

        // Extract the inner data from OpenPath's TRPC response
        if (data.result && data.result.data) {
          return data.result.data;
        }
        return data;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Authentication service unavailable',
        });
      }
    }),

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
    .mutation(async ({ input }) => {
      try {
        const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: { message: 'Registration failed' } }));
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.error?.message || 'Registration failed',
          });
        }

        const data = await response.json();

        // Extract the inner data from OpenPath's TRPC response
        if (data.result && data.result.data) {
          return data.result.data;
        }
        return data;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Registration service unavailable',
        });
      }
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
    .mutation(async ({ input }) => {
      try {
        const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.googleLogin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: { message: 'Google login failed' } }));
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: error.error?.message || 'Google authentication failed',
          });
        }

        const data = await response.json();

        // Extract the inner data from OpenPath's TRPC response
        if (data.result && data.result.data) {
          return data.result.data;
        }
        return data;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Authentication service unavailable',
        });
      }
    }),

  /**
   * Get current user profile - forwards to OpenPath API
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    try {
      const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.token}`,
        },
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: { message: 'Failed to get user profile' } }));
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: error.error?.message || 'Failed to get user profile',
        });
      }

      const data = await response.json();

      // Extract the inner data from OpenPath's TRPC response
      if (data.result && data.result.data) {
        return data.result.data;
      }
      return data;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Authentication service unavailable',
      });
    }
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
    .mutation(async ({ input }) => {
      try {
        const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.resetPassword`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: { message: 'Password reset failed' } }));
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: error.error?.message || 'Password reset failed',
          });
        }

        const data = await response.json();

        // Extract the inner data from OpenPath's TRPC response
        if (data.result && data.result.data) {
          return data.result.data;
        }
        return data;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Authentication service unavailable',
        });
      }
    }),
});
