import { router, publicProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';

import { extractTrpcData, openPathTrpcUrl } from '../../lib/openpath-upstream.js';

// Forward healthcheck requests to OpenPath API

type SystemInfo = {
  version: string;
  database: {
    connected: boolean;
    type: string;
  };
  session: {
    accessTokenExpiry: string;
    accessTokenExpiryHuman: string;
    refreshTokenExpiry: string;
    refreshTokenExpiryHuman: string;
  };
  backup: {
    lastBackupAt: string | null;
    lastBackupHuman: string | null;
    lastBackupStatus: 'success' | 'failed' | null;
  };
  uptime: number;
};

const SYSTEM_INFO_FALLBACK: SystemInfo = {
  version: 'N/A',
  database: {
    connected: false,
    type: 'N/A',
  },
  session: {
    accessTokenExpiry: 'N/A',
    accessTokenExpiryHuman: 'No disponible',
    refreshTokenExpiry: 'N/A',
    refreshTokenExpiryHuman: 'No disponible',
  },
  backup: {
    lastBackupAt: null,
    lastBackupHuman: null,
    lastBackupStatus: null,
  },
  uptime: 0,
};

export const healthcheckRouter = router({
  /**
   * Liveness probe - forwards to OpenPath API
   */
  live: publicProcedure.query(async () => {
    try {
      const response = await fetch(openPathTrpcUrl('healthcheck.live'), {
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

      const data: unknown = await response.json();
      return extractTrpcData<unknown>(data) ?? data;
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
      const response = await fetch(openPathTrpcUrl('healthcheck.ready'), {
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

      const data: unknown = await response.json();
      return extractTrpcData<unknown>(data) ?? data;
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
      const response = await fetch(openPathTrpcUrl('healthcheck.systemInfo'), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        // Degrade gracefully for Settings page. Returning fallback avoids
        // repeated 500s that can flood the console/UI.
        return SYSTEM_INFO_FALLBACK;
      }

      const data: unknown = await response.json();
      return extractTrpcData<SystemInfo>(data) ?? SYSTEM_INFO_FALLBACK;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      return SYSTEM_INFO_FALLBACK;
    }
  }),
});
