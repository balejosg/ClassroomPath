import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { CURRENT_TERMS_VERSION } from '../api/src/services/legal-consent.service.js';
import { resolvedFetch } from './helpers/resolved-fetch.js';

type TrpcEnvelope<T> = {
  result?: {
    data?: {
      json?: T;
    } & T;
  };
  error?: {
    data?: {
      retryAfterMs?: number;
    };
  };
};

type RegistrationPayload = {
  email?: string;
  verificationUrl?: string;
};

type ClassroomPayload = {
  id: string;
  name?: string;
};

type EnrollmentTicketPayload = {
  success?: boolean;
  enrollmentToken?: string;
};

type BootstrapManifest = {
  success: boolean;
  files: Array<{ path: string; sha256: string; size: number }>;
};

type FirefoxReleaseMetadata = {
  extensionId?: string;
  version?: string;
};

function extractTrpcData<T>(envelope: TrpcEnvelope<T> | undefined): T | undefined {
  const data = envelope?.result?.data;
  if (!data) {
    return undefined;
  }

  return (data.json ?? data) as T;
}

function extractRetryAfterMs(envelope: TrpcEnvelope<unknown> | undefined): number | null {
  const retryAfterMs = envelope?.error?.data?.retryAfterMs;
  return typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : null;
}

test('extractTrpcData supports direct result.data payloads', () => {
  assert.deepEqual(
    extractTrpcData<{ email: string }>({
      result: {
        data: {
          email: 'teacher@example.com',
        },
      },
    }),
    {
      email: 'teacher@example.com',
    }
  );
});

test('extractTrpcData preserves nested result.data.json payloads', () => {
  assert.deepEqual(
    extractTrpcData<{ email: string }>({
      result: {
        data: {
          json: {
            email: 'teacher@example.com',
          },
        },
      },
    }),
    {
      email: 'teacher@example.com',
    }
  );
});

test('extractRetryAfterMs reads tRPC retry delays from rate-limit errors', () => {
  assert.equal(
    extractRetryAfterMs({
      error: {
        data: {
          retryAfterMs: 2500,
        },
      },
    }),
    2500
  );
});

const WINDOWS_BOOTSTRAP_GATE_URL = process.env.WINDOWS_BOOTSTRAP_GATE_URL;
const WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN =
  process.env.WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN ??
  (WINDOWS_BOOTSTRAP_GATE_URL ? new URL(WINDOWS_BOOTSTRAP_GATE_URL).origin : '');
