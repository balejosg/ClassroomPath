import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import {
  buildOpenPathHeaders,
  extractTrpcData,
  mapUpstreamStatusToTrpcCode,
  openPathTrpcUrl,
  readUpstreamErrorMessage,
} from '../../lib/openpath-upstream.js';

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
      const response = await fetch(openPathTrpcUrl('apiTokens.list'), {
        method: 'GET',
        headers: {
          ...buildOpenPathHeaders({ req: ctx.req, includeAuth: true, token: ctx.token }),
        },
      });

      if (!response.ok) {
        // Preserve auth semantics for invalid/expired tokens.
        if (response.status === 401) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Not authenticated',
          });
        }
        if (response.status === 403) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Forbidden',
          });
        }

        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'API tokens service unavailable',
        });
      }

      const data: unknown = await response.json();
      const tokens = extractTrpcData<ApiTokenListItem[]>(data);
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
    .mutation(async ({ input, ctx }) => {
      try {
        const response = await fetch(openPathTrpcUrl('apiTokens.create'), {
          method: 'POST',
          headers: {
            ...buildOpenPathHeaders({ req: ctx.req, includeAuth: true, token: ctx.token }),
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const message = await readUpstreamErrorMessage(response, 'Failed to create API token');
          const code = mapUpstreamStatusToTrpcCode(response.status, 'INTERNAL_SERVER_ERROR');
          throw new TRPCError({
            code,
            message,
          });
        }

        const data: unknown = await response.json();
        return extractTrpcData<unknown>(data) ?? data;
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
        const response = await fetch(openPathTrpcUrl('apiTokens.revoke'), {
          method: 'POST',
          headers: {
            ...buildOpenPathHeaders({ req: ctx.req, includeAuth: true, token: ctx.token }),
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const message = await readUpstreamErrorMessage(response, 'Failed to revoke API token');
          const code = mapUpstreamStatusToTrpcCode(response.status, 'NOT_FOUND');
          throw new TRPCError({
            code,
            message,
          });
        }

        const data: unknown = await response.json();
        return extractTrpcData<unknown>(data) ?? data;
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
        const response = await fetch(openPathTrpcUrl('apiTokens.regenerate'), {
          method: 'POST',
          headers: {
            ...buildOpenPathHeaders({ req: ctx.req, includeAuth: true, token: ctx.token }),
          },
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const message = await readUpstreamErrorMessage(
            response,
            'Failed to regenerate API token'
          );
          const code = mapUpstreamStatusToTrpcCode(response.status, 'NOT_FOUND');
          throw new TRPCError({
            code,
            message,
          });
        }

        const data: unknown = await response.json();
        return extractTrpcData<unknown>(data) ?? data;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'API tokens service unavailable',
        });
      }
    }),
});
