import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, tenantProcedure } from '../trpc.js';

import {
  assertOrgAdminTenantProcedureContext,
  assertTenantProcedureContext,
} from '../tenant-procedure-helpers.js';
import {
  approveTenantRequest,
  createTenantRequest,
  deleteTenantRequest,
  getTenantRequestStats,
  listAccessibleRequestGroups,
  listTenantRequests,
  rejectTenantRequest,
} from '../../services/requests.service.js';

export const requestsRouter = router({
  create: tenantProcedure
    .input(
      z.object({
        domain: z.string().trim().min(1),
        groupId: z.string().optional(),
        reason: z.string().optional(),
        requesterEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.groupId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'groupId is required for tenant requests',
        });
      }

      assertTenantProcedureContext(ctx);
      return createTenantRequest({
        ctx,
        input: {
          domain: input.domain,
          groupId: input.groupId,
          reason: input.reason,
          requesterEmail: input.requesterEmail,
        },
      });
    }),

  listGroups: tenantProcedure.query(async ({ ctx }) => {
    assertTenantProcedureContext(ctx);
    return listAccessibleRequestGroups(ctx);
  }),

  stats: tenantProcedure.query(async ({ ctx }) => {
    assertTenantProcedureContext(ctx);
    return getTenantRequestStats(ctx);
  }),

  list: tenantProcedure
    .input(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }))
    .query(async ({ ctx, input }) => {
      assertTenantProcedureContext(ctx);
      return listTenantRequests(ctx, input.status);
    }),

  approve: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertTenantProcedureContext(ctx);
    return approveTenantRequest(ctx, input.id);
  }),

  reject: tenantProcedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      assertTenantProcedureContext(ctx);
      return rejectTenantRequest(ctx, input.id, input.reason);
    }),

  delete: tenantProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    assertOrgAdminTenantProcedureContext(ctx);
    return deleteTenantRequest(ctx, input.id);
  }),
});
