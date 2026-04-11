import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TRPCError } from '@trpc/server';

import { db, schema } from '../src/db/index.js';
import type { Context } from '../src/trpc/context.js';
import { usersRouter } from '../src/trpc/routers/users.js';
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

  await db.insert(schema.cpOrganizationEntitlements).values({
    organizationId: params.organizationId,
    source: 'manual_admin',
    status: 'active',
    productKind: 'annual',
    classroomLimit: 25,
    grantedBy: params.userId,
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

describe('usersRouter', { concurrency: 1 }, () => {
  test('exposes the expected user-management procedures', () => {
    const caller = usersRouter.createCaller(
      createContext({
        userId: 'admin-router-shape',
        email: 'admin-router-shape@example.com',
        name: 'Admin Router Shape',
        role: 'admin',
      })
    );

    assert.strictEqual(typeof caller.list, 'function');
    assert.strictEqual(typeof caller.listInvitations, 'function');
    assert.strictEqual(typeof caller.listMutationOperations, 'function');
    assert.strictEqual(typeof caller.getById, 'function');
    assert.strictEqual(typeof caller.getRole, 'function');
    assert.strictEqual(typeof caller.create, 'function');
    assert.strictEqual(typeof caller.update, 'function');
    assert.strictEqual(typeof caller.delete, 'function');
    assert.strictEqual(typeof caller.revokeInvitation, 'function');
    assert.strictEqual(typeof caller.retryMutationOperation, 'function');
    assert.strictEqual(typeof caller.assignRole, 'function');
    assert.strictEqual(typeof caller.revokeRole, 'function');
  });

  test('list rejects non-admin tenant members', async () => {
    await resetDb();

    const organizationId = 'org_users_router_teacher';
    const teacherUserId = 'teacher_users_router';

    await seedMembership({
      organizationId,
      userId: teacherUserId,
      role: 'teacher',
    });

    await expectTrpcError(
      usersRouter
        .createCaller(
          createContext({
            userId: teacherUserId,
            email: 'teacher-users@example.com',
            name: 'Teacher Users Router',
            role: 'teacher',
          })
        )
        .list(),
      'FORBIDDEN',
      /only organization admins can manage users/i
    );
  });
});
