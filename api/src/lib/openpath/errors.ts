import type { TRPC_ERROR_CODE_KEY } from '@trpc/server/rpc';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

export function extractUpstreamErrorMessage(body: unknown): string | null {
  const obj = asRecord(body);
  if (!obj) return null;

  if (typeof obj.error === 'string' && obj.error.trim().length > 0) {
    return obj.error;
  }

  const errObj = asRecord(obj.error);
  if (errObj && typeof errObj.message === 'string' && errObj.message.trim().length > 0) {
    return errObj.message;
  }

  const errJson = errObj ? asRecord(errObj.json) : null;
  if (errJson && typeof errJson.message === 'string' && errJson.message.trim().length > 0) {
    return errJson.message;
  }

  if (typeof obj.message === 'string' && obj.message.trim().length > 0) {
    return obj.message;
  }

  return null;
}

export async function readUpstreamErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const raw = await response.text().catch(() => '');
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return extractUpstreamErrorMessage(parsed) ?? fallback;
  } catch {
    return trimmed.slice(0, 300);
  }
}

export function mapUpstreamStatusToTrpcCode(
  status: number,
  defaultCode: TRPC_ERROR_CODE_KEY
): TRPC_ERROR_CODE_KEY {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 409) return 'CONFLICT';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 429) return 'TOO_MANY_REQUESTS';
  if (status === 502) return 'BAD_GATEWAY';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  if (status === 504) return 'GATEWAY_TIMEOUT';
  if (status >= 500) return 'INTERNAL_SERVER_ERROR';
  return defaultCode;
}
