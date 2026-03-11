import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TRPCError } from '@trpc/server';

import { db, schema } from '../src/db/index.js';
import type { Context } from '../src/trpc/context.js';
import { pendingUsersRouter } from '../src/trpc/routers/pending-users.js';
import { resetDb } from './test-utils.js';

function createContext(params: {
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'teacher';
}): Context {
  return {
    user: {
      sub: params.userId,
      email: params.email,
      name: params.name,
      roles: [{ role: params.role, groupIds: [] }],
    },
    token: 'test-access-token',
    req: { headers: {} } as never,
    res: {} as never,
    authFailure: null,
  };
}

async function seedMembership(params: {
  organizationId: string;
  userId: string;
  role: 'admin' | 'teacher';
}): Promise<void> {
  await db.insert(schema.cpOrganizations).values({
    id: params.organizationId,
    name: `Org ${params.organizationId}`,
    createdBy: params.userId,
  });

  await db.insert(schema.cpMemberships).values({
    id: `mem_${params.userId}`,
    organizationId: params.organizationId,
    userId: params.userId,
    role: params.role,
    invitedBy: params.userId,
  });
}

async function expectTrpcError(
  promise: Promise<unknown>,
  expectedCode: TRPCError['code'],
  expectedMessage: RegExp
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof TRPCError);
    assert.strictEqual(error.code, expectedCode);
    assert.match(error.message, expectedMessage);
    return true;
  });
}

describe('pendingUsersRouter', { concurrency: 1 }, () => {
  test('approve rejects non-admin tenant members', async () => {
    await resetDb();

    const organizationId = 'org_pending_router_teacher';
    const teacherUserId = 'teacher_pending_router';

    await seedMembership({
      organizationId,
      userId: teacherUserId,
      role: 'teacher',
    });

    await expectTrpcError(
      pendingUsersRouter
        .createCaller(
          createContext({
            userId: teacherUserId,
            email: 'teacher@example.com',
            name: 'Teacher Pending Router',
            role: 'teacher',
          })
        )
        .approve({ userId: 'missing-user', role: 'teacher' }),
      'FORBIDDEN',
      /only admins can approve users/i
    );
  });

  test('approve maps users that are not waiting into NOT_FOUND', async () => {
    await resetDb();

    const organizationId = 'org_pending_router_admin';
    const adminUserId = 'admin_pending_router';

    await seedMembership({
      organizationId,
      userId: adminUserId,
      role: 'admin',
    });

    await expectTrpcError(
      pendingUsersRouter
        .createCaller(
          createContext({
            userId: adminUserId,
            email: 'admin@example.com',
            name: 'Admin Pending Router',
            role: 'admin',
          })
        )
        .approve({ userId: 'not-waiting-user', role: 'teacher' }),
      'NOT_FOUND',
      /not waiting for this organization/i
    );
  });

  test('reject rejects non-admin tenant members', async () => {
    await resetDb();

    const organizationId = 'org_pending_router_reject';
    const teacherUserId = 'teacher_pending_router_reject';

    await seedMembership({
      organizationId,
      userId: teacherUserId,
      role: 'teacher',
    });

    await expectTrpcError(
      pendingUsersRouter
        .createCaller(
          createContext({
            userId: teacherUserId,
            email: 'teacher-reject@example.com',
            name: 'Teacher Reject Router',
            role: 'teacher',
          })
        )
        .reject({ userId: 'waiting-user' }),
      'FORBIDDEN',
      /only admins can reject users/i
    );
  });
});
