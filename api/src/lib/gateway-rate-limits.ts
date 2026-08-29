// gateway-rate-limits.ts
// Owns: GatewayRateLimitOptions/Rule interfaces, createGatewayRateLimitRules,
//       in-memory rate-limit counter, createRateLimitMiddleware.
// Must NOT own: CSP or security-header logic (gateway-headers.ts),
//       error-body shape or error middleware (gateway-errors.ts).

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { logger, redactSensitiveUrlText } from './logger.js';
import { getRequestId } from './request-id.js';
import { getClientIp } from './http-request-meta.js';
import { createGatewayErrorBody } from './gateway-errors.js';

export interface GatewayRateLimitOptions {
  agentDeliveryRateLimitMax: number;
  agentDeliveryRateLimitWindowMs: number;
  authRateLimitMax: number;
  authRateLimitWindowMs: number;
  globalRateLimitMax: number;
  globalRateLimitWindowMs: number;
  onboardingRateLimitMax: number;
  onboardingRateLimitWindowMs: number;
}

export interface GatewayRateLimitRule {
  bucket: 'agentDelivery' | 'auth' | 'global' | 'onboarding';
  limit: number;
  windowMs: number;
  matches: (path: string) => boolean;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function isAgentDeliveryPath(path: string): boolean {
  return /^\/api\/agent\/(?:windows|linux)(?:[/?]|$)/.test(path);
}

export function createGatewayRateLimitRules(
  options: GatewayRateLimitOptions
): GatewayRateLimitRule[] {
  return [
    {
      bucket: 'auth',
      limit: options.authRateLimitMax,
      windowMs: options.authRateLimitWindowMs,
      matches: (path: string) =>
        /^\/(?:cp\/)?trpc\/auth\.(?:login|register|googleLogin|googleSignup|resetPassword|changePassword|logout)(?:\?|$)/.test(
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
    {
      bucket: 'agentDelivery',
      limit: options.agentDeliveryRateLimitMax,
      windowMs: options.agentDeliveryRateLimitWindowMs,
      matches: isAgentDeliveryPath,
    },
    {
      bucket: 'global',
      limit: options.globalRateLimitMax,
      windowMs: options.globalRateLimitWindowMs,
      matches: (path: string) =>
        !/^\/cp\/(?:health|ready)(?:\?|$)/.test(path) && !isAgentDeliveryPath(path),
    },
  ];
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
        path: redactSensitiveUrlText(path),
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
