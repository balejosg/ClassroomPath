/**
 * OpenPath gateway client interface and default singleton for the ClassroomPath API.
 *
 * Defines the OpenPathGateway interface and provides createOpenPathGateway, which
 * wraps every upstream OpenPath tRPC procedure call through callOpenPathTrpc in
 * api/src/lib/openpath/trpc-client.ts.  The pre-built openPathGateway singleton
 * is consumed by tRPC routers under api/src/trpc/routers/ and by the health-check
 * helpers exported from this same file.
 *
 * Non-obvious constraint: getSystemInfo returns a safe SYSTEM_INFO_FALLBACK
 * (degraded=true, upstreamAvailable=false) on any upstream error rather than
 * throwing -- callers must inspect the degraded flag, not catch an exception, to
 * detect an unreachable upstream.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { OpenPathForwardRequest } from './headers.js';
import { resolveGatewayConfig } from '../gateway-config.js';
import { resolveBareHttpOrigin } from '../public-origin.js';
import { parseOpenPathPayload } from './response.js';
import { callOpenPathTrpc, type OpenPathTrpcCallOptions } from './trpc-client.js';

const CANONICAL_WINDOWS_OFFLINE_INSTALLER_DOWNLOAD_PATH = '/api/windows-offline-installer/download';

function hasUrlUserInfo(value: string): boolean {
  const schemeSeparator = value.indexOf('://');
  if (schemeSeparator < 0) return true;

  const remainder = value.slice(schemeSeparator + 3);
  const suffixOffset = remainder.search(/[/?#]/u);
  const authority = suffixOffset === -1 ? remainder : remainder.slice(0, suffixOffset);
  return authority.includes('@');
}

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

const WINDOWS_OFFLINE_INSTALLER_METADATA_SCHEMA = z
  .object({
    fileName: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*\.exe$/i),
    version: z.string().min(1).max(128),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    tokenExpiresAt: z.string().min(1),
    downloadUrl: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            !url.username &&
            !url.password &&
            !hasUrlUserInfo(value) &&
            !value.includes('#') &&
            !url.hash &&
            url.pathname === CANONICAL_WINDOWS_OFFLINE_INSTALLER_DOWNLOAD_PATH &&
            url.searchParams.size === 1 &&
            Boolean(url.searchParams.get('ref'))
          );
        } catch {
          return false;
        }
      }),
    downloadExpiresAt: z.string().min(1),
  })
  .strict();

export type OpenPathWindowsOfflineInstallerMetadata = z.infer<
  typeof WINDOWS_OFFLINE_INSTALLER_METADATA_SCHEMA
>;

export type OpenPathWindowsOfflineInstallerInput = {
  classroomId: string;
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
  generateWindowsOfflineInstaller(
    params: AuthenticatedOpenPathGatewayParams & {
      input: OpenPathWindowsOfflineInstallerInput;
    }
  ): Promise<OpenPathWindowsOfflineInstallerMetadata>;
}

export interface OpenPathGatewayOptions {
  fetchImpl?: typeof fetch;
  publicOrigin?: string;
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

function throwSafeWindowsOfflineInstallerError(error: unknown): never {
  if (error instanceof TRPCError) {
    if (error.message === 'OpenPath returned invalid offline installer metadata') {
      throw error;
    }

    switch (error.code) {
      case 'UNAUTHORIZED':
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
      case 'FORBIDDEN':
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Classroom access denied' });
      case 'NOT_FOUND':
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Classroom not found' });
      case 'SERVICE_UNAVAILABLE':
      case 'BAD_GATEWAY':
      case 'GATEWAY_TIMEOUT':
      case 'TIMEOUT':
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'OpenPath offline installer capability unavailable',
        });
      default:
        break;
    }
  }

  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to generate offline installer',
  });
}

function resolvePublicOrigin(configuredOrigin: string): string {
  return resolveBareHttpOrigin(configuredOrigin, 'Invalid ClassroomPath public origin');
}

function rebuildPublicWindowsOfflineInstallerDownloadUrl(
  upstreamDownloadUrl: string,
  publicOrigin: string
): string {
  const upstreamUrl = new URL(upstreamDownloadUrl);
  const ref = upstreamUrl.searchParams.get('ref');

  if (!ref) {
    throw new Error('OpenPath returned an empty offline installer reference');
  }

  const publicUrl = new URL(CANONICAL_WINDOWS_OFFLINE_INSTALLER_DOWNLOAD_PATH, publicOrigin);
  publicUrl.searchParams.set('ref', ref);
  return publicUrl.toString();
}

export function createOpenPathGateway(options: OpenPathGatewayOptions = {}): OpenPathGateway {
  const fetchImpl = options.fetchImpl;
  const configuredPublicOrigin =
    options.publicOrigin === undefined ? undefined : resolvePublicOrigin(options.publicOrigin);

  const getPublicOrigin = (): string =>
    resolvePublicOrigin(configuredPublicOrigin ?? resolveGatewayConfig().publicOrigin);

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

    generateWindowsOfflineInstaller: async (params) => {
      try {
        const publicOrigin = getPublicOrigin();
        const payload = await callOpenPathTrpc(
          buildCallOptions(
            {
              procedure: 'windowsOfflineInstaller.generate',
              req: params.req,
              token: params.token,
              includeAuth: true,
              input: params.input,
              defaultErrorCode: 'INTERNAL_SERVER_ERROR',
              upstreamFailureMessage: 'Failed to generate offline installer',
              unavailableMessage: 'OpenPath offline installer capability unavailable',
              unavailableCode: 'SERVICE_UNAVAILABLE',
            },
            fetchImpl
          )
        );

        const metadata = parseOpenPathPayload(
          payload,
          WINDOWS_OFFLINE_INSTALLER_METADATA_SCHEMA,
          'OpenPath returned invalid offline installer metadata'
        );

        return {
          ...metadata,
          downloadUrl: rebuildPublicWindowsOfflineInstallerDownloadUrl(
            metadata.downloadUrl,
            publicOrigin
          ),
        };
      } catch (error) {
        throwSafeWindowsOfflineInstallerError(error);
      }
    },

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
