import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';
import { clearSessionCookies, setSessionCookies } from '../../lib/session-cookies.js';

// Forward auth requests to OpenPath API
const OPENPATH_API_URL = process.env.OPENPATH_API_URL || 'http://api:3000';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function extractUpstreamErrorMessage(body: unknown): string | null {
  const obj = asRecord(body);
  if (!obj) return null;

  // OpenPath rate-limit + REST error shape: { success:false, error: string, code: string }
  if (typeof obj.error === 'string' && obj.error.trim().length > 0) {
    return obj.error;
  }

  // tRPC error shape: { error: { message: string, ... } }
  const errObj = asRecord(obj.error);
  if (errObj && typeof errObj.message === 'string' && errObj.message.trim().length > 0) {
    return errObj.message;
  }

  // Some error shapes nest the payload under error.json
  const errJson = errObj ? asRecord(errObj.json) : null;
  if (errJson && typeof errJson.message === 'string' && errJson.message.trim().length > 0) {
    return errJson.message;
  }

  if (typeof obj.message === 'string' && obj.message.trim().length > 0) {
    return obj.message;
  }

  return null;
}

async function readUpstreamErrorMessage(response: Response, fallback: string): Promise<string> {
  const raw = await response.text().catch(() => '');
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return extractUpstreamErrorMessage(parsed) ?? fallback;
  } catch {
    // Non-JSON (e.g. HTML 502). Keep it short.
    return trimmed.slice(0, 300);
  }
}

function mapUpstreamStatusToTrpcCode(
  status: number,
  defaultCode: TRPC_ERROR_CODE_KEY
): TRPC_ERROR_CODE_KEY {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 409) return 'CONFLICT';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 429) return 'TOO_MANY_REQUESTS';
  if (status === 502) return 'BAD_GATEWAY';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  if (status === 504) return 'GATEWAY_TIMEOUT';
  if (status >= 500) return 'INTERNAL_SERVER_ERROR';
  return defaultCode;
}

function headerToString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value.join(', ') : value;
}

function getForwardHeaders(req: { headers: Record<string, unknown> }): Record<string, string> {
  const xForwardedFor = headerToString(
    req.headers['x-forwarded-for'] as string | string[] | undefined
  );
  return xForwardedFor ? { 'X-Forwarded-For': xForwardedFor } : {};
}

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
        const forwardHeaders = getForwardHeaders(ctx.req);
        const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...forwardHeaders,
          },
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

        const data = await response.json();
        const authData = data.result?.data ?? data;
        if (authData?.accessToken && authData?.refreshToken) {
          setSessionCookies(ctx.res, {
            accessToken: authData.accessToken,
            refreshToken: authData.refreshToken,
          });
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
        const forwardHeaders = getForwardHeaders(ctx.req);
        const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...forwardHeaders,
          },
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

        const data = await response.json();
        const authData = data.result?.data ?? data;
        if (authData?.accessToken && authData?.refreshToken) {
          setSessionCookies(ctx.res, {
            accessToken: authData.accessToken,
            refreshToken: authData.refreshToken,
          });
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
        const forwardHeaders = getForwardHeaders(ctx.req);
        const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.googleLogin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...forwardHeaders,
          },
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

        const data = await response.json();
        const authData = data.result?.data ?? data;
        if (authData?.accessToken && authData?.refreshToken) {
          setSessionCookies(ctx.res, {
            accessToken: authData.accessToken,
            refreshToken: authData.refreshToken,
          });
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
          message: 'Authentication service unavailable',
        });
      }
    }),

  /**
   * Get current user profile - forwards to OpenPath API
   */
  me: protectedProcedure.query(async ({ ctx }) => {
    try {
      const forwardHeaders = getForwardHeaders(ctx.req);
      const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.token}`,
          ...forwardHeaders,
        },
      });

      if (!response.ok) {
        const message = await readUpstreamErrorMessage(response, 'Failed to get user profile');
        const code = mapUpstreamStatusToTrpcCode(response.status, 'UNAUTHORIZED');
        throw new TRPCError({
          code,
          message,
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
    .mutation(async ({ input }) => {
      try {
        const response = await fetch(`${OPENPATH_API_URL}/trpc/auth.resetPassword`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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
          message: 'Authentication service unavailable',
        });
      }
    }),

  /**
   * Logout endpoint - clears cookie session and forwards token invalidation to OpenPath API
   */
  logout: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const forwardHeaders = getForwardHeaders(ctx.req);
      await fetch(`${OPENPATH_API_URL}/trpc/auth.logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.token}`,
          ...forwardHeaders,
        },
      });
    } finally {
      clearSessionCookies(ctx.res);
    }

    return { success: true };
  }),
});
