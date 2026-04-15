import { TRPCError } from '@trpc/server';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';

import { config } from '../../config.js';
import { buildOpenPathHeaders, type OpenPathForwardRequest } from './headers.js';
import { mapUpstreamStatusToTrpcCode, readUpstreamErrorMessage } from './errors.js';
import { extractTrpcData } from './response.js';

export type UpstreamFailureMessage = string | ((status: number) => string);

export interface OpenPathTrpcCallOptions {
  procedure: string;
  req?: OpenPathForwardRequest;
  input?: unknown;
  method?: 'GET' | 'POST';
  token?: string | null;
  includeAuth?: boolean;
  defaultErrorCode: TRPC_ERROR_CODE_KEY;
  upstreamFailureMessage: UpstreamFailureMessage;
  unavailableMessage: string;
  unavailableCode?: TRPC_ERROR_CODE_KEY;
  mapStatusToCode?: (status: number, defaultCode: TRPC_ERROR_CODE_KEY) => TRPC_ERROR_CODE_KEY;
  fetchImpl?: typeof fetch;
}

export function openPathTrpcUrl(procedure: string): string {
  const base = config.openpathUrl.replace(/\/+$/, '');
  const cleaned = procedure.replace(/^\/trpc\//, '');
  return `${base}/trpc/${cleaned}`;
}

function resolveUpstreamFailureMessage(message: UpstreamFailureMessage, status: number): string {
  return typeof message === 'function' ? message(status) : message;
}

export async function callOpenPathTrpc(options: OpenPathTrpcCallOptions): Promise<unknown> {
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(openPathTrpcUrl(options.procedure), {
      method: options.method ?? (options.input === undefined ? 'GET' : 'POST'),
      headers: buildOpenPathHeaders({
        req: options.req,
        includeAuth: options.includeAuth,
        token: options.token,
      }),
      ...(options.input === undefined ? {} : { body: JSON.stringify(options.input) }),
    });

    if (!response.ok) {
      const message = await readUpstreamErrorMessage(
        response,
        resolveUpstreamFailureMessage(options.upstreamFailureMessage, response.status)
      );
      const code = (options.mapStatusToCode ?? mapUpstreamStatusToTrpcCode)(
        response.status,
        options.defaultErrorCode
      );
      throw new TRPCError({ code, message });
    }

    const body: unknown = await response.json();
    return extractTrpcData<unknown>(body) ?? body;
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    throw new TRPCError({
      code: options.unavailableCode ?? 'INTERNAL_SERVER_ERROR',
      message: options.unavailableMessage,
    });
  }
}
