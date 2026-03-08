import type { Response } from 'express';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';
import { TRPCError } from '@trpc/server';
import { OpenPathMeResponseSchema, type OpenPathMeResponse } from './openpath-auth-schema.js';
import {
  buildOpenPathHeaders,
  extractTrpcData,
  mapUpstreamStatusToTrpcCode,
  openPathTrpcUrl,
  readUpstreamErrorMessage,
} from './openpath-upstream.js';
import { storeSessionFromPayload } from './session-cookies.js';

interface OpenPathRequest {
  headers: Record<string, unknown>;
}

interface OpenPathAuthCallOptions {
  procedure: string;
  req: OpenPathRequest;
  input?: unknown;
  method?: 'GET' | 'POST';
  token?: string | null;
  includeAuth?: boolean;
  defaultErrorCode: TRPC_ERROR_CODE_KEY;
  upstreamFailureMessage: string;
  unavailableMessage: string;
}

interface OpenPathSessionMutationOptions extends OpenPathAuthCallOptions {
  res: Pick<Response, 'cookie'>;
}

async function callOpenPathAuth(options: OpenPathAuthCallOptions): Promise<unknown> {
  try {
    const response = await fetch(openPathTrpcUrl(options.procedure), {
      method: options.method ?? 'POST',
      headers: buildOpenPathHeaders({
        req: options.req,
        includeAuth: options.includeAuth,
        token: options.token,
      }),
      ...(options.input === undefined ? {} : { body: JSON.stringify(options.input) }),
    });

    if (!response.ok) {
      const message = await readUpstreamErrorMessage(response, options.upstreamFailureMessage);
      const code = mapUpstreamStatusToTrpcCode(response.status, options.defaultErrorCode);
      throw new TRPCError({
        code,
        message,
      });
    }

    const body: unknown = await response.json();
    return extractTrpcData<unknown>(body) ?? body;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: options.unavailableMessage,
    });
  }
}

export async function forwardOpenPathAuthProcedure(
  options: OpenPathAuthCallOptions
): Promise<unknown> {
  return callOpenPathAuth(options);
}

export async function forwardOpenPathSessionMutation(
  options: OpenPathSessionMutationOptions
): Promise<unknown> {
  const payload = await callOpenPathAuth(options);
  return storeSessionFromPayload(options.res, payload);
}

export async function getOpenPathMeProfile(params: {
  req: OpenPathRequest;
  token: string | null;
}): Promise<OpenPathMeResponse> {
  const payload = await callOpenPathAuth({
    procedure: 'auth.me',
    req: params.req,
    token: params.token,
    includeAuth: true,
    method: 'GET',
    defaultErrorCode: 'UNAUTHORIZED',
    upstreamFailureMessage: 'Failed to get user profile',
    unavailableMessage: 'Authentication service unavailable',
  });

  const parsed = OpenPathMeResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Invalid user profile received from upstream',
    });
  }

  return parsed.data;
}
