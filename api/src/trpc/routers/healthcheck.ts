import { router, publicProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';

// Forward healthcheck requests to OpenPath API
const OPENPATH_API_URL = process.env.OPENPATH_API_URL || 'http://api:3000';

export const healthcheckRouter = router({
  /**
   * Liveness probe - forwards to OpenPath API
   */
  live: publicProcedure.query(async () => {
    try {
      const response = await fetch(`${OPENPATH_API_URL}/trpc/healthcheck.live`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Healthcheck service unavailable',
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
        message: 'Healthcheck service unavailable',
      });
    }
  }),

  /**
   * Readiness probe - forwards to OpenPath API
   */
  ready: publicProcedure.query(async () => {
    try {
      const response = await fetch(`${OPENPATH_API_URL}/trpc/healthcheck.ready`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Healthcheck service unavailable',
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
        message: 'Healthcheck service unavailable',
      });
    }
  }),

  /**
   * System info for Settings page - forwards to OpenPath API
   */
  systemInfo: publicProcedure.query(async () => {
    try {
      const response = await fetch(`${OPENPATH_API_URL}/trpc/healthcheck.systemInfo`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Healthcheck service unavailable',
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
        message: 'Healthcheck service unavailable',
      });
    }
  }),
});
