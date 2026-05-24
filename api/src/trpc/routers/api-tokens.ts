import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { openPathGateway } from '../../lib/openpath/gateway.js';

export const apiTokensRouter = router({
  /**
   * List all active tokens for the current user - forwards to OpenPath API
   */
  list: protectedProcedure.query(async ({ ctx }) =>
    openPathGateway.listApiTokens({
      req: ctx.req,
      token: ctx.token,
    })
  ),

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
      openPathGateway.createApiToken({
        req: ctx.req,
        token: ctx.token,
        input,
      })
    ),

  /**
   * Revoke an API token - forwards to OpenPath API
   */
  revoke: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) =>
      openPathGateway.revokeApiToken({
        req: ctx.req,
        token: ctx.token,
        input,
      })
    ),

  /**
   * Regenerate an API token - forwards to OpenPath API
   */
  regenerate: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) =>
      openPathGateway.regenerateApiToken({
        req: ctx.req,
        token: ctx.token,
        input,
      })
    ),
});
