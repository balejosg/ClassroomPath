import { z } from 'zod';
import { router, tenantProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import * as pendingUsersService from '../../services/pending-users.service.js';

export const pendingUsersRouter = router({
  /**
   * List all users waiting to join the current organization
   * Only admins can see pending users
   */
  list: tenantProcedure.query(async ({ ctx }) => {
    if (ctx.userRole !== 'admin') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only admins can view pending users',
      });
    }

    return pendingUsersService.listPendingUsers(ctx.organizationId);
  }),

  /**
   * Approve a pending user and add them to the organization
   */
  approve: tenantProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        role: z.enum(['admin', 'teacher']).default('teacher'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.userRole !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only admins can approve users',
        });
      }

      try {
        const result = await pendingUsersService.approveUser(
          input.userId,
          ctx.organizationId,
          input.role,
          ctx.user.sub
        );

        return {
          success: true,
          membershipId: result.membershipId,
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes('not waiting')) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'User is not waiting for this organization',
          });
        }
        throw error;
      }
    }),

  /**
   * Reject a pending user
   */
  reject: tenantProcedure
    .input(
      z.object({
        userId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.userRole !== 'admin') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only admins can reject users',
        });
      }

      await pendingUsersService.rejectUser(input.userId, ctx.organizationId, ctx.user.sub);

      return { success: true };
    }),
});
