// gateway-errors.ts
// Owns: GatewayErrorCode type, createGatewayErrorBody, isPayloadTooLargeError,
//       createGatewayErrorMiddleware.
// Must NOT own: CSP/header logic (gateway-headers.ts), rate-limit rules or
//       middleware (gateway-rate-limits.ts).

import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

import { logger } from './logger.js';
import { getRequestId } from './request-id.js';
import { getClientIp } from './http-request-meta.js';

export type GatewayErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'INTERNAL_SERVER_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'TOO_MANY_REQUESTS';

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

export function createGatewayErrorMiddleware(): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (isPayloadTooLargeError(error)) {
      next(error);
      return;
    }

    const requestId = getRequestId(req);

    logger.request(requestId).error('Unhandled gateway error', {
      method: req.method,
      path: req.originalUrl || req.url,
      ip: getClientIp(req),
      error: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json(
      createGatewayErrorBody('INTERNAL_SERVER_ERROR', 'Internal server error', {
        requestId,
      })
    );
  };
}
