// gateway-headers.ts
// Owns: CSP builder, security-header middleware, CORS origin resolver,
//       CSRF protection middleware.
// Must NOT own: rate-limit rules or counters (gateway-rate-limits.ts),
//       error-body shape or error middleware (gateway-errors.ts).

import type { Request, RequestHandler } from 'express';

import { logger } from './logger.js';
import { getRequestId } from './request-id.js';
import { getClientIp } from './http-request-meta.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, parseCookieValue } from './session-cookies.js';
import { createGatewayErrorBody } from './gateway-errors.js';

export function buildGatewayContentSecurityPolicy(nodeEnv = process.env.NODE_ENV): string {
  const connectSources = ["'self'", 'https://accounts.google.com'];
  const styleSources = ["'self'", "'unsafe-inline'", 'https://accounts.google.com'];

  if (nodeEnv !== 'production') {
    connectSources.push('http://localhost:*', 'http://127.0.0.1:*', 'ws://localhost:*');
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: https:",
    `style-src ${styleSources.join(' ')}`,
    "font-src 'self' data: https://fonts.gstatic.com",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "frame-src 'self' https://accounts.google.com",
    `connect-src ${connectSources.join(' ')}`,
  ].join('; ');
}

export const applyGatewaySecurityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('Content-Security-Policy', buildGatewayContentSecurityPolicy());
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
};

export function createGatewayCorsOriginResolver(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);

  return (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ): void => {
    if (!origin) {
      callback(null, true);
      return;
    }

    callback(null, allowed.has(origin));
  };
}

function normalizeOrigin(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    return parsed.origin;
  } catch {
    return null;
  }
}

function getRequestOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}

function getHeaderOrigin(req: Request): string | null {
  const originHeader = req.get('origin');
  if (originHeader) {
    return normalizeOrigin(originHeader);
  }

  const refererHeader = req.get('referer');
  if (refererHeader) {
    return normalizeOrigin(refererHeader);
  }

  return null;
}

function isCookieAuthenticatedMutation(req: Request): boolean {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method.toUpperCase())) {
    return false;
  }

  const authHeader = req.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const cookieHeader = req.headers.cookie;
  return Boolean(
    parseCookieValue(cookieHeader, ACCESS_COOKIE_NAME) ||
    parseCookieValue(cookieHeader, REFRESH_COOKIE_NAME)
  );
}

export function createGatewayCsrfProtectionMiddleware(params: {
  allowedOrigins: string[];
  publicOrigin: string;
}): RequestHandler {
  const allowedOrigins = new Set([...params.allowedOrigins, params.publicOrigin]);

  return (req, res, next) => {
    if (!isCookieAuthenticatedMutation(req)) {
      next();
      return;
    }

    const requestId = getRequestId(req);
    const candidateOrigin = getHeaderOrigin(req);
    const requestOrigin = getRequestOrigin(req);

    if (
      candidateOrigin &&
      (allowedOrigins.has(candidateOrigin) || candidateOrigin === requestOrigin)
    ) {
      next();
      return;
    }

    logger
      .request(requestId)
      .warn('Rejected cookie-authenticated request with invalid CSRF origin', {
        method: req.method,
        path: req.originalUrl || req.url,
        candidateOrigin,
        requestOrigin,
        ip: getClientIp(req),
      });

    res.status(403).json(
      createGatewayErrorBody('FORBIDDEN', 'Invalid CSRF origin', {
        requestId,
      })
    );
  };
}
