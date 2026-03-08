import type { Request, RequestHandler, Response } from 'express';
import { nanoid } from 'nanoid';

export const REQUEST_ID_HEADER = 'X-Request-ID';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

function normalizeRequestId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!REQUEST_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function getRequestIdFromHeaders(headers: {
  [key: string]: string | string[] | undefined;
}): string {
  const headerValue = headers['x-request-id'];
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return normalizeRequestId(candidate) ?? nanoid();
}

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const requestId = getRequestIdFromHeaders(req.headers);
  req.requestId = requestId;
  req.headers['x-request-id'] = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
};

export function getRequestId(
  req: Pick<Request, 'headers' | 'requestId'>,
  _res?: Pick<Response, 'locals'>
): string {
  return req.requestId ?? getRequestIdFromHeaders(req.headers);
}

export const assignRequestId = requestIdMiddleware;
