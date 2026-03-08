import type { Request } from 'express';

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }

  return typeof value === 'string' ? value : null;
}

export function getClientIp(
  req: Pick<Request, 'headers' | 'socket'> & Partial<Pick<Request, 'ip'>>
): string {
  const xForwardedFor = headerValue(req.headers['x-forwarded-for']);
  if (xForwardedFor) {
    const [clientIp] = xForwardedFor.split(',');
    if (clientIp && clientIp.trim().length > 0) {
      return clientIp.trim();
    }
  }

  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
