import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import * as onboardingService from '../../services/onboarding.service.js';
import * as openpathRoles from '../../lib/openpath-roles.js';
import * as openpathUsers from '../../lib/openpath-users.js';
import * as jwt from '../../lib/jwt.js';

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
