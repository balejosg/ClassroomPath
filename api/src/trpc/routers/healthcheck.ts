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

export type GatewaySystemInfo = SystemInfo & {
  degraded: boolean;
  upstreamAvailable: boolean;
  databaseConnected: boolean;
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

export async function getGatewaySystemInfo(
  fetchImpl: typeof fetch = fetch
): Promise<GatewaySystemInfo> {
  try {
    const response = await fetchImpl(openPathTrpcUrl('healthcheck.systemInfo'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return {
        ...SYSTEM_INFO_FALLBACK,
        degraded: true,
        upstreamAvailable: false,
        databaseConnected: false,
      };
    }

    const data: unknown = await response.json();
    const systemInfo = extractTrpcData<SystemInfo>(data);

    if (!systemInfo) {
      return {
        ...SYSTEM_INFO_FALLBACK,
        degraded: true,
        upstreamAvailable: false,
        databaseConnected: false,
      };
    }

    return {
      ...systemInfo,
      degraded: !systemInfo.database.connected,
      upstreamAvailable: true,
      databaseConnected: systemInfo.database.connected,
    };
  } catch {
    return {
      ...SYSTEM_INFO_FALLBACK,
      degraded: true,
      upstreamAvailable: false,
      databaseConnected: false,
    };
  }
}

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
  systemInfo: publicProcedure.query(async () => getGatewaySystemInfo()),
});
