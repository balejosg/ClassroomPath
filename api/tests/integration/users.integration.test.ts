/**
 * ClassroomPath users integration tests (/cp/trpc/users.*)
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { and, eq } from 'drizzle-orm';

import {
  getAvailablePort,
  trpcMutate,
  trpcQuery,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
} from '../test-utils.js';

import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { closeConnection } from '../../src/db/index.js';
import { closeOpenPathConnection } from '../../src/db/openpath.js';

let PORT: number;
let API_URL: string;
let server: Server | undefined;

function signToken(params: { userId: string; email: string; name: string; roles: any[] }): string {
  return jwt.sign(
    {
      sub: params.userId,
      email: params.email,
      name: params.name,
      roles: params.roles,
    },
    JWT_SECRET
  );
}

describe('ClassroomPath users integration (/cp/trpc)', async () => {
  before(async () => {
    await resetDb();

    PORT = await getAvailablePort();
    API_URL = `http://localhost:${String(PORT)}`;
    process.env.CP_PORT = String(PORT);

    const { app } = await import('../../src/server.js');
    server = app.listen(PORT);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  after(async () => {
    const srv = server;
    server = undefined;
    if (srv !== undefined) {
      try {
        if ((srv as any).listening === true) {
          await new Promise<void>((resolve, reject) => {
            srv.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      } catch (err: any) {
        if (err?.code !== 'ERR_SERVER_NOT_RUNNING') throw err;
      }
    }

    await closeConnection();
    await closeOpenPathConnection();

    // Close undici keep-alives to let node:test exit cleanly.
    try {
      const undici: any = await import('undici');
      const dispatcher: any = undici.getGlobalDispatcher?.();
      if (typeof dispatcher?.close === 'function') {
        await dispatcher.close();
      }
    } catch {
      // best-effort cleanup
    }
  });

  test('users.list returns SafeUserWithRoles and never exposes passwordHash', async () => {
    const orgId = `org-users-${Date.now()}`;

    const adminUserId = `u-admin-${Date.now()}`;
    const teacherUserId = `u-teacher-${Date.now()}`;

    const adminEmail = uniqueEmail('admin');
    const teacherEmail = uniqueEmail('teacher');

    // Seed OpenPath users
    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: teacherUserId,
        email: teacherEmail,
        name: 'Teacher User',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: false,
      },
    ]);

    // Seed OpenPath roles
    await openpathDb.insert(openpathSchema.roles).values([
      {
        id: `role-${adminUserId}`,
        userId: adminUserId,
        role: 'admin',
        groupIds: [],
        createdBy: adminUserId,
      },
      {
        id: `role-${teacherUserId}`,
        userId: teacherUserId,
        role: 'teacher',
        groupIds: [],
        createdBy: adminUserId,
      },
    ]);

    // Seed CP org + memberships
    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values([
      {
        id: `mem-${adminUserId}`,
        userId: adminUserId,
        organizationId: orgId,
        role: 'admin',
        invitedBy: adminUserId,
      },
      {
        id: `mem-${teacherUserId}`,
        userId: teacherUserId,
        organizationId: orgId,
        role: 'teacher',
        invitedBy: adminUserId,
      },
    ]);

    const token = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resp = await trpcQuery(API_URL, 'users.list', undefined, bearerAuth(token));
    assertStatus(resp, 200);

    const { data } = (await parseTRPC(resp)) as { data: any };
    assert.ok(Array.isArray(data), 'users.list must return an array');

    const byEmail = new Map<string, any>(data.map((u: any) => [u.email, u]));
    assert.ok(byEmail.has(adminEmail), 'admin user should be present in users.list');
    assert.ok(byEmail.has(teacherEmail), 'teacher user should be present in users.list');

    for (const u of data as any[]) {
      assert.strictEqual('passwordHash' in u, false, 'passwordHash must never be exposed');
      assert.strictEqual(typeof u.id, 'string');
      assert.strictEqual(typeof u.email, 'string');
      assert.strictEqual(typeof u.name, 'string');
      assert.strictEqual(typeof u.isActive, 'boolean');
      assert.strictEqual(typeof u.createdAt, 'string');
      assert.strictEqual(typeof u.updatedAt, 'string');
      assert.ok(Array.isArray(u.roles), 'roles must be an array');
      for (const r of u.roles) {
        assert.ok(typeof r.role === 'string');
        assert.ok(Array.isArray(r.groupIds));
      }
    }
  });

  test('users.create grants cp_memberships so the created user is onboarded', async () => {
    const orgId = `org-users-create-${Date.now()}`;

    const adminUserId = `u-admin-create-${Date.now()}`;
    const adminEmail = uniqueEmail('admin-create');

    await openpathDb.insert(openpathSchema.users).values({
      id: adminUserId,
      email: adminEmail,
      name: 'Admin Creator',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: true,
    });

    await openpathDb.insert(openpathSchema.roles).values({
      id: `role-${adminUserId}`,
      userId: adminUserId,
      role: 'admin',
      groupIds: [],
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: adminUserId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${adminUserId}`,
      userId: adminUserId,
      organizationId: orgId,
      role: 'admin',
      invitedBy: adminUserId,
    });

    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Creator',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const createdEmail = uniqueEmail('created');
    const createResp = await trpcMutate(
      API_URL,
      'users.create',
      {
        email: createdEmail,
        name: 'Created Teacher',
        password: 'Password123',
        role: 'teacher',
      },
      bearerAuth(adminToken)
    );
    assertStatus(createResp, 200);

    const { data: created } = (await parseTRPC(createResp)) as { data: any };
    assert.strictEqual(created.email, createdEmail);
    assert.ok(typeof created.id === 'string' && created.id.length > 0);

    const membership = await db
      .select()
      .from(cpSchema.cpMemberships)
      .where(
        and(
          eq(cpSchema.cpMemberships.userId, created.id),
          eq(cpSchema.cpMemberships.organizationId, orgId)
        )
      );
    assert.strictEqual(membership.length, 1);
    assert.strictEqual(membership[0].role, 'teacher');

    const createdToken = signToken({
      userId: created.id,
      email: createdEmail,
      name: 'Created Teacher',
      roles: [{ role: 'teacher', groupIds: [] }],
    });
    const statusResp = await trpcQuery(
      API_URL,
      'onboarding.status',
      undefined,
      bearerAuth(createdToken)
    );
    assertStatus(statusResp, 200);
    const { data: status } = (await parseTRPC(statusResp)) as { data: any };
    assert.strictEqual(status.hasMembership, true);
    assert.strictEqual(status.organization.id, orgId);
  });

  test('users.list is forbidden for non-admin org members', async () => {
    const orgId = `org-users-nonadmin-${Date.now()}`;
    const userId = `u-nonadmin-${Date.now()}`;
    const email = uniqueEmail('nonadmin');

    await openpathDb.insert(openpathSchema.users).values({
      id: userId,
      email,
      name: 'Non Admin',
      passwordHash: 'hashed',
      isActive: true,
      emailVerified: false,
    });

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: `Org ${orgId}`,
      createdBy: userId,
    });

    await db.insert(cpSchema.cpMemberships).values({
      id: `mem-${userId}`,
      userId,
      organizationId: orgId,
      role: 'teacher',
      invitedBy: userId,
    });

    const token = signToken({
      userId,
      email,
      name: 'Non Admin',
      roles: [{ role: 'teacher', groupIds: [] }],
    });

    const resp = await trpcQuery(API_URL, 'users.list', undefined, bearerAuth(token));
    // tRPC can respond 200 with an error payload; parseTRPC normalizes that.
    const parsed = (await parseTRPC(resp)) as any;
    assert.ok(parsed.error, 'Expected error payload');
    assert.strictEqual(parsed.code, 'FORBIDDEN');
  });
});