const WINDOWS_BOOTSTRAP_GATE_TIMEOUT = Number.parseInt(
  process.env.WINDOWS_BOOTSTRAP_GATE_TIMEOUT ?? '30000',
  10
);
const EXPECTED_EXTENSION_ID = process.env.WINDOWS_BOOTSTRAP_GATE_EXPECTED_EXTENSION_ID ?? '';
const EXPECTED_VERSION = process.env.WINDOWS_BOOTSTRAP_GATE_EXPECTED_VERSION ?? '';
const EXPECTED_METADATA_SHA256 = process.env.WINDOWS_BOOTSTRAP_GATE_EXPECTED_METADATA_SHA256 ?? '';
const EXPECTED_XPI_SHA256 = process.env.WINDOWS_BOOTSTRAP_GATE_EXPECTED_XPI_SHA256 ?? '';
const WINDOWS_BOOTSTRAP_GATE_RESOLVED_ADDRESS = process.env.WINDOWS_BOOTSTRAP_GATE_RESOLVED_ADDRESS;

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WINDOWS_BOOTSTRAP_GATE_TIMEOUT);

  try {
    return await resolvedFetch(
      input,
      {
        ...init,
        signal: controller.signal,
      },
      {
        resolvedAddress: WINDOWS_BOOTSTRAP_GATE_RESOLVED_ADDRESS,
        timeoutMs: WINDOWS_BOOTSTRAP_GATE_TIMEOUT,
      }
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(
  input: string,
  init: RequestInit = {},
  attempts = 3
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchWithTimeout(input, init);
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

function extractTokenFromVerificationUrl(verificationUrl: string): string {
  const url = new URL(verificationUrl);
  const token = url.searchParams.get('token');
  assert.ok(token, 'verificationUrl should include a verification token');
  return token;
}

function sha256Hex(input: Uint8Array | string): string {
  return createHash('sha256').update(input).digest('hex');
}

function extractCookies(response: Response): string {
  const headersWithGetSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const rawCookies =
    headersWithGetSetCookie.getSetCookie?.() ??
    (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')!] : []);

  const cookiePairs = rawCookies
    .flatMap((header) => header.split(/,(?=[^;,\s]+=)/))
    .map((cookie) => cookie.split(';', 1)[0]?.trim())
    .filter((cookie): cookie is string => Boolean(cookie));

  return cookiePairs.join('; ');
}

async function postTrpc<T>(
  procedure: string,
  payload: Record<string, unknown>,
  cookieHeader = ''
): Promise<{ data: T; response: Response }> {
  assert.ok(WINDOWS_BOOTSTRAP_GATE_URL, 'WINDOWS_BOOTSTRAP_GATE_URL must be set');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN) {
    headers.Origin = WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN;
  }

  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetchWithRetry(`${WINDOWS_BOOTSTRAP_GATE_URL}/cp/trpc/${procedure}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const raw = (await response.json()) as TrpcEnvelope<T> | Array<TrpcEnvelope<T>>;
    const envelope = Array.isArray(raw) ? raw[0] : raw;

    if (response.status === 429) {
      const retryAfterMs = extractRetryAfterMs(envelope);
      if (retryAfterMs && attempt < 3) {
        await sleep(retryAfterMs + 250);
        continue;
      }
    }

    assert.strictEqual(response.status, 200, `${procedure} returned ${response.status}`);
    assert.ok(!envelope?.error, `${procedure} returned tRPC error ${JSON.stringify(raw)}`);
    const data = extractTrpcData(envelope);
    assert.ok(data, `${procedure} returned no JSON payload`);
    return { data: data as T, response };
  }

  throw new Error(`${procedure} exhausted retry attempts`);
}

describe(
  'Windows bootstrap gate',
  {
    skip: !WINDOWS_BOOTSTRAP_GATE_URL,
  },
  () => {
    test('staging bootstrap endpoints expose signed Firefox release artifacts', async () => {
      const email = uniqueEmail('windows-bootstrap-gate');
      const password = 'SecurePassword123!';

      const { data: registration } = await postTrpc<RegistrationPayload>('auth.register', {
        email,
        name: 'Windows Bootstrap Gate',
        password,
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
      });

      assert.equal(registration.email, email);
      assert.equal(typeof registration.verificationUrl, 'string');

      await postTrpc('auth.verifyEmail', {
        email,
        token: extractTokenFromVerificationUrl(registration.verificationUrl!),
      });

      const loginResult = await postTrpc('auth.login', { email, password });
      const initialCookieHeader = extractCookies(loginResult.response);
      assert.ok(initialCookieHeader.length > 0, 'auth.login should issue a session cookie');

      await postTrpc(
        'onboarding.createOrganization',
        {
          name: `Bootstrap Gate Org ${Date.now()}`,
        },
        initialCookieHeader
      );

      const refreshedLoginResult = await postTrpc('auth.login', { email, password });
      const cookieHeader = extractCookies(refreshedLoginResult.response);
      assert.ok(
        cookieHeader.length > 0,
        'auth.login should reissue a session cookie after organization onboarding'
      );

      const { data: classroom } = await postTrpc<ClassroomPayload>(
        'classrooms.create',
        {
          name: `bootstrap-gate-${Date.now()}`,
          displayName: 'Bootstrap Gate Classroom',
        },
        cookieHeader
      );

      assert.ok(classroom.id, 'classrooms.create should return a classroom id');

      const ticketResponse = await fetchWithRetry(
        `${WINDOWS_BOOTSTRAP_GATE_URL}/api/enroll/${classroom.id}/ticket`,
        {
          method: 'POST',
          headers: {
            Cookie: cookieHeader,
            ...(WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN
              ? { Origin: WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN }
              : {}),
          },
        }
      );

      assert.strictEqual(ticketResponse.status, 200, `ticket returned ${ticketResponse.status}`);
      const ticketPayload = (await ticketResponse.json()) as EnrollmentTicketPayload;
      assert.equal(ticketPayload.success, true);
      assert.equal(typeof ticketPayload.enrollmentToken, 'string');

      const authHeaders = {
        Authorization: `Bearer ${ticketPayload.enrollmentToken!}`,
        ...(WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN
          ? { Origin: WINDOWS_BOOTSTRAP_GATE_REQUEST_ORIGIN }
          : {}),
      };

      const manifestResponse = await fetchWithRetry(
        `${WINDOWS_BOOTSTRAP_GATE_URL}/api/agent/windows/bootstrap/latest.json`,
        {
          headers: authHeaders,
        }
      );
      assert.strictEqual(
        manifestResponse.status,
        200,
        `bootstrap manifest returned ${manifestResponse.status}`
      );

      const manifest = (await manifestResponse.json()) as BootstrapManifest;
      assert.equal(manifest.success, true);

      const metadataEntry = manifest.files.find(
        (file) => file.path === 'browser-extension/firefox-release/metadata.json'
      );
      const xpiEntry = manifest.files.find(
        (file) => file.path === 'browser-extension/firefox-release/openpath-firefox-extension.xpi'
      );

      assert.ok(metadataEntry, 'bootstrap manifest should include Firefox release metadata');
      assert.ok(xpiEntry, 'bootstrap manifest should include the signed Firefox XPI');
      assert.ok((xpiEntry?.size ?? 0) > 0, 'signed Firefox XPI should be non-empty');

      const metadataResponse = await fetchWithRetry(
        `${WINDOWS_BOOTSTRAP_GATE_URL}/api/agent/windows/bootstrap/file?path=${encodeURIComponent('browser-extension/firefox-release/metadata.json')}`,
        {
          headers: authHeaders,
        }
      );
      assert.strictEqual(metadataResponse.status, 200);
      const metadataText = await metadataResponse.text();
      const metadata = JSON.parse(metadataText) as FirefoxReleaseMetadata;

      assert.equal(typeof metadata.extensionId, 'string');
      assert.equal(typeof metadata.version, 'string');
      assert.ok(metadata.extensionId, 'metadata should include an extensionId');
      assert.ok(metadata.version, 'metadata should include a version');

      if (EXPECTED_EXTENSION_ID) {
        assert.equal(
          metadata.extensionId,
          EXPECTED_EXTENSION_ID,
          'metadata extensionId should match staging evidence'
        );
      }

      if (EXPECTED_VERSION) {
        assert.equal(
          metadata.version,
          EXPECTED_VERSION,
          'metadata version should match staging evidence'
        );
      }

      if (EXPECTED_METADATA_SHA256) {
        assert.equal(
          sha256Hex(metadataText),
          EXPECTED_METADATA_SHA256,
          'metadata hash should match staging evidence'
        );
      }

      const xpiResponse = await fetchWithRetry(
        `${WINDOWS_BOOTSTRAP_GATE_URL}/api/agent/windows/bootstrap/file?path=${encodeURIComponent('browser-extension/firefox-release/openpath-firefox-extension.xpi')}`,
        {
          headers: authHeaders,
        }
      );
      assert.strictEqual(xpiResponse.status, 200);
      const xpiBuffer = new Uint8Array(await xpiResponse.arrayBuffer());
      assert.ok(xpiBuffer.byteLength > 0, 'downloaded Firefox XPI should not be empty');

      if (EXPECTED_XPI_SHA256) {
        assert.equal(
          sha256Hex(xpiBuffer),
          EXPECTED_XPI_SHA256,
          'XPI hash should match staging evidence'
        );
      }
    });
  }
);
