import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { forwardOpenPathAuthProcedure } from '../../lib/openpath-auth-client.js';
import { generateTenantResetToken } from '../../services/auth-recovery.service.js';
import { assertOrgAdminTenantProcedureContext } from '../tenant-procedure-helpers.js';
import { publicProcedure, tenantProcedure } from '../trpc.js';
import { normalizeEmailAddress } from './auth-payloads.js';

export const authRecoveryProcedures = {
  generateResetToken: tenantProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertOrgAdminTenantProcedureContext(ctx, 'Only organization admins can manage users');
      return generateTenantResetToken({
        organizationId: ctx.organizationId,
        email: input.email,
        actedBy: ctx.user.sub,
      });
    }),

  resetPassword: publicProcedure
    .input(
      z.object({
        email: z.string().trim().email(),
        token: z.string(),
        newPassword: z.string().min(8),
      })
    )
    .mutation(async ({ input, ctx }) =>
      forwardOpenPathAuthProcedure({
        procedure: 'auth.resetPassword',
        req: ctx.req,
        input: {
          email: normalizeEmailAddress(input.email),
          token: input.token,
          newPassword: input.newPassword,
        },
        defaultErrorCode: 'BAD_REQUEST',
        upstreamFailureMessage: 'Password reset failed',
        unavailableMessage: 'Authentication service unavailable',
      })
    ),
};
