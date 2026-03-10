import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { eq, inArray } from 'drizzle-orm';
import * as onboardingService from '../src/services/onboarding.service.js';
import * as openpathRolesLib from '../src/lib/openpath-roles.js';
import { withTestDbLock } from './test-utils.js';

/**
 * Mirrors the isAdminToken check from OpenPath's auth.ts
 * This ensures our test catches the exact bug (role must be 'admin' not 'openpath-admin')
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

describe('Onboarding Service', () => {
  after(async () => {
    const userIds = [...trackedUserIds];

    if (userIds.length > 0) {
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

  it('should return no membership for new user', async () => {
    const userId = nextUserId('new');
    trackedUserIds.add(userId);
    const status = await withTestDbLock(() => onboardingService.getOnboardingStatus(userId));

    assert.strictEqual(status.hasMembership, false);
    assert.strictEqual(status.isWaiting, false);
    assert.strictEqual(status.organization, null);
  });

  it('should create organization and admin membership', async () => {
    const userId = nextUserId('org-admin');
    await withTestDbLock(async () => {
      await seedOpenPathUser({
        userId,
        email: `${userId}@example.com`,
        name: 'Test User',
      });

      const result = await onboardingService.createOrganization('Test School', userId);
      trackedOrganizationIds.add(result.organizationId);

      assert.ok(result.organizationId.startsWith('org_'));
      assert.ok(result.membershipId.startsWith('mem_'));

      const status = await onboardingService.getOnboardingStatus(userId);
      assert.strictEqual(status.hasMembership, true);
      assert.strictEqual(status.organization?.name, 'Test School');
      assert.strictEqual(status.organization?.role, 'admin');

      const openpathRoles = await openpathDb
        .select()
        .from(openpathSchema.roles)
        .where(eq(openpathSchema.roles.userId, userId));

      assert.strictEqual(openpathRoles.length, 1, 'Should create admin role in OpenPath');
      assert.strictEqual(
        openpathRoles[0].role,
        'admin',
        'Should assign admin role (not openpath-admin) for auth compatibility'
      );
    });
  });

  /**
   * Regression test for BUG-001: Organization creator gets 403 on groups.list
   *
   * Root cause: The onboarding service was inserting role as 'openpath-admin'
   * instead of 'admin', causing isAdminToken() to return false.
   *
   * This test ensures the created role is compatible with the auth system.
   */
  it('BUG-001 regression: organization creator should pass isAdminToken check', async () => {
    const regressionUserId = nextUserId('bug001');
    const roles = await withTestDbLock(async () => {
      await seedOpenPathUser({
        userId: regressionUserId,
        email: `${regressionUserId}@example.com`,
        name: 'Regression Test User',
      });

      const result = await onboardingService.createOrganization(
        'Bug Test School',
        regressionUserId
      );
      trackedOrganizationIds.add(result.organizationId);

      return openpathRolesLib.getUserRoles(regressionUserId);
    });

    // Simulate what the JWT payload would contain
    const mockDecodedToken = {
      sub: regressionUserId,
      email: 'test@example.com',
      name: 'Test User',
      roles: roles,
    };

    // This is the actual check that was failing before the fix
    const isAdmin = isAdminToken(mockDecodedToken);

    assert.strictEqual(
      isAdmin,
      true,
      'Organization creator must be recognized as admin by isAdminToken(). ' +
        'If this fails, check that the role is "admin" not "openpath-admin".'
    );

    // Verify the role value directly
    assert.ok(
      roles.some((r) => r.role === 'admin'),
      'Roles must include exactly "admin" (not "openpath-admin" or other variants)'
    );
  });

  it('should set waiting status', async () => {
    const waitingUserId = nextUserId('waiting');
    trackedUserIds.add(waitingUserId);

    await withTestDbLock(async () => {
      await onboardingService.setWaitingStatus(waitingUserId);

      const status = await onboardingService.getOnboardingStatus(waitingUserId);
      assert.strictEqual(status.hasMembership, false);
      assert.strictEqual(status.isWaiting, true);
    });
  });

  it('should clear waiting status', async () => {
    const waitingUserId = nextUserId('clear');
    trackedUserIds.add(waitingUserId);

    await withTestDbLock(async () => {
      await onboardingService.setWaitingStatus(waitingUserId);
      await onboardingService.clearWaitingStatus(waitingUserId);

      const status = await onboardingService.getOnboardingStatus(waitingUserId);
      assert.strictEqual(status.isWaiting, false);
    });
  });

  it('blocks onboarding for unverified users', async () => {
    const unverifiedUserId = nextUserId('unverified');
    await withTestDbLock(async () => {
      await seedOpenPathUser({
        userId: unverifiedUserId,
        email: `${unverifiedUserId}@example.com`,
        name: 'Unverified User',
        emailVerified: false,
      });

      await assert.rejects(
        onboardingService.assertCanStartOnboarding(unverifiedUserId),
        /verification required/i
      );
    });
  });
});
