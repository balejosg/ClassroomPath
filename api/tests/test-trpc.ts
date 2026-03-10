export const TEST_RUN_ID = `${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
let emailCounter = 0;

export function uniqueEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}-${TEST_RUN_ID}-${String(emailCounter)}@test.local`;
}

export interface TRPCResponse<T = unknown> {
  result?: { data: T };
  error?: { message: string; code: string; data?: { code: string } };
}

export async function trpcMutate(
  baseUrl: string,
  procedure: string,
  input: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${baseUrl}/cp/trpc/${procedure}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(input),
  });
}

export async function trpcQuery(
  baseUrl: string,
  procedure: string,
  input?: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  let url = `${baseUrl}/cp/trpc/${procedure}`;
  if (input !== undefined) {
    url += `?input=${encodeURIComponent(JSON.stringify(input))}`;
  }

  return fetch(url, { headers });
}

export async function parseTRPC(response: Response): Promise<{
  data?: unknown;
  error?: string;
  code?: string;
}> {
  const json = (await response.json()) as TRPCResponse;
  if (json.result !== undefined) {
    return { data: json.result.data };
  }
  if (json.error !== undefined) {
    return {
      error: json.error.message,
      code: json.error.data?.code ?? json.error.code,
    };
  }
  return {};
}

export function bearerAuth(token: string | null): Record<string, string> {
  if (token === null || token === '') return {};
  return { Authorization: `Bearer ${token}` };
}

export function assertStatus(response: Response, expected: number, message?: string): void {
  if (response.status !== expected) {
    throw new Error(
      message ?? `Expected status ${String(expected)}, got ${String(response.status)}`
    );
  }
}
