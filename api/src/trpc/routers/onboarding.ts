import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import * as onboardingService from '../../services/onboarding.service.js';
import {
  cancelWaitingForInvitation,
  createOrganizationSession,
  listAvailableOrganizations,
  setWaitingForInvitation,
} from '../../services/onboarding-flow.service.js';

export const onboardingRouter = router({
  /**
   * List all organizations (for users to select which one to join)
   */
  listOrganizations: protectedProcedure.query(async () => listAvailableOrganizations()),
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
    .mutation(async ({ ctx, input }) =>
      createOrganizationSession({
        name: input.name,
        userId: ctx.user.sub,
        res: ctx.res,
      })
    ),

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
    .mutation(async ({ ctx, input }) =>
      setWaitingForInvitation({
        userId: ctx.user.sub,
        targetOrganizationId: input?.targetOrganizationId,
      })
    ),

  /**
   * Clear waiting status (user wants to create org instead)
   */
  cancelWaiting: protectedProcedure.mutation(async ({ ctx }) =>
    cancelWaitingForInvitation(ctx.user.sub)
  ),
});
