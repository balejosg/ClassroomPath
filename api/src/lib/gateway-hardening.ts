import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { logger } from './logger.js';
import { getRequestId } from './request-id.js';
import { getClientIp } from './http-request-meta.js';

export interface GatewayRateLimitOptions {
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  onboardingRateLimitMax: number;
  onboardingRateLimitWindowMs: number;
}

export interface GatewayRateLimitRule {
  bucket: 'auth' | 'onboarding';
  limit: number;
  windowMs: number;
  matches: (path: string) => boolean;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

type GatewayErrorCode = 'FORBIDDEN' | 'PAYLOAD_TOO_LARGE' | 'TOO_MANY_REQUESTS';

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

export function createGatewayRateLimitRules(
  options: GatewayRateLimitOptions
): GatewayRateLimitRule[] {
  return [
    {
      bucket: 'auth',
      limit: options.authRateLimitMax,
      windowMs: options.authRateLimitWindowMs,
      matches: (path: string) =>
        /^\/(?:cp\/)?trpc\/auth\.(?:login|register|googleLogin|googleSignup|resetPassword|logout)(?:\?|$)/.test(
          path
        ),
    },
    {
      bucket: 'onboarding',
      limit: options.onboardingRateLimitMax,
      windowMs: options.onboardingRateLimitWindowMs,
      matches: (path: string) =>
        /^\/cp\/trpc\/onboarding\.(?:createOrganization|waitForInvitation|cancelWaiting)(?:\?|$)/.test(
          path
        ),
    },
  ];
}

export function createGatewayErrorBody(
  code: GatewayErrorCode,
  message: string,
  data: Record<string, unknown> = {}
): {
  error: {
    message: string;
    code: GatewayErrorCode;
    data: { code: GatewayErrorCode } & Record<string, unknown>;
  };
} {
  return {
    error: {
      message,
      code,
      data: {
        code,
        ...data,
      },
    },
  };
}

export function createRateLimitMiddleware(rules: GatewayRateLimitRule[]): RequestHandler {
  const entries = new Map<string, RateLimitEntry>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const path = req.originalUrl || req.url;
    const rule = rules.find((candidate) => candidate.matches(path));

    if (!rule) {
      next();
      return;
    }

    const now = Date.now();

    if (entries.size > 1000) {
      for (const [key, entry] of entries.entries()) {
        if (entry.resetAt <= now) {
          entries.delete(key);
        }
      }
    }

    const clientIp = getClientIp(req);
    const key = `${rule.bucket}:${clientIp}`;
    const existing = entries.get(key);
    const entry =
      existing && existing.resetAt > now
        ? existing
        : {
            count: 0,
            resetAt: now + rule.windowMs,
          };

    if (!existing || existing.resetAt <= now) {
      entries.set(key, entry);
    }

    if (entry.count >= rule.limit) {
      const retryAfterMs = Math.max(0, entry.resetAt - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      const requestId = getRequestId(req);

      logger.request(requestId).warn('Rate limit exceeded', {
        bucket: rule.bucket,
        ip: clientIp,
        method: req.method,
        path,
        retryAfterMs,
      });

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json(
        createGatewayErrorBody('TOO_MANY_REQUESTS', 'Too many requests', {
          bucket: rule.bucket,
          requestId,
          retryAfterMs,
        })
      );
      return;
    }

    entry.count += 1;
    res.setHeader('X-RateLimit-Limit', String(rule.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, rule.limit - entry.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    next();
  };
}

export function isPayloadTooLargeError(
  error: unknown
): error is { status?: number; statusCode?: number; type?: string } {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { status?: number; statusCode?: number; type?: string };
  return (
    candidate.status === 413 ||
    candidate.statusCode === 413 ||
    candidate.type === 'entity.too.large'
  );
}
