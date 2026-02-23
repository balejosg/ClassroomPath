import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import { clearSessionCookies, setSessionCookies } from '../../lib/session-cookies.js';
import {
  buildOpenPathHeaders,
  extractTrpcData,
  mapUpstreamStatusToTrpcCode,
  openPathTrpcUrl,
  readUpstreamErrorMessage,
} from '../../lib/openpath-upstream.js';

function getTokenPair(value: unknown): { accessToken: string; refreshToken: string } | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const accessToken = obj.accessToken;
  const refreshToken = obj.refreshToken;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null;
  return { accessToken, refreshToken };
}

const OpenPathRoleInfoSchema = z
  .object({
    role: z.string().min(1),
    groupIds: z.array(z.string()).optional(),
  })
  .passthrough();

const OpenPathMeResponseSchema = z
  .object({
    user: z
      .object({
        id: z.string().min(1),
        email: z.string().min(1),
        name: z.string().min(1),
        roles: z.array(OpenPathRoleInfoSchema).optional().default([]),
      })
      .passthrough(),
  })
  .passthrough();

export const authRouter = router({
  /**
   * Login endpoint - forwards to OpenPath API
   */
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const response = await fetch(openPathTrpcUrl('auth.login'), {
          method: 'POST',
          headers: buildOpenPathHeaders({ req: ctx.req }),
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const message = await readUpstreamErrorMessage(response, 'Login failed');
          const code = mapUpstreamStatusToTrpcCode(response.status, 'UNAUTHORIZED');
          throw new TRPCError({
            code,
            message,
          });
        }

        const data: unknown = await response.json();
        const unwrapped = extractTrpcData<unknown>(data) ?? data;
        const tokenPair = getTokenPair(unwrapped);
        if (tokenPair) {
          setSessionCookies(ctx.res, tokenPair);
        }

        return unwrapped;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Authentication service unavailable',
        });
      }
    }),

  /**
   * Register endpoint - forwards to OpenPath API
   */
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(2),
        password: z.string().min(8),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const response = await fetch(openPathTrpcUrl('auth.register'), {
          method: 'POST',
          headers: buildOpenPathHeaders({ req: ctx.req }),
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const message = await readUpstreamErrorMessage(response, 'Registration failed');
          const code = mapUpstreamStatusToTrpcCode(response.status, 'BAD_REQUEST');
          throw new TRPCError({
            code,
            message,
          });
        }

        const data: unknown = await response.json();
        const unwrapped = extractTrpcData<unknown>(data) ?? data;
        const tokenPair = getTokenPair(unwrapped);
        if (tokenPair) {
          setSessionCookies(ctx.res, tokenPair);
        }

        return unwrapped;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Registration service unavailable',
        });
      }
    }),

  /**
   * Google login endpoint - forwards to OpenPath API
   */
  googleLogin: publicProcedure
    .input(
      z.object({
        idToken: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const response = await fetch(openPathTrpcUrl('auth.googleLogin'), {
          method: 'POST',
          headers: buildOpenPathHeaders({ req: ctx.req }),
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const message = await readUpstreamErrorMessage(response, 'Google login failed');
          const code = mapUpstreamStatusToTrpcCode(response.status, 'UNAUTHORIZED');
          throw new TRPCError({
            code,
            message,
          });
        }

        const data: unknown = await response.json();
        const unwrapped = extractTrpcData<unknown>(data) ?? data;
        const tokenPair = getTokenPair(unwrapped);
        if (tokenPair) {
          setSessionCookies(ctx.res, tokenPair);
        }

        return unwrapped;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Authentication service unavailable',
        });
      }
    }),

  /**
   * Get current user profile - forwards to OpenPath API
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    try {
      const response = await fetch(openPathTrpcUrl('auth.me'), {
        method: 'GET',
        headers: buildOpenPathHeaders({ req: ctx.req, includeAuth: true, token: ctx.token }),
      });

      if (!response.ok) {
        const message = await readUpstreamErrorMessage(response, 'Failed to get user profile');
        const code = mapUpstreamStatusToTrpcCode(response.status, 'UNAUTHORIZED');
        throw new TRPCError({
          code,
          message,
        });
      }

      const data: unknown = await response.json();
      const unwrapped = extractTrpcData<unknown>(data) ?? data;
      const parsed = OpenPathMeResponseSchema.safeParse(unwrapped);
      if (!parsed.success) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Invalid user profile received from upstream',
        });
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Authentication service unavailable',
      });
    }
  }),

  /**
   * Reset password - forwards to OpenPath API
   */
  resetPassword: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        token: z.string(),
        newPassword: z.string().min(8),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const response = await fetch(openPathTrpcUrl('auth.resetPassword'), {
          method: 'POST',
          headers: buildOpenPathHeaders({ req: ctx.req }),
          body: JSON.stringify(input),
        });

        if (!response.ok) {
          const message = await readUpstreamErrorMessage(response, 'Password reset failed');
          const code = mapUpstreamStatusToTrpcCode(response.status, 'BAD_REQUEST');
          throw new TRPCError({
            code,
            message,
          });
        }

        const data: unknown = await response.json();
        return extractTrpcData<unknown>(data) ?? data;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Authentication service unavailable',
        });
      }
    }),

  /**
   * Logout endpoint - clears cookie session and forwards token invalidation to OpenPath API
   */
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      await fetch(openPathTrpcUrl('auth.logout'), {
        method: 'POST',
        headers: {
          ...buildOpenPathHeaders({ req: ctx.req, includeAuth: true, token: ctx.token }),
        },
      });
    } finally {
      clearSessionCookies(ctx.res);
    }

    return { success: true };
  }),
});
