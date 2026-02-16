import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { ACCESS_COOKIE_NAME, parseCookieValue } from '../lib/session-cookies.js';

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
  organizationId?: string;
  userRole?: string;
}

export async function createContext({ req, res }: CreateExpressContextOptions): Promise<Context> {
  const authHeader = req.headers.authorization;
  const cookieToken = parseCookieValue(req.headers.cookie, ACCESS_COOKIE_NAME);
  let user: JWTPayload | null = null;
  let token: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
    try {
      user = jwt.verify(token, config.jwtSecret) as JWTPayload;
    } catch {
      // Invalid token. Try cookie-based token fallback.
      token = null;
    }
  }

  if (!token && cookieToken) {
    try {
      token = cookieToken;
      user = jwt.verify(cookieToken, config.jwtSecret) as JWTPayload;
    } catch {
      token = null;
      user = null;
    }
  }

  return { user, token, req, res };
}
