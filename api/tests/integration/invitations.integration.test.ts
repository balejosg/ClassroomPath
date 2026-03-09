const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { and, eq } from 'drizzle-orm';

import {
  trpcMutate,
  trpcQuery,
  parseTRPC,
  bearerAuth,
  assertStatus,
  uniqueEmail,
} from '../test-utils.js';
import { signToken, useIntegrationServer } from './harness.js';
import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../../src/lib/session-cookies.js';

const integration = useIntegrationServer({ resetBeforeStart: true });

function getSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

describe('ClassroomPath invitations integration (/cp/trpc)', async () => {
  test('auth.getInvitation and auth.acceptInvitation activate a tenant invitation end-to-end', async () => {
    const orgId = `org-invite-${Date.now()}`;
    const adminUserId = `u-admin-invite-${Date.now()}`;
    const adminEmail = uniqueEmail('admin-invite');

    await openpathDb.insert(openpathSchema.users).values({
      id: adminUserId,
      email: adminEmail,
      name: 'Admin Invite',
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
      name: 'Invite Org',
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
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Invite',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const invitedEmail = uniqueEmail('invitee');
    const inviteResponse = await trpcMutate(
      integration.baseUrl,
      'users.create',
      {
        email: invitedEmail,
        name: 'Invitee User',
        role: 'teacher',
      },
      bearerAuth(adminToken)
    );
    assertStatus(inviteResponse, 200);

    const { data: invite } = (await parseTRPC(inviteResponse)) as {
      data: { invitationUrl: string; email: string };
    };
    assert.strictEqual(invite.email, invitedEmail);

    const token = new URL(invite.invitationUrl).searchParams.get('token');
    assert.ok(token, 'invitation URL should include a token');

    const previewResponse = await trpcQuery(integration.baseUrl, 'auth.getInvitation', { token });
    assertStatus(previewResponse, 200);

    const { data: preview } = (await parseTRPC(previewResponse)) as {
      data: { email: string; name: string; organizationName: string; role: string };
    };
    assert.strictEqual(preview.email, invitedEmail);
    assert.strictEqual(preview.name, 'Invitee User');
    assert.strictEqual(preview.organizationName, 'Invite Org');
    assert.strictEqual(preview.role, 'teacher');

    const acceptResponse = await trpcMutate(integration.baseUrl, 'auth.acceptInvitation', {
      token,
      password: 'InvitePassword123',
    });
    assertStatus(acceptResponse, 200);

    const { data: accepted } = (await parseTRPC(acceptResponse)) as {
      data: { user?: { id: string; email: string; name: string } };
    };
    assert.strictEqual(accepted.user?.email, invitedEmail);
    assert.strictEqual(accepted.user?.name, 'Invitee User');

    const setCookies = getSetCookieHeaders(acceptResponse);
    assert.ok(setCookies.some((cookie) => cookie.includes(`${ACCESS_COOKIE_NAME}=`)));
    assert.ok(setCookies.some((cookie) => cookie.includes(`${REFRESH_COOKIE_NAME}=`)));

    const [createdUser] = await openpathDb
      .select()
      .from(openpathSchema.users)
      .where(eq(openpathSchema.users.email, invitedEmail))
      .limit(1);
    assert.ok(createdUser, 'OpenPath user should be created on invitation acceptance');

    const memberships = await db
      .select()
      .from(cpSchema.cpMemberships)
      .where(
        and(
          eq(cpSchema.cpMemberships.organizationId, orgId),
          eq(cpSchema.cpMemberships.userId, createdUser.id)
        )
      );
    assert.strictEqual(memberships.length, 1);
    assert.strictEqual(memberships[0].role, 'teacher');

    const roles = await openpathDb
      .select()
      .from(openpathSchema.roles)
      .where(eq(openpathSchema.roles.userId, createdUser.id));
    assert.strictEqual(roles.length, 1);
    assert.strictEqual(String(roles[0].role), 'teacher');

    const remainingInvitations = await db
      .select()
      .from(cpSchema.cpInvitations)
      .where(eq(cpSchema.cpInvitations.email, invitedEmail));
    assert.strictEqual(
      remainingInvitations.length,
      0,
      'invite should be consumed after acceptance'
    );
  });

  test('auth.generateResetToken only issues recovery tokens for users inside the admin tenant', async () => {
    const orgId = `org-reset-${Date.now()}`;
    const adminUserId = `u-admin-reset-${Date.now()}`;
    const teacherUserId = `u-teacher-reset-${Date.now()}`;

    const adminEmail = uniqueEmail('admin-reset');
    const teacherEmail = uniqueEmail('teacher-reset');

    await openpathDb.insert(openpathSchema.users).values([
      {
        id: adminUserId,
        email: adminEmail,
        name: 'Admin Reset',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
      {
        id: teacherUserId,
        email: teacherEmail,
        name: 'Teacher Reset',
        passwordHash: 'hashed',
        isActive: true,
        emailVerified: true,
      },
    ]);

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

    await db.insert(cpSchema.cpOrganizations).values({
      id: orgId,
      name: 'Reset Org',
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

    const adminToken = signToken({
      jwtSecret: JWT_SECRET,
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin Reset',
      roles: [{ role: 'admin', groupIds: [] }],
    });

    const resetResponse = await trpcMutate(
      integration.baseUrl,
      'auth.generateResetToken',
      { email: teacherEmail },
      bearerAuth(adminToken)
    );
    assertStatus(resetResponse, 200);

    const { data: reset } = (await parseTRPC(resetResponse)) as {
      data: { success: boolean; emailSent: boolean; resetUrl: string };
    };
    assert.strictEqual(reset.success, true);
    assert.strictEqual(typeof reset.emailSent, 'boolean');
    assert.ok(reset.resetUrl.includes('/reset-password?email='));

    const tokens = await openpathDb
      .select()
      .from(openpathSchema.passwordResetTokens)
      .where(eq(openpathSchema.passwordResetTokens.userId, teacherUserId));
    assert.strictEqual(tokens.length, 1);
  });
});
