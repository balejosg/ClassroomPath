import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import type { Context } from '../context.js';

// Forward apiTokens requests to OpenPath API
const OPENPATH_API_URL = process.env.OPENPATH_API_URL || 'http://api:3000';

// Helper to get authorization token from context
function getAuthHeader(ctx: Context): string {
  const token = (ctx as Context & { token?: string }).token;
  return token ? `Bearer ${token}` : '';
}

export const apiTokensRouter = router({
  /**
   * List all active tokens for the current user - forwards to OpenPath API
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      const response = await fetch(`${OPENPATH_API_URL}/trpc/apiTokens.list`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: getAuthHeader(ctx),
        },
      });

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: { message: 'Failed to list API tokens' } }));
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.error?.message || 'Failed to list API tokens',
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
        message: 'API tokens service unavailable',
      });
    }
  }),

  /**
   * Create a new API token - forwards to OpenPath API
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        expiresInDays: z.number().int().positive().max(365).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const response = await fetch(`${OPENPATH_API_URL}/trpc/apiTokens.create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: getAuthHeader(ctx),
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: { message: 'Failed to create API token' } }));
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: error.error?.message || 'Failed to create API token',
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
          message: 'API tokens service unavailable',
        });
      }
    }),

  /**
   * Revoke an API token - forwards to OpenPath API
   */
  revoke: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const response = await fetch(`${OPENPATH_API_URL}/trpc/apiTokens.revoke`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: getAuthHeader(ctx),
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: { message: 'Failed to revoke API token' } }));
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.error?.message || 'Failed to revoke API token',
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
          message: 'API tokens service unavailable',
        });
      }
    }),

  /**
   * Regenerate an API token - forwards to OpenPath API
   */
  regenerate: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const response = await fetch(`${OPENPATH_API_URL}/trpc/apiTokens.regenerate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: getAuthHeader(ctx),
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const error = await response
            .json()
            .catch(() => ({ error: { message: 'Failed to regenerate API token' } }));
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: error.error?.message || 'Failed to regenerate API token',
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
          message: 'API tokens service unavailable',
        });
      }
    }),
});
