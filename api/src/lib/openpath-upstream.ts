import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';
import { config } from '../config.js';
import { OpenPathMeResponseSchema } from './openpath-auth-schema.js';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

export function extractTrpcData<T>(data: unknown): T | null {
  if (typeof data !== 'object' || data === null) return null;
  const wrapped = data as { result?: { data?: T } };
  if (wrapped.result?.data !== undefined) return wrapped.result.data;
  return data as T;
}

export function openPathTrpcUrl(procedure: string): string {
  const base = config.openpathUrl.replace(/\/+$/, '');
  const cleaned = procedure.replace(/^\/trpc\//, '');
  return `${base}/trpc/${cleaned}`;
}

function headerToString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value.join(', ') : value;
}

export function getForwardHeaders(req: {
  headers: Record<string, unknown>;
}): Record<string, string> {
  const xForwardedFor = headerToString(
    req.headers['x-forwarded-for'] as string | string[] | undefined
  );
  return xForwardedFor ? { 'X-Forwarded-For': xForwardedFor } : {};
}

export function buildOpenPathHeaders(params: {
  req?: { headers: Record<string, unknown> };
  token?: string | null;
  includeAuth?: boolean;
  extra?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(params.req ? getForwardHeaders(params.req) : {}),
    ...(params.extra ?? {}),
  };

  if (params.includeAuth && params.token) {
    headers.Authorization = `Bearer ${params.token}`;
  }

  return headers;
}

export function extractUpstreamErrorMessage(body: unknown): string | null {
  const obj = asRecord(body);
  if (!obj) return null;

  // OpenPath rate-limit + REST error shape: { success:false, error: string, code: string }
  if (typeof obj.error === 'string' && obj.error.trim().length > 0) {
    return obj.error;
  }

  // tRPC error shape: { error: { message: string, ... } }
  const errObj = asRecord(obj.error);
  if (errObj && typeof errObj.message === 'string' && errObj.message.trim().length > 0) {
    return errObj.message;
  }

  // Some error shapes nest the payload under error.json
  const errJson = errObj ? asRecord(errObj.json) : null;
  if (errJson && typeof errJson.message === 'string' && errJson.message.trim().length > 0) {
    return errJson.message;
  }

  if (typeof obj.message === 'string' && obj.message.trim().length > 0) {
    return obj.message;
  }

  return null;
}

export async function readUpstreamErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const raw = await response.text().catch(() => '');
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return extractUpstreamErrorMessage(parsed) ?? fallback;
  } catch {
    // Non-JSON (e.g. HTML 502). Keep it short.
    return trimmed.slice(0, 300);
  }
}

export function mapUpstreamStatusToTrpcCode(
  status: number,
  defaultCode: TRPC_ERROR_CODE_KEY
): TRPC_ERROR_CODE_KEY {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 409) return 'CONFLICT';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 429) return 'TOO_MANY_REQUESTS';
  if (status === 502) return 'BAD_GATEWAY';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  if (status === 504) return 'GATEWAY_TIMEOUT';
  if (status >= 500) return 'INTERNAL_SERVER_ERROR';
  return defaultCode;
}

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

export async function validateOpenPathAccessToken(params: {
  req?: { headers: Record<string, unknown> };
  token: string;
}): Promise<OpenPathAuthValidationResult> {
  try {
    const response = await fetch(openPathTrpcUrl('auth.me'), {
      method: 'GET',
      headers: buildOpenPathHeaders({
        req: params.req,
        includeAuth: true,
        token: params.token,
      }),
    });

    if (!response.ok) {
      const message = await readUpstreamErrorMessage(
        response,
        response.status >= 500
          ? 'Authentication service unavailable'
          : 'Invalid authentication token'
      );

      if (response.status >= 500) {
        return {
          ok: false,
          code: 'SERVICE_UNAVAILABLE',
          message,
        };
      }

      return {
        ok: false,
        code: 'UNAUTHORIZED',
        message,
      };
    }

    const body: unknown = await response.json();
    const unwrapped = extractTrpcData<unknown>(body) ?? body;
    const parsed = OpenPathMeResponseSchema.safeParse(unwrapped);

    if (!parsed.success) {
      return {
        ok: false,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Authentication service unavailable',
      };
    }

    return {
      ok: true,
      user: {
        sub: parsed.data.user.id,
        email: parsed.data.user.email,
        name: parsed.data.user.name,
        roles: parsed.data.user.roles.map((role) => ({
          role: role.role,
          groupIds: role.groupIds,
        })),
      },
    };
  } catch {
    return {
      ok: false,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Authentication service unavailable',
    };
  }
}
