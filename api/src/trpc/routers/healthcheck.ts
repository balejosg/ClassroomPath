import { router, publicProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';

import { callOpenPathTrpc } from '../../lib/openpath/trpc-client.js';

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

async function forwardHealthcheckProcedure(procedure: 'healthcheck.live' | 'healthcheck.ready') {
  try {
    return await callOpenPathTrpc({
      procedure,
      method: 'GET',
      defaultErrorCode: 'INTERNAL_SERVER_ERROR',
      upstreamFailureMessage: 'Healthcheck service unavailable',
      unavailableMessage: 'Healthcheck service unavailable',
    });
  } catch {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Healthcheck service unavailable',
    });
  }
}

export async function getGatewaySystemInfo(
  fetchImpl: typeof fetch = fetch
): Promise<GatewaySystemInfo> {
  try {
    const systemInfo = (await callOpenPathTrpc({
      procedure: 'healthcheck.systemInfo',
      method: 'GET',
      defaultErrorCode: 'INTERNAL_SERVER_ERROR',
      upstreamFailureMessage: 'Healthcheck service unavailable',
      unavailableMessage: 'Healthcheck service unavailable',
      fetchImpl,
    })) as SystemInfo;

    if (!systemInfo || typeof systemInfo !== 'object' || !systemInfo.database) {
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
  live: publicProcedure.query(async () => forwardHealthcheckProcedure('healthcheck.live')),

  /**
   * Readiness probe - forwards to OpenPath API
   */
  ready: publicProcedure.query(async () => forwardHealthcheckProcedure('healthcheck.ready')),

  /**
   * System info for Settings page - forwards to OpenPath API
   */
  systemInfo: publicProcedure.query(async () => getGatewaySystemInfo()),
});
