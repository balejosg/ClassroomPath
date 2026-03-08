import { sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { extractTrpcData, openPathTrpcUrl } from './openpath-upstream.js';

export interface GatewayReadiness {
  ready: boolean;
  upstreamAvailable: boolean;
  databaseConnected: boolean;
}

export function isGatewayUpstreamReadyStatus(status: unknown): status is 'ready' | 'ok' {
  return status === 'ready' || status === 'ok';
}

export function parseGatewayUpstreamReadiness(payload: unknown): boolean {
  const data = extractTrpcData<{ status?: unknown }>(payload) ?? payload;

  return (
    typeof data === 'object' &&
    data !== null &&
    'status' in data &&
    isGatewayUpstreamReadyStatus((data as { status?: unknown }).status)
  );
}

async function defaultDatabaseCheck(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function getGatewayReadiness(
  deps: {
    checkDatabase?: () => Promise<boolean>;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<GatewayReadiness> {
  const checkDatabase = deps.checkDatabase ?? defaultDatabaseCheck;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const databaseConnected = await checkDatabase();
  let upstreamAvailable = false;

  try {
    const response = await fetchImpl(openPathTrpcUrl('healthcheck.ready'), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      upstreamAvailable = parseGatewayUpstreamReadiness(await response.json());
    }
  } catch {
    upstreamAvailable = false;
  }

  return {
    ready: upstreamAvailable && databaseConnected,
    upstreamAvailable,
    databaseConnected,
  };
}
