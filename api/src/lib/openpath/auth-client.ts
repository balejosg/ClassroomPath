import { TRPCError } from '@trpc/server';

import {
  OpenPathEmailVerificationPayloadSchema,
  OpenPathMeResponseSchema,
  OpenPathRegistrationPayloadSchema,
  OpenPathSessionPayloadSchema,
  type OpenPathEmailVerificationPayload,
  type OpenPathMeResponse,
  type OpenPathRegistrationPayload,
  type OpenPathSessionPayload,
} from '../openpath-auth-schema.js';
import { parseOpenPathPayload } from './response.js';
import {
  callOpenPathTrpc,
  type OpenPathTrpcCallOptions,
  type UpstreamFailureMessage,
} from './trpc-client.js';
import type { OpenPathForwardRequest } from './headers.js';

export interface AuthenticatedOpenPathUser {
  sub: string;
  email: string;
  name: string;
  roles: Array<{ role: string; groupIds: string[] }>;
}

export type OpenPathAuthValidationResult =
  | {
      ok: true;
      user: AuthenticatedOpenPathUser;
    }
  | {
      ok: false;
      code: 'UNAUTHORIZED' | 'SERVICE_UNAVAILABLE';
      message: string;
    };

export async function fetchOpenPathMeProfile(params: {
  req?: OpenPathForwardRequest;
  token: string | null;
  fetchImpl?: typeof fetch;
  upstreamFailureMessage?: UpstreamFailureMessage;
  unavailableMessage?: string;
}): Promise<OpenPathMeResponse> {
  const payload = await callOpenPathTrpc({
    procedure: 'auth.me',
    method: 'GET',
    req: params.req,
    token: params.token,
    includeAuth: true,
    defaultErrorCode: 'UNAUTHORIZED',
    upstreamFailureMessage: params.upstreamFailureMessage ?? 'Failed to get user profile',
    unavailableMessage: params.unavailableMessage ?? 'Authentication service unavailable',
    fetchImpl: params.fetchImpl,
  });

  return parseOpenPathPayload(
    payload,
    OpenPathMeResponseSchema,
    'Invalid user profile received from upstream'
  );
}

async function callTypedAuthProcedure<T>(
  options: OpenPathTrpcCallOptions,
  invalidMessage: string,
  schema:
    | typeof OpenPathRegistrationPayloadSchema
    | typeof OpenPathSessionPayloadSchema
    | typeof OpenPathEmailVerificationPayloadSchema
): Promise<T> {
  const payload = await callOpenPathTrpc(options);
  return parseOpenPathPayload(payload, schema as never, invalidMessage) as T;
}

export async function registerOpenPathUser(params: {
  req?: OpenPathForwardRequest;
  input: {
    email: string;
    name: string;
    password: string;
  };
  fetchImpl?: typeof fetch;
  unavailableMessage?: string;
  upstreamFailureMessage?: UpstreamFailureMessage;
}): Promise<OpenPathRegistrationPayload> {
  return callTypedAuthProcedure<OpenPathRegistrationPayload>(
    {
      procedure: 'auth.register',
      req: params.req,
      input: params.input,
      defaultErrorCode: 'BAD_REQUEST',
      upstreamFailureMessage: params.upstreamFailureMessage ?? 'Registration failed',
      unavailableMessage: params.unavailableMessage ?? 'Registration service unavailable',
      fetchImpl: params.fetchImpl,
    },
    'Invalid registration payload received from upstream',
    OpenPathRegistrationPayloadSchema
  );
}

export async function loginOpenPathUser(params: {
  req?: OpenPathForwardRequest;
  input: {
    email: string;
    password: string;
  };
  fetchImpl?: typeof fetch;
  unavailableMessage?: string;
  upstreamFailureMessage?: UpstreamFailureMessage;
}): Promise<OpenPathSessionPayload> {
  return callTypedAuthProcedure<OpenPathSessionPayload>(
    {
      procedure: 'auth.login',
      req: params.req,
      input: params.input,
      defaultErrorCode: 'UNAUTHORIZED',
      upstreamFailureMessage: params.upstreamFailureMessage ?? 'Login failed',
      unavailableMessage: params.unavailableMessage ?? 'Authentication service unavailable',
      fetchImpl: params.fetchImpl,
    },
    'Invalid session payload received from upstream',
    OpenPathSessionPayloadSchema
  );
}

export async function googleLoginOpenPathUser(params: {
  req?: OpenPathForwardRequest;
  input: {
    idToken: string;
  };
  fetchImpl?: typeof fetch;
  unavailableMessage?: string;
  upstreamFailureMessage?: UpstreamFailureMessage;
}): Promise<OpenPathSessionPayload> {
  return callTypedAuthProcedure<OpenPathSessionPayload>(
    {
      procedure: 'auth.googleLogin',
      req: params.req,
      input: params.input,
      defaultErrorCode: 'UNAUTHORIZED',
      upstreamFailureMessage: params.upstreamFailureMessage ?? 'Google login failed',
      unavailableMessage: params.unavailableMessage ?? 'Authentication service unavailable',
      fetchImpl: params.fetchImpl,
    },
    'Invalid session payload received from upstream',
    OpenPathSessionPayloadSchema
  );
}

export async function generateOpenPathEmailVerificationToken(params: {
  req?: OpenPathForwardRequest;
  input: {
    email: string;
  };
  fetchImpl?: typeof fetch;
  unavailableMessage?: string;
  upstreamFailureMessage?: UpstreamFailureMessage;
}): Promise<OpenPathEmailVerificationPayload> {
  return callTypedAuthProcedure<OpenPathEmailVerificationPayload>(
    {
      procedure: 'auth.generateEmailVerificationToken',
      req: params.req,
      input: params.input,
      defaultErrorCode: 'BAD_REQUEST',
      upstreamFailureMessage:
        params.upstreamFailureMessage ?? 'Verification token generation failed',
      unavailableMessage: params.unavailableMessage ?? 'Authentication service unavailable',
      fetchImpl: params.fetchImpl,
    },
    'Invalid email verification payload received from upstream',
    OpenPathEmailVerificationPayloadSchema
  );
}

export async function validateOpenPathAccessToken(params: {
  req?: { headers: Record<string, unknown> };
  token: string;
}): Promise<OpenPathAuthValidationResult> {
  try {
    const profile = await fetchOpenPathMeProfile({
      req: params.req,
      token: params.token,
      upstreamFailureMessage: (status) =>
        status >= 500 ? 'Authentication service unavailable' : 'Invalid authentication token',
      unavailableMessage: 'Authentication service unavailable',
    });

    return {
      ok: true,
      user: {
        sub: profile.user.id,
        email: profile.user.email,
        name: profile.user.name,
        roles: profile.user.roles.map((role) => ({
          role: role.role,
          groupIds: role.groupIds,
        })),
      },
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      if (error.code === 'UNAUTHORIZED') {
        return {
          ok: false,
          code: 'UNAUTHORIZED',
          message: error.message,
        };
      }

      return {
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Authentication service unavailable',
      };
    }

    return {
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication service unavailable',
    };
  }
}
