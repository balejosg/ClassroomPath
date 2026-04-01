import { lookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupAddress, LookupAllOptions, LookupOneOptions } from 'node:dns';

type ResolvedFetchOptions = {
  resolvedAddress?: string;
  timeoutMs?: number;
};

function getPort(url: URL): number {
  if (url.port) {
    return Number.parseInt(url.port, 10);
  }

  return url.protocol === 'https:' ? 443 : 80;
}

function normalizeBody(body: BodyInit | null | undefined): string | Buffer | undefined {
  if (body == null) {
    return undefined;
  }

  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  throw new TypeError(
    'resolvedFetch only supports string, Buffer, Uint8Array, and URLSearchParams bodies'
  );
}

function toNodeHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function toResponseHeaders(headers: http.IncomingHttpHeaders | http.OutgoingHttpHeaders): Headers {
  const responseHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        responseHeaders.append(key, item);
      }
      continue;
    }

    if (typeof value === 'string') {
      responseHeaders.append(key, value);
    }
  }

  return responseHeaders;
}

export async function resolvedFetch(
  input: string | URL,
  init: RequestInit = {},
  options: ResolvedFetchOptions = {}
): Promise<Response> {
  if (!options.resolvedAddress) {
    return fetch(input, init);
  }

  const url = input instanceof URL ? input : new URL(input);
  const requestHeaders = new Headers(init.headers ?? {});
  const requestBody = normalizeBody(init.body);
  const requestMethod = init.method ?? (requestBody ? 'POST' : 'GET');
  const transport = url.protocol === 'https:' ? https : http;

  return await new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: getPort(url),
        path: `${url.pathname}${url.search}`,
        method: requestMethod,
        headers: toNodeHeaders(requestHeaders),
        lookup(hostname, lookupOptions, callback) {
          if (hostname === url.hostname) {
            const family = options.resolvedAddress!.includes(':') ? 6 : 4;
            if (typeof lookupOptions === 'object' && (lookupOptions as LookupAllOptions).all) {
              callback(null, [
                {
                  address: options.resolvedAddress!,
                  family,
                } satisfies LookupAddress,
              ]);
              return;
            }

            callback(null, options.resolvedAddress!, family);
            return;
          }

          lookup(
            hostname,
            lookupOptions as LookupOneOptions | LookupAllOptions | number,
            callback as Parameters<typeof lookup>[2]
          );
        },
        servername: url.hostname,
        signal: init.signal,
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on('end', () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 500,
              statusText: response.statusMessage ?? '',
              headers: toResponseHeaders(response.headers),
            })
          );
        });

        response.on('error', reject);
      }
    );

    request.on('error', reject);

    if (options.timeoutMs && options.timeoutMs > 0) {
      request.setTimeout(options.timeoutMs, () => {
        request.destroy(new Error(`Request timed out after ${options.timeoutMs}ms`));
      });
    }

    if (requestBody !== undefined) {
      request.write(requestBody);
    }

    request.end();
  });
}
