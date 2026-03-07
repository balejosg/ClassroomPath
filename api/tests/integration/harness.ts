import type { Server } from 'node:http';
import { after, before } from 'node:test';
import express from 'express';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { closeConnection } from '../../src/db/index.js';
import { closeOpenPathConnection, openpathDb, openpathSchema } from '../../src/db/openpath.js';
import {
  assertStatus,
  bearerAuth,
  getAvailablePort,
  parseTRPC,
  trpcQuery,
  resetDb,
  trpcMutate,
  waitForHealth,
} from '../test-utils.js';

export interface TestUser {
  userId: string;
  email: string;
  name: string;
}

export interface IntegrationServerHandle {
  port: number;
  baseUrl: string;
  server: Server;
}

let mockOpenPathServer: Server | undefined;
let mockOpenPathBaseUrl: string | undefined;
const revokedMockTokens = new Set<string>();

async function buildMockAuthMeResponse(token: string): Promise<{
  user: {
    id: string;
    email: string;
    name: string;
    roles: Array<{ role: string; groupIds: string[] }>;
  };
}> {
  const decoded = jwt.decode(token) as
    | (jwt.JwtPayload & {
        email?: string;
        name?: string;
        roles?: Array<{ role?: string; groupIds?: string[] }>;
      })
    | null;
  const sub = typeof decoded?.sub === 'string' ? decoded.sub : 'unknown-user';
  const [userRow] = await openpathDb
    .select({
      email: openpathSchema.users.email,
      name: openpathSchema.users.name,
    })
    .from(openpathSchema.users)
    .where(eq(openpathSchema.users.id, sub))
    .limit(1);
  const [roleRow] = await openpathDb
    .select({
      role: openpathSchema.roles.role,
      groupIds: openpathSchema.roles.groupIds,
    })
    .from(openpathSchema.roles)
    .where(eq(openpathSchema.roles.userId, sub))
    .limit(1);

  const email =
    userRow?.email ?? (typeof decoded?.email === 'string' ? decoded.email : `${sub}@test.local`);
  const name = userRow?.name ?? (typeof decoded?.name === 'string' ? decoded.name : 'Mock User');
  const tokenRoles = Array.isArray(decoded?.roles)
    ? decoded.roles
        .filter(
          (role): role is { role: string; groupIds?: string[] } =>
            role !== null && typeof role === 'object' && typeof role.role === 'string'
        )
        .map((role) => ({
          role: role.role,
          groupIds: Array.isArray(role.groupIds)
            ? role.groupIds.filter((groupId): groupId is string => typeof groupId === 'string')
            : [],
        }))
    : [];
  const roles = roleRow
    ? [
        {
          role: roleRow.role,
          groupIds: Array.isArray(roleRow.groupIds)
            ? roleRow.groupIds.filter((groupId): groupId is string => typeof groupId === 'string')
            : [],
        },
      ]
    : tokenRoles;

  return {
    user: {
      id: sub,
      email,
      name,
      roles,
    },
  };
}

async function ensureMockOpenPathServer(): Promise<string> {
  if (mockOpenPathServer && mockOpenPathBaseUrl) {
    return mockOpenPathBaseUrl;
  }

  const port = await getAvailablePort();
  mockOpenPathBaseUrl = `http://127.0.0.1:${String(port)}`;

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mock-openpath-api' });
  });

  app.get('/trpc/auth.me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          message: 'Not authenticated',
          code: 'UNAUTHORIZED',
        },
      });
    }

    const token = authHeader.slice(7);
    if (revokedMockTokens.has(token)) {
      return res.status(401).json({
        error: {
          message: 'Token revoked',
          code: 'UNAUTHORIZED',
        },
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET ?? '', {
        issuer: 'openpath-api',
      }) as jwt.JwtPayload & { type?: string };

      if (decoded.type !== 'access') {
        return res.status(401).json({
          error: {
            message: 'Invalid token type',
            code: 'UNAUTHORIZED',
          },
        });
      }

      return res.json({
        result: {
          data: await buildMockAuthMeResponse(token),
        },
      });
    } catch {
      return res.status(401).json({
        error: {
          message: 'Invalid token',
          code: 'UNAUTHORIZED',
        },
      });
    }
  });

  app.get('/trpc/healthcheck.live', (_req, res) => {
    res.json({ result: { data: { status: 'ok' } } });
  });

  app.get('/trpc/healthcheck.ready', (_req, res) => {
    res.json({ result: { data: { status: 'ready' } } });
  });

  app.get('/trpc/healthcheck.systemInfo', (_req, res) => {
    res.json({
      result: {
        data: {
          version: 'test',
          database: { connected: true, type: 'postgresql' },
          session: {
            accessTokenExpiry: '24h',
            accessTokenExpiryHuman: '24 hours',
            refreshTokenExpiry: '7d',
            refreshTokenExpiryHuman: '7 days',
          },
          backup: {
            lastBackupAt: null,
            lastBackupHuman: null,
            lastBackupStatus: null,
          },
          uptime: 1,
        },
      },
    });
  });

  app.get('/trpc/apiTokens.list', (_req, res) => {
    res.json({ result: { data: [] } });
  });

  app.post('/trpc/auth.logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      revokedMockTokens.add(authHeader.slice(7));
    }

    const body = req.body as { refreshToken?: unknown } | undefined;
    if (typeof body?.refreshToken === 'string' && body.refreshToken.length > 0) {
      revokedMockTokens.add(body.refreshToken);
    }

    res.json({ result: { data: { success: true } } });
  });

  app.post('/trpc/apiTokens.create', (_req, res) => {
    res.json({
      result: {
        data: {
          id: 'tok_mock',
          name: 'Mock Token',
          token: 'tok_mock_secret',
        },
      },
    });
  });

  app.post('/trpc/apiTokens.revoke', (_req, res) => {
    res.json({ result: { data: { success: true, revokedAt: new Date().toISOString() } } });
  });

  app.post('/trpc/apiTokens.regenerate', (_req, res) => {
    res.json({
      result: {
        data: {
          id: 'tok_mock',
          name: 'Mock Token',
          token: 'tok_mock_secret_regenerated',
        },
      },
    });
  });

  mockOpenPathServer = app.listen(port);
  mockOpenPathServer.unref();

  await waitForHealth(mockOpenPathBaseUrl, { path: '/health' });

  return mockOpenPathBaseUrl;
}

