import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, tenantAdminProcedure, tenantMemberProcedure } from '../trpc.js';

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
  create: tenantMemberProcedure
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

  listGroups: tenantMemberProcedure.query(async ({ ctx }) => {
    return listAccessibleRequestGroups(ctx);
  }),

  stats: tenantMemberProcedure.query(async ({ ctx }) => {
    return getTenantRequestStats(ctx);
  }),

  list: tenantMemberProcedure
    .input(z.object({ status: z.enum(['pending', 'approved', 'rejected']).optional() }))
    .query(async ({ ctx, input }) => {
      return listTenantRequests(ctx, input.status);
    }),

  approve: tenantMemberProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return approveTenantRequest(ctx, input.id);
    }),

  reject: tenantMemberProcedure
    .input(z.object({ id: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return rejectTenantRequest(ctx, input.id, input.reason);
    }),

  delete: tenantAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return deleteTenantRequest(ctx, input.id);
    }),
});
