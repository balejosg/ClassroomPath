import assert from 'node:assert/strict';

import { resolvedFetch } from './resolved-fetch.js';

type TrpcEnvelope<T> = {
  result?: {
    data?:
      | T
      | {
          json?: T;
        };
  };
  error?: unknown;
};

export interface ReleaseGateClientOptions {
  baseUrl: string;
  expectedOrigin?: string;
  requestOrigin?: string;
  resolvedAddress?: string;
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  options: Pick<ReleaseGateClientOptions, 'resolvedAddress' | 'timeoutMs'>
) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await resolvedFetch(
      input,
      {
        ...init,
        signal: controller.signal,
      },
      {
        resolvedAddress: options.resolvedAddress,
        timeoutMs,
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(
  input: string,
  init: RequestInit = {},
  options: Pick<ReleaseGateClientOptions, 'resolvedAddress' | 'timeoutMs'>,
  attempts = 3
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchWithTimeout(input, init, options);
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }

      await sleep(500 * attempt);
    }
  }

  throw lastError;
}

function unwrapTrpcEnvelope<T>(
  raw: TrpcEnvelope<T> | Array<TrpcEnvelope<T>>,
  procedure: string
): T {
  const envelope = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(!envelope?.error, `${procedure} returned tRPC error ${JSON.stringify(raw)}`);
  assert.ok(envelope?.result?.data, `${procedure} returned no result data`);

  const data = envelope.result.data;
  const json =
    data && typeof data === 'object' && 'json' in data ? (data.json as T | undefined) : data;
  assert.ok(json, `${procedure} returned no JSON payload`);
  return json as T;
}

export function createReleaseGateClient(options: ReleaseGateClientOptions) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const requestOrigin = options.requestOrigin ?? options.expectedOrigin;

  if (requestOrigin) {
    headers.Origin = requestOrigin;
  }

  return {
    async postTrpc<T>(procedure: string, payload: Record<string, unknown>): Promise<T> {
      const response = await fetchWithRetry(
        `${options.baseUrl}/cp/trpc/${procedure}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        },
        {
          resolvedAddress: options.resolvedAddress,
          timeoutMs: options.timeoutMs,
        }
      );

      assert.strictEqual(response.status, 200, `${procedure} returned ${response.status}`);

      const raw = (await response.json()) as TrpcEnvelope<T> | Array<TrpcEnvelope<T>>;
      return unwrapTrpcEnvelope(raw, procedure);
    },
  };
}

export function getVerificationToken(verificationUrl: string): string {
  const token = new URL(verificationUrl).searchParams.get('token');
  assert.ok(token, 'verificationUrl must include a token');
  return token;
}
