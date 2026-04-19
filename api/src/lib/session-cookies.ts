import type { Response } from 'express';

export const ACCESS_COOKIE_NAME = 'cp_access_token';
export const REFRESH_COOKIE_NAME = 'cp_refresh_token';
export const SESSION_MODE_COOKIE_NAME = 'cp_session_mode';
export const ACCESS_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const WEB_REFRESH_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export type SessionClientMode = 'web' | 'app';

export interface SessionTokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SessionCookieOptions {
  clientMode?: SessionClientMode;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function normalizeSessionClientMode(value: unknown): SessionClientMode | null {
  return value === 'app' || value === 'web' ? value : null;
}

export function parseSessionClientMode(cookieHeader: string | undefined): SessionClientMode | null {
  return normalizeSessionClientMode(parseCookieValue(cookieHeader, SESSION_MODE_COOKIE_NAME));
}

export function setSessionCookies(
  res: Pick<Response, 'cookie'>,
  tokens: SessionTokenPair,
  options: SessionCookieOptions = {}
): void {
  const secure = isProduction();
  const clientMode = options.clientMode ?? 'web';
  const refreshMaxAge =
    clientMode === 'app' ? REFRESH_COOKIE_MAX_AGE_MS : WEB_REFRESH_COOKIE_MAX_AGE_MS;

  res.cookie(ACCESS_COOKIE_NAME, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  });

  res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: refreshMaxAge,
  });

  res.cookie(SESSION_MODE_COOKIE_NAME, clientMode, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: refreshMaxAge,
  });
}

export function clearSessionCookies(res: Pick<Response, 'cookie'>): void {
  const secure = isProduction();
  const expiredAt = new Date(0);

  res.cookie(ACCESS_COOKIE_NAME, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiredAt,
  });

  res.cookie(REFRESH_COOKIE_NAME, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiredAt,
  });

  res.cookie(SESSION_MODE_COOKIE_NAME, '', {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiredAt,
  });
}

export function extractSessionTokens(value: unknown): SessionTokenPair | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.accessToken !== 'string' || typeof payload.refreshToken !== 'string') {
    return null;
  }

  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
  };
}

export function stripSessionTokens<T>(payload: T): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const {
    accessToken: _accessToken,
    refreshToken: _refreshToken,
    ...rest
  } = payload as Record<string, unknown>;
  return rest as T;
}

export function storeSessionFromPayload<T>(
  res: Pick<Response, 'cookie'>,
  payload: T,
  options: SessionCookieOptions = {}
): T {
  const tokens = extractSessionTokens(payload);
  if (tokens) {
    setSessionCookies(res, tokens, options);
  }
  return stripSessionTokens(payload);
}

export function parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rawValue.join('='));
      } catch {
        return rawValue.join('=');
      }
    }
  }

  return null;
}
