import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import * as onboardingService from '../../services/onboarding.service.js';
import type { Context } from '../context.js';

// Forward auth requests to OpenPath API
const OPENPATH_API_URL = process.env.OPENPATH_API_URL || 'http://openpath-api:3000';

/**
 * Helper to determine if auto-onboarding should be performed.
 * Auto-onboard if the request comes through the /v2/trpc endpoint (OpenPath standalone).
 * Requests to /cp/trpc (ClassroomPath SaaS) should NOT auto-onboard.
 */
function shouldAutoOnboard(ctx: Context): boolean {
    // The originalUrl includes the full path: /v2/trpc/auth.login or /cp/trpc/auth.login
    const requestPath = ctx.req.originalUrl || ctx.req.url;
    return requestPath.startsWith('/v2/trpc');
}

export const authRouter = router({
    /**
     * Login endpoint - forwards to OpenPath API
     */
    login: publicProcedure
        .input(z.object({
            email: z.string().email(),
            password: z.string().min(1),
        }))
        .mutation(async ({ input, ctx }) => {
            try {
                const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.login`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(input),
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({ error: { message: 'Login failed' } }));
                    throw new TRPCError({
                        code: 'UNAUTHORIZED',
                        message: error.error?.message || 'Invalid credentials'
                    });
                }

                const data = await response.json();
                
                // Auto-onboarding for React SPA (/v2) compatibility
                // If user has no organization, create one automatically
                if (data.result?.data?.user?.id && shouldAutoOnboard(ctx)) {
                    const userId = data.result.data.user.id;
                    const userName = data.result.data.user.name || 'Usuario';
                    
                    try {
                        const status = await onboardingService.getOnboardingStatus(userId);
                        if (!status.hasMembership && !status.isWaiting) {
                            console.log(`[Auth] Auto-creating organization for user ${userId} (from /v2/)`);
                            await onboardingService.createOrganization(`Organización de ${userName}`, userId);
                        }
                    } catch (err) {
                        console.error('[Auth] Failed to auto-onboard user:', err);
                        // Continue anyway, don't block login
                    }
                }

                // Extract the inner data from OpenPath's TRPC response
                if (data.result && data.result.data) {
                    return data.result.data;
                }
                return data;
            } catch (error) {
                if (error instanceof TRPCError) throw error;
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Authentication service unavailable'
                });
            }
        }),

    /**
     * Register endpoint - forwards to OpenPath API
     */
    register: publicProcedure
        .input(z.object({
            email: z.string().email(),
            name: z.string().min(2),
            password: z.string().min(8),
        }))
        .mutation(async ({ input, ctx }) => {
            try {
                const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.register`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(input),
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({ error: { message: 'Registration failed' } }));
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: error.error?.message || 'Registration failed'
                    });
                }

                const data = await response.json();

                // Auto-onboarding for React SPA (/v2) compatibility
                if (data.result?.data?.user?.id && shouldAutoOnboard(ctx)) {
                    const userId = data.result.data.user.id;
                    try {
                        console.log(`[Auth] Auto-creating organization for new user ${userId} (from /v2/)`);
                        await onboardingService.createOrganization(`Organización de ${input.name}`, userId);
                    } catch (err) {
                        console.error('[Auth] Failed to auto-onboard new user:', err);
                    }
                }

                // Extract the inner data from OpenPath's TRPC response
                if (data.result && data.result.data) {
                    return data.result.data;
                }
                return data;
            } catch (error) {
                if (error instanceof TRPCError) throw error;
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Registration service unavailable'
                });
            }
        }),
});