export function revokeMockOpenPathToken(token: string): void {
  revokedMockTokens.add(token);
}

export function resetMockOpenPathUpstreamState(): void {
  revokedMockTokens.clear();
}

export function signToken(params: {
  jwtSecret?: string;
  userId: string;
  email: string;
  name: string;
  roles: unknown[];
  expiresIn?: string | number;
  issuer?: string;
  type?: 'access' | 'refresh';
}): string {
  const jwtSecret = params.jwtSecret ?? process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error('JWT secret is required to sign integration test tokens');
  }

  const type = params.type ?? 'access';
  const payload: Record<string, unknown> = {
    sub: params.userId,
    type,
  };

  if (type === 'access') {
    payload.email = params.email;
    payload.name = params.name;
    payload.roles = params.roles;
  }

  return jwt.sign(payload, jwtSecret, {
    issuer: params.issuer ?? 'openpath-api',
    expiresIn: params.expiresIn ?? '1h',
  });
}

export async function ensureOpenPathUser(user: TestUser): Promise<void> {
  await openpathDb
    .insert(openpathSchema.users)
    .values({
      id: user.userId,
      email: user.email,
      name: user.name,
      passwordHash: 'hashed',
    })
    .onConflictDoNothing();
}

export async function bootstrapOrg(params: {
  baseUrl: string;
  token: string;
  name: string;
}): Promise<{ organizationId: string }> {
  const createResp = await trpcMutate(
    params.baseUrl,
    'onboarding.createOrganization',
    { name: params.name },
    bearerAuth(params.token)
  );
  assertStatus(createResp, 200);
  const { data } = (await parseTRPC(createResp)) as { data: unknown };
  const organizationId =
    typeof data === 'object' && data !== null && 'organizationId' in data
      ? String((data as { organizationId: unknown }).organizationId)
      : '';

  if (!organizationId) {
    throw new Error('createOrganization should return organizationId');
  }

  return { organizationId };
}

export async function approveOrganizationMember(params: {
  baseUrl: string;
  adminToken: string;
  memberToken: string;
  memberUserId: string;
  organizationId: string;
  role?: 'teacher';
}): Promise<void> {
  const waitResp = await trpcMutate(
    params.baseUrl,
    'onboarding.waitForInvitation',
    { targetOrganizationId: params.organizationId },
    bearerAuth(params.memberToken)
  );
  assertStatus(waitResp, 200);

  const approveResp = await trpcMutate(
    params.baseUrl,
    'pendingUsers.approve',
    { userId: params.memberUserId, role: params.role ?? 'teacher' },
    bearerAuth(params.adminToken)
  );
  assertStatus(approveResp, 200);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const readyResp = await trpcQuery(
      params.baseUrl,
      'requests.listGroups',
      undefined,
      bearerAuth(params.memberToken)
    );

    if (readyResp.status === 200) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('Approved tenant member never became visible to tenant-scoped procedures');
}

export async function startIntegrationServer(): Promise<IntegrationServerHandle> {
  const upstreamBaseUrl = await ensureMockOpenPathServer();
  const port = await getAvailablePort();
  const baseUrl = `http://localhost:${String(port)}`;
  process.env.CP_PORT = String(port);
  process.env.OPENPATH_API_URL = upstreamBaseUrl;

  const { app } = await import('../../src/server.js');
  const server = app.listen(port);

  await waitForHealth(baseUrl);

  return { port, baseUrl, server };
}

export async function stopIntegrationServer(server: Server | undefined): Promise<void> {
  if (server !== undefined) {
    try {
      const maybeListening = server as Server & { listening?: boolean };
      if (maybeListening.listening === true) {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    } catch (err) {
      const maybeCode =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : null;

      if (maybeCode !== 'ERR_SERVER_NOT_RUNNING') {
        throw err;
      }
    }
  }

  await closeConnection();
  await closeOpenPathConnection();

  try {
    const undici = (await import('undici')) as {
      getGlobalDispatcher?: () => { close?: () => Promise<void> };
    };
    const dispatcher = undici.getGlobalDispatcher?.();
    if (typeof dispatcher?.close === 'function') {
      await dispatcher.close();
    }
  } catch {
    // best-effort cleanup
  }
}

export function useIntegrationServer(options: { resetBeforeStart?: boolean } = {}) {
  let integrationServer: IntegrationServerHandle | undefined;

  before(async () => {
    resetMockOpenPathUpstreamState();

    if (options.resetBeforeStart) {
      await resetDb();
    }

    integrationServer = await startIntegrationServer();
  });

  after(async () => {
    const currentServer = integrationServer;
    integrationServer = undefined;
    await stopIntegrationServer(currentServer?.server);
  });

  return {
    get baseUrl(): string {
      if (!integrationServer) {
        throw new Error('Integration server has not started yet');
      }

      return integrationServer.baseUrl;
    },
  };
}
