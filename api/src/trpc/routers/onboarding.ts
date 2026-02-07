import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { router, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import * as onboardingService from '../../services/onboarding.service.js';
import * as openpathRoles from '../../lib/openpath-roles.js';
import * as openpathUsers from '../../lib/openpath-users.js';
import * as jwt from '../../lib/jwt.js';
import * as pendingUsersService from '../../services/pending-users.service.js';
import { db, schema } from '../../db/index.js';

export const onboardingRouter = router({
  /**
   * List all organizations (for users to select which one to join)
   */
  listOrganizations: protectedProcedure.query(async () => {
    const orgs = await db
      .select({
        id: schema.cpOrganizations.id,
        name: schema.cpOrganizations.name,
      })
      .from(schema.cpOrganizations);

    return orgs;
  }),
  /**
   * Get current user's onboarding status
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    return onboardingService.getOnboardingStatus(ctx.user.sub);
  }),

  /**
   * Create a new organization (user becomes admin)
   */
  createOrganization: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const status = await onboardingService.getOnboardingStatus(ctx.user.sub);

      if (status.hasMembership) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'User already belongs to an organization',
        });
      }

      const result = await onboardingService.createOrganization(input.name, ctx.user.sub);

      const user = await openpathUsers.getUserById(ctx.user.sub);
      if (!user) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'User not found after organization creation',
        });
      }

      const roles = await openpathRoles.getUserRoles(ctx.user.sub);
      const tokens = jwt.generateTokens(user, roles);

      return {
        success: true,
        organizationId: result.organizationId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    }),

  /**
   * Mark user as waiting for invitation to a specific organization
   */
  waitForInvitation: protectedProcedure
    .input(
      z
        .object({
          targetOrganizationId: z.string().min(1).optional(),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const status = await onboardingService.getOnboardingStatus(ctx.user.sub);

      if (status.hasMembership) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'User already belongs to an organization',
        });
      }

      const targetOrgId = input?.targetOrganizationId;

      if (targetOrgId) {
        // Verify organization exists
        const org = await db
          .select()
          .from(schema.cpOrganizations)
          .where(eq(schema.cpOrganizations.id, targetOrgId))
          .limit(1);

        if (org.length === 0) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Organization not found',
          });
        }

        await pendingUsersService.setWaitingStatusWithOrg(ctx.user.sub, targetOrgId);
      } else {
        // Legacy behavior: wait without specific org
        await onboardingService.setWaitingStatus(ctx.user.sub);
      }

      return { success: true };
    }),

  /**
   * Clear waiting status (user wants to create org instead)
   */
  cancelWaiting: protectedProcedure.mutation(async ({ ctx }) => {
    await onboardingService.clearWaitingStatus(ctx.user.sub);
    return { success: true };
  }),
});
