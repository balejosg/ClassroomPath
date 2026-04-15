import { after, describe, it } from 'node:test';
import assert from 'node:assert';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import * as openpathRolesLib from '../src/lib/openpath-roles.js';
import { createOrganization } from '../src/services/onboarding-create-organization.service.js';
import { withTestDbLock } from './test-utils.js';

/**
 * Mirrors the isAdminToken check from OpenPath's auth.ts.
 * This ensures our test catches the exact bug (role must be 'admin' not 'openpath-admin').
 */
function isAdminToken(decoded: { roles?: Array<{ role: string }> } | null): boolean {
  if (!decoded?.roles) return false;
  return decoded.roles.some((r) => r.role === 'admin');
}

const RUN_ID = Date.now().toString(36);
let userCounter = 0;
const trackedUserIds = new Set<string>();
const trackedOrganizationIds = new Set<string>();

function nextUserId(label: string): string {
  userCounter += 1;
  return `test-user-${RUN_ID}-${label}-${String(userCounter)}`;
}

async function seedOpenPathUser(params: {
  userId: string;
  email: string;
  name: string;
  emailVerified?: boolean;
}) {
  trackedUserIds.add(params.userId);
  await openpathDb.insert(openpathSchema.users).values({
    id: params.userId,
    email: params.email,
    name: params.name,
    passwordHash: 'hashed_password_placeholder',
    isActive: true,
    emailVerified: params.emailVerified ?? true,
  });
}

describe('onboarding-create-organization.service', () => {
  after(async () => {
    const userIds = [...trackedUserIds];

    if (userIds.length > 0) {
      await db
        .delete(schema.cpMutationOperations)
        .where(inArray(schema.cpMutationOperations.userId, userIds));
      await db.delete(schema.cpMemberships).where(inArray(schema.cpMemberships.userId, userIds));
      await db.delete(schema.cpUserStatus).where(inArray(schema.cpUserStatus.userId, userIds));
      await openpathDb
        .delete(openpathSchema.roles)
        .where(inArray(openpathSchema.roles.userId, userIds));
      await openpathDb
        .delete(openpathSchema.users)
        .where(inArray(openpathSchema.users.id, userIds));
    }

    if (trackedOrganizationIds.size > 0) {
      await db
        .delete(schema.cpOrganizations)
        .where(inArray(schema.cpOrganizations.id, [...trackedOrganizationIds]));
    }
  });

  it('creates organization and admin membership', async () => {
    const userId = nextUserId('org-admin');
    await withTestDbLock(async () => {
      await seedOpenPathUser({
        userId,
        email: `${userId}@example.com`,
        name: 'Test User',
      });

      const result = await createOrganization('Test School', userId);
      trackedOrganizationIds.add(result.organizationId);

      assert.ok(result.organizationId.startsWith('org_'));
      assert.ok(result.membershipId.startsWith('mem_'));

      const memberships = await db
        .select()
        .from(schema.cpMemberships)
        .where(eq(schema.cpMemberships.userId, userId));
      const organizations = await db
        .select()
        .from(schema.cpOrganizations)
        .where(eq(schema.cpOrganizations.id, result.organizationId));
      const openpathRoles = await openpathDb
        .select()
        .from(openpathSchema.roles)
        .where(eq(openpathSchema.roles.userId, userId));
      const operations = await db
        .select()
        .from(schema.cpMutationOperations)
        .where(eq(schema.cpMutationOperations.userId, userId));

      assert.strictEqual(organizations[0]?.name, 'Test School');
      assert.strictEqual(memberships.length, 1);
      assert.strictEqual(memberships[0]?.role, 'admin');
      assert.strictEqual(openpathRoles.length, 1, 'Should create admin role in OpenPath');
      assert.strictEqual(
        openpathRoles[0]?.role,
        'admin',
        'Should assign admin role (not openpath-admin) for auth compatibility'
      );
      assert.strictEqual(operations.length, 1);
      assert.strictEqual(operations[0]?.operationType, 'onboarding.create_organization');
      assert.strictEqual(operations[0]?.status, 'completed');
    });
  });

  it('is idempotent for repeated organization creation attempts by the same user', async () => {
    const userId = nextUserId('idempotent');
    await withTestDbLock(async () => {
      await seedOpenPathUser({
        userId,
        email: `${userId}@example.com`,
        name: 'Idempotent User',
      });

      const first = await createOrganization('Idempotent School', userId);
      trackedOrganizationIds.add(first.organizationId);
      const second = await createOrganization('Changed Name Ignored', userId);

      assert.deepStrictEqual(second, first);

      const organizations = await db
        .select()
        .from(schema.cpOrganizations)
        .where(eq(schema.cpOrganizations.createdBy, userId));
      const memberships = await db
        .select()
        .from(schema.cpMemberships)
        .where(eq(schema.cpMemberships.userId, userId));
      const operations = await db
        .select()
        .from(schema.cpMutationOperations)
        .where(eq(schema.cpMutationOperations.userId, userId));

      assert.strictEqual(organizations.length, 1);
      assert.strictEqual(organizations[0]?.name, 'Idempotent School');
      assert.strictEqual(memberships.length, 1);
      assert.strictEqual(operations.length, 1);
      assert.strictEqual(operations[0]?.status, 'completed');
    });
  });

  it('BUG-001 regression: organization creator should pass isAdminToken check', async () => {
    const regressionUserId = nextUserId('bug001');
    const roles = await withTestDbLock(async () => {
      await seedOpenPathUser({
        userId: regressionUserId,
        email: `${regressionUserId}@example.com`,
        name: 'Regression Test User',
      });

      const result = await createOrganization('Bug Test School', regressionUserId);
      trackedOrganizationIds.add(result.organizationId);

      return openpathRolesLib.getUserRoles(regressionUserId);
    });

    const mockDecodedToken = {
      sub: regressionUserId,
      email: 'test@example.com',
      name: 'Test User',
      roles,
    };

    assert.strictEqual(
      isAdminToken(mockDecodedToken),
      true,
      'Organization creator must be recognized as admin by isAdminToken(). If this fails, check that the role is "admin" not "openpath-admin".'
    );

    assert.ok(
      roles.some((r) => r.role === 'admin'),
      'Roles must include exactly "admin" (not "openpath-admin" or other variants)'
    );
  });
});
