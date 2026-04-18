import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { synchronizeOpenPathRole } from '../src/lib/openpath-roles.js';
import { withTestDbLock } from './test-utils.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
let counter = 0;
const organizationIds = new Set<string>();
const membershipIds = new Set<string>();
const userIds = new Set<string>();

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${RUN_ID}_${String(counter)}`.slice(0, 50);
}

async function seedOpenPathUser(params: { userId: string; email: string; name: string }) {
  userIds.add(params.userId);
  await openpathDb.insert(openpathSchema.users).values({
    id: params.userId,
    email: params.email,
    name: params.name,
    passwordHash: 'hashed-password',
    isActive: true,
    emailVerified: true,
  });
}

after(async () => {
  const users = [...userIds];
  if (users.length > 0) {
    await openpathDb
      .delete(openpathSchema.roles)
      .where(inArray(openpathSchema.roles.userId, users));
  }

  if (membershipIds.size > 0) {
    await db
      .delete(schema.cpMemberships)
      .where(inArray(schema.cpMemberships.id, [...membershipIds]));
  }

  if (organizationIds.size > 0) {
    await db
      .delete(schema.cpOrganizations)
      .where(inArray(schema.cpOrganizations.id, [...organizationIds]));
  }

  if (users.length > 0) {
    await openpathDb.delete(openpathSchema.users).where(inArray(openpathSchema.users.id, users));
  }
});

describe('openpath role synchronization', () => {
  it('uses the target user as role creator when a system actor is not an OpenPath user', async () => {
    await withTestDbLock(async () => {
      const userId = nextId('user');
      const organizationId = nextId('org');
      const membershipId = nextId('mem');
      organizationIds.add(organizationId);
      membershipIds.add(membershipId);

      await seedOpenPathUser({
        userId,
        email: `${userId}@example.com`,
        name: 'System Actor Regression User',
      });

      await db.insert(schema.cpOrganizations).values({
        id: organizationId,
        name: 'System Actor Regression School',
        createdBy: userId,
      });

      await db.insert(schema.cpMemberships).values({
        id: membershipId,
        userId,
        organizationId,
        role: 'admin',
        invitedBy: null,
      });

      await synchronizeOpenPathRole({
        userId,
        actedBy: 'system:client-canary',
      });

      const [role] = await openpathDb
        .select()
        .from(openpathSchema.roles)
        .where(eq(openpathSchema.roles.userId, userId))
        .limit(1);

      assert.equal(role?.role, 'admin');
      assert.equal(role?.createdBy, userId);
    });
  });
});
