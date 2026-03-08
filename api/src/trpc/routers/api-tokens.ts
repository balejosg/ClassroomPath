import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import { callOpenPathTrpc } from '../../lib/openpath-upstream.js';

type ApiTokenListItem = {
  id: string;
  name: string;
  maskedToken: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  isExpired: boolean;
};

export const apiTokensRouter = router({
  /**
   * List all active tokens for the current user - forwards to OpenPath API
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    try {
      const data = await callOpenPathTrpc({
        procedure: 'apiTokens.list',
        method: 'GET',
        req: ctx.req,
        token: ctx.token,
        includeAuth: true,
        defaultErrorCode: 'SERVICE_UNAVAILABLE',
        upstreamFailureMessage: 'API tokens service unavailable',
        unavailableMessage: 'API tokens service unavailable',
        unavailableCode: 'SERVICE_UNAVAILABLE',
      });

      const tokens = Array.isArray(data) ? (data as ApiTokenListItem[]) : null;
      if (!Array.isArray(tokens)) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'API tokens service unavailable',
        });
      }

      return tokens;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
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
    .mutation(async ({ input, ctx }) =>
      callOpenPathTrpc({
        procedure: 'apiTokens.create',
        req: ctx.req,
        token: ctx.token,
        includeAuth: true,
        input,
        defaultErrorCode: 'INTERNAL_SERVER_ERROR',
        upstreamFailureMessage: 'Failed to create API token',
        unavailableMessage: 'API tokens service unavailable',
      })
    ),

  /**
   * Revoke an API token - forwards to OpenPath API
   */
  revoke: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) =>
      callOpenPathTrpc({
        procedure: 'apiTokens.revoke',
        req: ctx.req,
        token: ctx.token,
        includeAuth: true,
        input,
        defaultErrorCode: 'NOT_FOUND',
        upstreamFailureMessage: 'Failed to revoke API token',
        unavailableMessage: 'API tokens service unavailable',
      })
    ),

  /**
   * Regenerate an API token - forwards to OpenPath API
   */
  regenerate: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) =>
      callOpenPathTrpc({
        procedure: 'apiTokens.regenerate',
        req: ctx.req,
        token: ctx.token,
        includeAuth: true,
        input,
        defaultErrorCode: 'NOT_FOUND',
        upstreamFailureMessage: 'Failed to regenerate API token',
        unavailableMessage: 'API tokens service unavailable',
      })
    ),
});
