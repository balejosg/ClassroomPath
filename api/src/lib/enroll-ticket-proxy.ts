import { ACCESS_COOKIE_NAME, parseCookieValue } from './session-cookies.js';

const ENROLL_TICKET_PATH_REGEX = /^\/api\/enroll\/[^/]+\/ticket(?:\?|$)/;

type ProxyRequestLike = {
  setHeader: (name: string, value: string) => void;
};

type IncomingRequestLike = {
  method?: string;
  url?: string;
  headers: Record<string, unknown>;
};

function cookieHeaderToString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((x) => typeof x === 'string').join('; ');
  return undefined;
}

export function injectEnrollTicketAuth(proxyReq: ProxyRequestLike, req: IncomingRequestLike): void {
  const url = req.url ?? '';
  if (req.method !== 'POST' || !ENROLL_TICKET_PATH_REGEX.test(url)) {
    return;
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.length > 0) {
    return;
  }

  const cookieHeader = cookieHeaderToString(req.headers.cookie);
  const cookieToken = parseCookieValue(cookieHeader, ACCESS_COOKIE_NAME);
  if (cookieToken) {
    proxyReq.setHeader('Authorization', `Bearer ${cookieToken}`);
  }
}
