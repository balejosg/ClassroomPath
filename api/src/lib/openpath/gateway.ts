import { TRPCError } from '@trpc/server';

import type { OpenPathForwardRequest } from './headers.js';
import { callOpenPathTrpc, type OpenPathTrpcCallOptions } from './trpc-client.js';

export type OpenPathGatewaySystemInfo = {
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

export type OpenPathGatewaySystemInfoStatus = OpenPathGatewaySystemInfo & {
  degraded: boolean;
  upstreamAvailable: boolean;
  databaseConnected: boolean;
};

export type OpenPathApiTokenListItem = {
  id: string;
  name: string;
  maskedToken: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  isExpired: boolean;
};

export type OpenPathApiTokenCreateInput = {
  name: string;
  expiresInDays?: number;
};

export type OpenPathApiTokenIdInput = {
  id: string;
};

export interface OpenPathGateway {
  healthLive(): Promise<unknown>;
  healthReady(): Promise<unknown>;
  getSystemInfo(): Promise<OpenPathGatewaySystemInfo>;
  listApiTokens(params: AuthenticatedOpenPathGatewayParams): Promise<OpenPathApiTokenListItem[]>;
  createApiToken(
    params: AuthenticatedOpenPathGatewayParams & { input: OpenPathApiTokenCreateInput }
  ): Promise<unknown>;
  revokeApiToken(
    params: AuthenticatedOpenPathGatewayParams & { input: OpenPathApiTokenIdInput }
  ): Promise<unknown>;
  regenerateApiToken(
    params: AuthenticatedOpenPathGatewayParams & { input: OpenPathApiTokenIdInput }
  ): Promise<unknown>;
}

export interface OpenPathGatewayOptions {
  fetchImpl?: typeof fetch;
}

export interface AuthenticatedOpenPathGatewayParams {
  req?: OpenPathForwardRequest;
  token: string | null;
}

const SYSTEM_INFO_FALLBACK: OpenPathGatewaySystemInfo = {
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

function buildCallOptions(
  options: Omit<OpenPathTrpcCallOptions, 'fetchImpl'>,
  fetchImpl: typeof fetch | undefined
): OpenPathTrpcCallOptions {
  return {
    ...options,
    fetchImpl,
  };
}

function isSystemInfo(payload: unknown): payload is OpenPathGatewaySystemInfo {
  return Boolean(payload && typeof payload === 'object' && 'database' in payload);
}

function requireApiTokenList(payload: unknown): OpenPathApiTokenListItem[] {
  if (Array.isArray(payload)) {
    return payload as OpenPathApiTokenListItem[];
  }

  throw new TRPCError({
    code: 'SERVICE_UNAVAILABLE',
    message: 'API tokens service unavailable',
  });
}

export function createOpenPathGateway(options: OpenPathGatewayOptions = {}): OpenPathGateway {
  const fetchImpl = options.fetchImpl;

  return {
    healthLive: () =>
      callOpenPathTrpc(
        buildCallOptions(
          {
            procedure: 'healthcheck.live',
            method: 'GET',
            defaultErrorCode: 'INTERNAL_SERVER_ERROR',
            upstreamFailureMessage: 'Healthcheck service unavailable',
            unavailableMessage: 'Healthcheck service unavailable',
          },
          fetchImpl
        )
      ),

    healthReady: () =>
      callOpenPathTrpc(
        buildCallOptions(
          {
            procedure: 'healthcheck.ready',
            method: 'GET',
            defaultErrorCode: 'INTERNAL_SERVER_ERROR',
            upstreamFailureMessage: 'Healthcheck service unavailable',
            unavailableMessage: 'Healthcheck service unavailable',
          },
          fetchImpl
        )
      ),

    getSystemInfo: async () => {
      const payload = await callOpenPathTrpc(
        buildCallOptions(
          {
            procedure: 'healthcheck.systemInfo',
            method: 'GET',
            defaultErrorCode: 'INTERNAL_SERVER_ERROR',
            upstreamFailureMessage: 'Healthcheck service unavailable',
            unavailableMessage: 'Healthcheck service unavailable',
          },
          fetchImpl
        )
      );

      if (!isSystemInfo(payload)) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Healthcheck service unavailable',
        });
      }

      return payload;
    },

    listApiTokens: async (params) => {
      const payload = await callOpenPathTrpc(
        buildCallOptions(
          {
            procedure: 'apiTokens.list',
            method: 'GET',
            req: params.req,
            token: params.token,
            includeAuth: true,
            defaultErrorCode: 'SERVICE_UNAVAILABLE',
            upstreamFailureMessage: 'API tokens service unavailable',
            unavailableMessage: 'API tokens service unavailable',
            unavailableCode: 'SERVICE_UNAVAILABLE',
          },
          fetchImpl
        )
      );

      return requireApiTokenList(payload);
    },

    createApiToken: (params) =>
      callOpenPathTrpc(
        buildCallOptions(
          {
            procedure: 'apiTokens.create',
            req: params.req,
            token: params.token,
            includeAuth: true,
            input: params.input,
            defaultErrorCode: 'INTERNAL_SERVER_ERROR',
            upstreamFailureMessage: 'Failed to create API token',
            unavailableMessage: 'API tokens service unavailable',
          },
          fetchImpl
        )
      ),

    revokeApiToken: (params) =>
      callOpenPathTrpc(
        buildCallOptions(
          {
            procedure: 'apiTokens.revoke',
            req: params.req,
            token: params.token,
            includeAuth: true,
            input: params.input,
            defaultErrorCode: 'NOT_FOUND',
            upstreamFailureMessage: 'Failed to revoke API token',
            unavailableMessage: 'API tokens service unavailable',
          },
          fetchImpl
        )
      ),

    regenerateApiToken: (params) =>
      callOpenPathTrpc(
        buildCallOptions(
          {
            procedure: 'apiTokens.regenerate',
            req: params.req,
            token: params.token,
            includeAuth: true,
            input: params.input,
            defaultErrorCode: 'NOT_FOUND',
            upstreamFailureMessage: 'Failed to regenerate API token',
            unavailableMessage: 'API tokens service unavailable',
          },
          fetchImpl
        )
      ),
  };
}

export const openPathGateway = createOpenPathGateway();

export async function forwardOpenPathHealthcheck(
  procedure: 'healthcheck.live' | 'healthcheck.ready',
  gateway: OpenPathGateway = openPathGateway
): Promise<unknown> {
  try {
    return procedure === 'healthcheck.live'
      ? await gateway.healthLive()
      : await gateway.healthReady();
  } catch {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Healthcheck service unavailable',
    });
  }
}

export async function getOpenPathGatewaySystemInfo(
  gateway: OpenPathGateway = openPathGateway
): Promise<OpenPathGatewaySystemInfoStatus> {
  try {
    const systemInfo = await gateway.getSystemInfo();

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
