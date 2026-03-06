import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { closeConnection } from '../../src/db/index.js';
import { closeOpenPathConnection, openpathDb, openpathSchema } from '../../src/db/openpath.js';
import {
  assertStatus,
  bearerAuth,
  getAvailablePort,
  parseTRPC,
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

export function signToken(params: {
  jwtSecret?: string;
  userId: string;
  email: string;
  name: string;
  roles: unknown[];
}): string {
  const jwtSecret = params.jwtSecret ?? process.env.JWT_SECRET;

  if (!jwtSecret) {
    throw new Error('JWT secret is required to sign integration test tokens');
  }

  return jwt.sign(
    {
      sub: params.userId,
      email: params.email,
      name: params.name,
      roles: params.roles,
    },
    jwtSecret
  );
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
}

export async function startIntegrationServer(): Promise<IntegrationServerHandle> {
  const port = await getAvailablePort();
  const baseUrl = `http://localhost:${String(port)}`;
  process.env.CP_PORT = String(port);

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
