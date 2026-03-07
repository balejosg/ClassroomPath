import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { ACCESS_COOKIE_NAME, parseCookieValue } from '../lib/session-cookies.js';
import { validateOpenPathAccessToken } from '../lib/openpath-upstream.js';

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  roles: Array<{ role: string; groupIds: string[] }>;
}

export interface Context {
  user: JWTPayload | null;
  token: string | null; // Raw JWT token for forwarding to OpenPath API
  req: CreateExpressContextOptions['req'];
  res: CreateExpressContextOptions['res'];
  authFailure: {
    code: 'UNAUTHORIZED' | 'SERVICE_UNAVAILABLE';
    message: string;
  } | null;
  organizationId?: string;
  userRole?: string;
}

export async function createContext({ req, res }: CreateExpressContextOptions): Promise<Context> {
  const authHeader = req.headers.authorization;
  const cookieToken = parseCookieValue(req.headers.cookie, ACCESS_COOKIE_NAME);
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (cookieToken ?? null);

  if (!token) {
    return { user: null, token: null, req, res, authFailure: null };
  }

  const auth = await validateOpenPathAccessToken({
    req: req as unknown as { headers: Record<string, unknown> },
    token,
  });

  if (!auth.ok) {
    return {
      user: null,
      token,
      req,
      res,
      authFailure: {
        code: auth.code,
        message: auth.message,
      },
    };
  }

  return {
    user: auth.user,
    token,
    req,
    res,
    authFailure: null,
  };
}
