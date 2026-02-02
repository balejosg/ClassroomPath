import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';

// Forward auth requests to OpenPath API
const OPENPATH_API_URL = process.env.OPENPATH_API_URL || 'http://api:3000';

export const authRouter = router({
    /**
     * Login endpoint - forwards to OpenPath API
     */
    login: publicProcedure
        .input(z.object({
            email: z.string().email(),
            password: z.string().min(1),
        }))
        .mutation(async ({ input }) => {
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
        .mutation(async ({ input }) => {
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
