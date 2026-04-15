import { getTableName, isTable, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { extractTrpcData } from './openpath/response.js';
import { openPathTrpcUrl } from './openpath/trpc-client.js';

export interface GatewayDatabaseStatus {
  connected: boolean;
  schemaReady: boolean;
  missingTables: string[];
}

export interface GatewayReadiness {
  ready: boolean;
  upstreamAvailable: boolean;
  databaseConnected: boolean;
  databaseSchemaReady: boolean;
  missingTables: string[];
}

const requiredGatewayTableNames = Object.freeze(
  Object.values(schema)
    .filter((candidate) => isTable(candidate))
    .map((table) => getTableName(table))
    .filter((tableName) => tableName.startsWith('cp_'))
    .sort()
);

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

function normalizeGatewayDatabaseStatus(
  result: boolean | GatewayDatabaseStatus
): GatewayDatabaseStatus {
  if (typeof result === 'boolean') {
    return {
      connected: result,
      schemaReady: result,
      missingTables: [],
    };
  }

  return result;
}

async function defaultDatabaseCheck(): Promise<GatewayDatabaseStatus> {
  try {
    const requestedTables = sql.join(
      requiredGatewayTableNames.map((tableName) => sql`${tableName}`),
      sql`, `
    );
    const result = await db.execute<{ table_name: string }>(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (${requestedTables})
    `);
    const presentTables = new Set(
      result.rows
        .map((row) => row.table_name)
        .filter((tableName): tableName is string => Boolean(tableName))
    );
    const missingTables = requiredGatewayTableNames.filter(
      (tableName) => !presentTables.has(tableName)
    );

    return {
      connected: true,
      schemaReady: missingTables.length === 0,
      missingTables,
    };
  } catch {
    return {
      connected: false,
      schemaReady: false,
      missingTables: [],
    };
  }
}

export async function getGatewayReadiness(
  deps: {
    checkDatabase?: () => Promise<boolean | GatewayDatabaseStatus>;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<GatewayReadiness> {
  const checkDatabase = deps.checkDatabase ?? defaultDatabaseCheck;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const database = normalizeGatewayDatabaseStatus(await checkDatabase());
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
    ready: upstreamAvailable && database.connected && database.schemaReady,
    upstreamAvailable,
    databaseConnected: database.connected,
    databaseSchemaReady: database.schemaReady,
    missingTables: database.missingTables,
  };
}
