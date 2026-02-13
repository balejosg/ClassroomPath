/**
 * ClassroomPath classrooms integration tests (/cp/trpc/classrooms.*)
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';

import {
  getAvailablePort,
  trpcQuery,
  trpcMutate,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
} from '../test-utils.js';

import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { closeConnection } from '../../src/db/index.js';
import { closeOpenPathConnection } from '../../src/db/openpath.js';

let PORT: number;
let API_URL: string;
let server: Server | undefined;

type TestUser = {
  userId: string;
  email: string;
  name: string;
};

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

async function ensureOpenPathUser(u: TestUser): Promise<void> {
  await openpathDb
    .insert(openpathSchema.users)
    .values({
      id: u.userId,
      email: u.email,
      name: u.name,
      passwordHash: 'hashed',
    })
    .onConflictDoNothing();
}

async function bootstrapOrg(admin: { token: string }): Promise<{ organizationId: string }> {
  const createResp = await trpcMutate(
    API_URL,
    'onboarding.createOrganization',
    { name: 'Classrooms Test Org' },
    bearerAuth(admin.token)
  );
  assertStatus(createResp, 200);
  const { data } = (await parseTRPC(createResp)) as { data: any };
  assert.ok(data?.organizationId, 'createOrganization should return organizationId');
  return { organizationId: String(data.organizationId) };
}

async function createGroup(admin: { token: string }, name: string): Promise<{ groupId: string }> {
  const resp = await trpcMutate(
    API_URL,
    'groups.create',
    { name, displayName: name },
    bearerAuth(admin.token)
  );
  assertStatus(resp, 200);
  const { data } = (await parseTRPC(resp)) as { data: any };
  assert.ok(data?.id, 'groups.create should return id');
  return { groupId: String(data.id) };
}

async function createClassroom(
  admin: { token: string },
  params: { defaultGroupId?: string }
): Promise<{
  classroomId: string;
}> {
  const resp = await trpcMutate(
    API_URL,
    'classrooms.create',
    { name: 'classrooms-test-classroom', displayName: 'Classrooms Classroom', ...params },
    bearerAuth(admin.token)
  );
  assertStatus(resp, 200);
  const { data } = (await parseTRPC(resp)) as { data: any };
  assert.ok(data?.id, 'classrooms.create should return id');
  return { classroomId: String(data.id) };
}

function withMockedDate<T>(date: Date, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  const fixed = date;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Date = class extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0) super(fixed.getTime());
      else super(...(args as any));
    }

    static now(): number {
      return fixed.getTime();
    }

    static parse = RealDate.parse;
    static UTC = RealDate.UTC;
  };

  return fn().finally(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = RealDate;
  });
}

describe('ClassroomPath classrooms integration (/cp/trpc)', async () => {
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

    // Close undici keep-alives so node:test can exit cleanly.
    try {
      const undici: any = await import('undici');
      const dispatcher: any = undici.getGlobalDispatcher?.();
      if (typeof dispatcher?.close === 'function') {
        await dispatcher.close();
      }
    } catch {
      // best-effort
    }
  });

  test('classrooms.list/getById include currentGroupId from schedule (or default)', async () => {
    await resetDb();

    const adminUserId = 'classrooms-admin';
    const adminEmail = uniqueEmail('admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({ token: adminToken });

    const { groupId: defaultGroupId } = await createGroup({ token: adminToken }, 'default-group');
    const { groupId: scheduledGroupId } = await createGroup(
      { token: adminToken },
      'scheduled-group'
    );
    const { classroomId } = await createClassroom({ token: adminToken }, { defaultGroupId });

    // Fixed local time: Tuesday 10:30 -> should match schedule dayOfWeek=2 (Tue)
    const inSlot = new Date(2026, 1, 3, 10, 30, 0, 0);
    await withMockedDate(inSlot, async () => {
      const createSchedule = await trpcMutate(
        API_URL,
        'schedules.create',
        {
          classroomId,
          groupId: scheduledGroupId,
          dayOfWeek: 2,
          startTime: '10:00',
          endTime: '11:00',
        },
        bearerAuth(adminToken)
      );
      assertStatus(createSchedule, 200);

      const listResp = await trpcQuery(
        API_URL,
        'classrooms.list',
        undefined,
        bearerAuth(adminToken)
      );
      assertStatus(listResp, 200);
      const { data: list } = (await parseTRPC(listResp)) as { data: any[] };
      const row = list.find((c) => c.id === classroomId);
      assert.ok(row, 'classroom should be in list');
      assert.strictEqual(row.defaultGroupId, defaultGroupId);
      assert.strictEqual(row.activeGroupId, null);
      assert.strictEqual(row.currentGroupId, scheduledGroupId);

      const getResp = await trpcQuery(
        API_URL,
        'classrooms.getById',
        { id: classroomId },
        bearerAuth(adminToken)
      );
      assertStatus(getResp, 200);
      const { data: got } = (await parseTRPC(getResp)) as { data: any };
      assert.strictEqual(got.id, classroomId);
      assert.strictEqual(got.currentGroupId, scheduledGroupId);
    });

    // Outside the slot -> fallback to default group
    const outOfSlot = new Date(2026, 1, 3, 12, 0, 0, 0);
    await withMockedDate(outOfSlot, async () => {
      const getResp = await trpcQuery(
        API_URL,
        'classrooms.getById',
        { id: classroomId },
        bearerAuth(adminToken)
      );
      assertStatus(getResp, 200);
      const { data: got } = (await parseTRPC(getResp)) as { data: any };
      assert.strictEqual(got.currentGroupId, defaultGroupId);
    });
  });
});
