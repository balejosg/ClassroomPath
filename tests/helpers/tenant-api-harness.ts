import assert from 'node:assert/strict';

export interface TenantApiHarnessOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  token?: string;
}

export interface TenantApiGroup {
  displayName: string;
  id: string;
  name: string;
}

export interface TenantApiClassroom {
  defaultGroupId?: string;
  displayName: string;
  id: string;
  name: string;
}

interface TrpcEnvelope<T> {
  error?: { code?: string; data?: { code?: string }; message?: string };
  result?: { data?: T | { json?: T } };
}

function buildTenantApiHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readTrpcJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as TrpcEnvelope<T>;
  if (body.result?.data && typeof body.result.data === 'object' && 'json' in body.result.data) {
    return (body.result.data as { json: T }).json;
  }

  if (body.result?.data !== undefined) {
    return body.result.data as T;
  }

  const message = body.error?.message ?? `Unexpected tRPC response (${String(response.status)})`;
  throw new Error(message);
}

export function createTenantApiHarness(options: TenantApiHarnessOptions) {
  const fetchImpl = options.fetchImpl ?? global.fetch;
  if (!fetchImpl) {
    throw new Error('fetch is required to create the tenant API harness');
  }

  const headers = buildTenantApiHeaders(options.token);

  return {
    async mutate<T>(procedure: string, input: unknown): Promise<T> {
      const response = await fetchImpl(`${options.baseUrl}/cp/trpc/${procedure}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(input),
      });

      if (response.status !== 200) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `${procedure} expected status 200, got ${String(response.status)}. Body: ${body.slice(0, 800)}`
        );
      }

      return readTrpcJson<T>(response);
    },

    async query<T>(procedure: string, input?: unknown): Promise<T> {
      let url = `${options.baseUrl}/cp/trpc/${procedure}`;
      if (input !== undefined) {
        url += `?input=${encodeURIComponent(JSON.stringify(input))}`;
      }

      const response = await fetchImpl(url, {
        headers,
      });
      if (response.status !== 200) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `${procedure} expected status 200, got ${String(response.status)}. Body: ${body.slice(0, 800)}`
        );
      }

      return readTrpcJson<T>(response);
    },

    async createGroup(config: { displayName?: string; name: string }): Promise<TenantApiGroup> {
      const displayName = config.displayName ?? config.name;
      const data = await this.mutate<{ id?: unknown; name?: unknown }>('groups.create', {
        name: config.name,
        displayName,
      });

      assert.ok(data?.id, 'groups.create should return id');

      return {
        id: String(data.id),
        name: String(data.name ?? config.name),
        displayName,
      };
    },

    async createClassroom(config: {
      defaultGroupId?: string;
      displayName?: string;
      name: string;
    }): Promise<TenantApiClassroom> {
      const displayName = config.displayName ?? config.name;
      const data = await this.mutate<{ id?: unknown; name?: unknown }>('classrooms.create', {
        name: config.name,
        displayName,
        defaultGroupId: config.defaultGroupId,
      });

      assert.ok(data?.id, 'classrooms.create should return id');

      return {
        id: String(data.id),
        name: String(data.name ?? config.name),
        displayName,
        defaultGroupId: config.defaultGroupId,
      };
    },
  };
}
