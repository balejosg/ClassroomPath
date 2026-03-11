const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
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
import { createTenantScenario } from './scenario-builder.js';
import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from '../../src/lib/session-cookies.js';

const integration = useIntegrationServer({ resetBeforeStart: true });

function getScenario() {
  return createTenantScenario({ baseUrl: integration.baseUrl, jwtSecret: JWT_SECRET });
}

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function getSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

describe('ClassroomPath invitations integration (/cp/trpc)', async () => {
  test('users.create returns delivery metadata without exposing invitation URLs', async () => {
    const adminUserId = `u-admin-invite-${Date.now()}`;
    const scenario = getScenario();
    const { actor: admin } = await scenario.seedOrgAdmin({
      userId: adminUserId,
      name: 'Admin Invite',
      organizationName: 'Invite Org',
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
      bearerAuth(admin.token)
    );
    assertStatus(inviteResponse, 200);

    const { data: invite } = (await parseTRPC(inviteResponse)) as {
      data: { email: string; emailSent: boolean; expiresAt: string };
    };
    assert.strictEqual(invite.email, invitedEmail);
    assert.strictEqual(invite.emailSent, true);
    assert.strictEqual('invitationUrl' in invite, false);
    assert.strictEqual(typeof invite.expiresAt, 'string');

    const pendingInvitations = await db
      .select({
        id: cpSchema.cpInvitations.id,
        tokenHash: cpSchema.cpInvitations.tokenHash,
      })
      .from(cpSchema.cpInvitations)
      .where(eq(cpSchema.cpInvitations.email, invitedEmail));
    assert.strictEqual(pendingInvitations.length, 1);
    assert.ok(pendingInvitations[0]?.tokenHash.length > 0);
  });

  test('auth.getInvitation and auth.acceptInvitation activate a tenant invitation end-to-end', async () => {
    const orgId = `org-invite-accept-${Date.now()}`;
    const adminUserId = `u-admin-invite-accept-${Date.now()}`;
    const adminEmail = uniqueEmail('admin-invite-accept');

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

    const invitedEmail = uniqueEmail('invitee-accept');
    const token = `invite-${Date.now().toString(36)}`;

    await db.insert(cpSchema.cpInvitations).values({
      id: `inv-${Date.now()}`,
      organizationId: orgId,
      email: invitedEmail,
      name: 'Invitee User',
      role: 'teacher',
      tokenHash: hashInvitationToken(token),
      invitedBy: adminUserId,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

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
      termsAccepted: true,
      termsVersion: '2026-03-09',
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
    assert.strictEqual(createdUser.emailVerified, true);

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
      data: { success: boolean; emailSent: boolean };
    };
    assert.strictEqual(reset.success, true);
    assert.strictEqual(reset.emailSent, true);
    assert.strictEqual('resetUrl' in reset, false);

    const tokens = await openpathDb
      .select()
      .from(openpathSchema.passwordResetTokens)
      .where(eq(openpathSchema.passwordResetTokens.userId, teacherUserId));
    assert.strictEqual(tokens.length, 1);

    const auditEvents = await db
      .select()
      .from(cpSchema.cpAuditEvents)
      .where(eq(cpSchema.cpAuditEvents.organizationId, orgId));
    const resetGenerated = auditEvents.find(
      (event) => event.action === 'user.reset-token-generated' && event.targetId === teacherUserId
    );
    assert.ok(resetGenerated);
    assert.strictEqual(resetGenerated.actorUserId, adminUserId);
    assert.strictEqual(resetGenerated.targetType, 'user');
    assert.deepStrictEqual(resetGenerated.metadata, {
      email: teacherEmail,
    });
  });
});
