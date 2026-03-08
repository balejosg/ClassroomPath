import type { Response } from 'express';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';
import {
  callOpenPathTrpc,
  fetchOpenPathMeProfile,
  type OpenPathForwardRequest,
} from './openpath-upstream.js';
import {
  clearSessionCookies,
  parseCookieValue,
  REFRESH_COOKIE_NAME,
  storeSessionFromPayload,
} from './session-cookies.js';

interface OpenPathAuthCallOptions {
  procedure: string;
  req: OpenPathForwardRequest;
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

export async function forwardOpenPathAuthProcedure(
  options: OpenPathAuthCallOptions
): Promise<unknown> {
  return callOpenPathTrpc(options);
}

export async function forwardOpenPathSessionMutation(
  options: OpenPathSessionMutationOptions
): Promise<unknown> {
  const payload = await callOpenPathTrpc(options);
  return storeSessionFromPayload(options.res, payload);
}

export async function getOpenPathMeProfile(params: {
  req: OpenPathForwardRequest;
  token: string | null;
}) {
  return fetchOpenPathMeProfile({
    req: params.req,
    token: params.token,
  });
}

export async function logoutOpenPathSession(params: {
  req: OpenPathForwardRequest;
  res: Pick<Response, 'cookie'>;
  token: string | null;
  refreshToken?: string | null;
}): Promise<{ success: true }> {
  const cookieHeader =
    typeof params.req.headers.cookie === 'string' ? params.req.headers.cookie : undefined;
  const refreshToken = params.refreshToken ?? parseCookieValue(cookieHeader, REFRESH_COOKIE_NAME);

  try {
    await callOpenPathTrpc({
      procedure: 'auth.logout',
      req: params.req,
      token: params.token,
      includeAuth: true,
      input: refreshToken ? { refreshToken } : {},
      defaultErrorCode: 'UNAUTHORIZED',
      upstreamFailureMessage: 'Logout failed',
      unavailableMessage: 'Authentication service unavailable',
    });
  } catch {
    // Logout should always clear the local cookie session, even if upstream invalidation fails.
  } finally {
    clearSessionCookies(params.res);
  }

  return { success: true };
}
