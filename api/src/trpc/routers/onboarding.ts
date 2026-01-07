import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import * as onboardingService from '../../services/onboarding.service.js';

export const onboardingRouter = router({
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
        .input(z.object({
            name: z.string().min(2).max(100),
        }))
        .mutation(async ({ ctx, input }) => {
            const status = await onboardingService.getOnboardingStatus(ctx.user.sub);
            
            if (status.hasMembership) {
                throw new TRPCError({
                    code: 'BAD_REQUEST',
                    message: 'User already belongs to an organization',
                });
            }

            const result = await onboardingService.createOrganization(
                input.name,
                ctx.user.sub
            );

            return {
                success: true,
                organizationId: result.organizationId,
            };
        }),

    /**
     * Mark user as waiting for invitation
     */
    waitForInvitation: protectedProcedure.mutation(async ({ ctx }) => {
        const status = await onboardingService.getOnboardingStatus(ctx.user.sub);
        
        if (status.hasMembership) {
            throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'User already belongs to an organization',
            });
        }

        await onboardingService.setWaitingStatus(ctx.user.sub);
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
