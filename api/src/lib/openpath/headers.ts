export interface OpenPathForwardRequest {
  headers: Record<string, unknown>;
}

function headerToString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value.join(', ') : value;
}

export function getForwardHeaders(req: OpenPathForwardRequest): Record<string, string> {
  const xForwardedFor = headerToString(
    req.headers['x-forwarded-for'] as string | string[] | undefined
  );
  return xForwardedFor ? { 'X-Forwarded-For': xForwardedFor } : {};
}

export function buildOpenPathHeaders(params: {
  req?: OpenPathForwardRequest;
  token?: string | null;
  includeAuth?: boolean;
  extra?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(params.req ? getForwardHeaders(params.req) : {}),
    ...(params.extra ?? {}),
  };

  if (params.includeAuth && params.token) {
    headers.Authorization = `Bearer ${params.token}`;
  }

  return headers;
}
