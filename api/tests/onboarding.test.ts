import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { db, schema } from '../src/db/index.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import { eq } from 'drizzle-orm';
import * as onboardingService from '../src/services/onboarding.service.js';
import * as openpathRolesLib from '../src/lib/openpath-roles.js';

/**
 * Mirrors the isAdminToken check from OpenPath's auth.ts
 * This ensures our test catches the exact bug (role must be 'admin' not 'openpath-admin')
 */
function isAdminToken(decoded: { roles?: Array<{ role: string }> } | null): boolean {
  if (!decoded?.roles) return false;
  return decoded.roles.some((r) => r.role === 'admin');
}

const TEST_USER_ID = 'test-user-' + Date.now();

describe('Onboarding Service', () => {
  // Setup: Create test user in OpenPath users table
  before(async () => {
    // Create base test user
    await openpathDb.insert(openpathSchema.users).values({
      id: TEST_USER_ID,
      email: `test-${Date.now()}@example.com`,
      name: 'Test User',
      passwordHash: 'hashed_password_placeholder',
      isActive: true,
      emailVerified: false,
    });
  });

  after(async () => {
    // Clean up in reverse order (respecting foreign keys)
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, TEST_USER_ID));
    await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, TEST_USER_ID));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, TEST_USER_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, TEST_USER_ID));
  });

  it('should return no membership for new user', async () => {
    const status = await onboardingService.getOnboardingStatus(TEST_USER_ID);

    assert.strictEqual(status.hasMembership, false);
    assert.strictEqual(status.isWaiting, false);
    assert.strictEqual(status.organization, null);
  });

  it('should create organization and admin membership', async () => {
    const result = await onboardingService.createOrganization('Test School', TEST_USER_ID);

    assert.ok(result.organizationId.startsWith('org_'));
    assert.ok(result.membershipId.startsWith('mem_'));

    const status = await onboardingService.getOnboardingStatus(TEST_USER_ID);
    assert.strictEqual(status.hasMembership, true);
    assert.strictEqual(status.organization?.name, 'Test School');
    assert.strictEqual(status.organization?.role, 'admin');

    const openpathRoles = await openpathDb
      .select()
      .from(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, TEST_USER_ID));

    assert.strictEqual(openpathRoles.length, 1, 'Should create admin role in OpenPath');
    assert.strictEqual(
      openpathRoles[0].role,
      'admin',
      'Should assign admin role (not openpath-admin) for auth compatibility'
    );
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
    const regressionUserId = TEST_USER_ID + '-bug001';

    // Create user in OpenPath first (required for foreign key)
    await openpathDb.insert(openpathSchema.users).values({
      id: regressionUserId,
      email: `regression-${Date.now()}@example.com`,
      name: 'Regression Test User',
      passwordHash: 'hashed_password_placeholder',
      isActive: true,
      emailVerified: false,
    });

    // Create organization (this should assign admin role)
    await onboardingService.createOrganization('Bug Test School', regressionUserId);

    // Get the roles as the auth system would see them
    const roles = await openpathRolesLib.getUserRoles(regressionUserId);

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

    // Cleanup
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, regressionUserId));
    await openpathDb
      .delete(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, regressionUserId));
    await openpathDb
      .delete(openpathSchema.users)
      .where(eq(openpathSchema.users.id, regressionUserId));
  });

  it('should set waiting status', async () => {
    const waitingUserId = TEST_USER_ID + '-waiting';

    await onboardingService.setWaitingStatus(waitingUserId);

    const status = await onboardingService.getOnboardingStatus(waitingUserId);
    assert.strictEqual(status.hasMembership, false);
    assert.strictEqual(status.isWaiting, true);

    // Cleanup
    await db.delete(schema.cpUserStatus).where(eq(schema.cpUserStatus.userId, waitingUserId));
  });

  it('should clear waiting status', async () => {
    const waitingUserId = TEST_USER_ID + '-clear';

    await onboardingService.setWaitingStatus(waitingUserId);
    await onboardingService.clearWaitingStatus(waitingUserId);

    const status = await onboardingService.getOnboardingStatus(waitingUserId);
    assert.strictEqual(status.isWaiting, false);
  });
});
