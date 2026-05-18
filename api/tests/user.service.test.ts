import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import { and, eq, inArray, or } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { openpathDb, roles, users, whitelistGroups } from '../src/db/openpath.js';
import {
  assignOrganizationUserRole,
  createOrganizationUser,
  deleteOrganizationUser,
  getOrganizationUserById,
  getOrganizationUserRole,
  listOrganizationInvitations,
  listOrganizationUsers,
  revokeOrganizationUserRole,
  updateOrganizationUser,
} from '../src/services/user.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
let counter = 0;
const organizationIds = new Set<string>();
const membershipIds = new Set<string>();
const invitationIds = new Set<string>();
const userIds = new Set<string>();
const roleIds = new Set<string>();
const groupIds = new Set<string>();
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
const originalFakeEmailDelivery = process.env.CP_FAKE_EMAIL_DELIVERY;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${RUN_ID}_${String(counter)}`;
}

async function seedOrganization(name: string, createdBy: string): Promise<string> {
  const organizationId = nextId('org');
  organizationIds.add(organizationId);
  await db.insert(schema.cpOrganizations).values({
    id: organizationId,
    name,
    createdBy,
  });
  return organizationId;
}

async function seedMembership(params: {
  organizationId: string;
  userId: string;
  role: 'admin' | 'teacher';
}): Promise<void> {
  const membershipId = nextId('mem');
  membershipIds.add(membershipId);

  await db.insert(schema.cpMemberships).values({
    id: membershipId,
    organizationId: params.organizationId,
    userId: params.userId,
    role: params.role,
    invitedBy: params.userId,
  });
}

async function seedUser(params: {
  userId: string;
  email: string;
  name: string;
  passwordHash?: string;
}) {
  userIds.add(params.userId);
  await openpathDb.insert(users).values({
    id: params.userId,
    email: params.email,
    name: params.name,
    passwordHash: params.passwordHash ?? 'hashed-password',
    isActive: true,
  });
}

after(async () => {
  const trackedUserIds = [...userIds];

  if (invitationIds.size > 0) {
    await db
      .delete(schema.cpInvitations)
      .where(inArray(schema.cpInvitations.id, [...invitationIds]));
  }

  if (trackedUserIds.length > 0 || roleIds.size > 0) {
    const conditions = [];
    if (roleIds.size > 0) {
      conditions.push(inArray(roles.id, [...roleIds]));
    }
    if (trackedUserIds.length > 0) {
      conditions.push(inArray(roles.userId, trackedUserIds));
      conditions.push(inArray(roles.createdBy, trackedUserIds));
    }

    await openpathDb.delete(roles).where(or(...conditions)!);
  }

  if (userIds.size > 0) {
    await openpathDb.delete(users).where(inArray(users.id, [...userIds]));
  }

  if (membershipIds.size > 0) {
    await db
      .delete(schema.cpMemberships)
      .where(inArray(schema.cpMemberships.id, [...membershipIds]));
  }

  if (groupIds.size > 0) {
    await openpathDb.delete(whitelistGroups).where(inArray(whitelistGroups.id, [...groupIds]));
  }

  if (organizationIds.size > 0) {
    await db
      .delete(schema.cpOrganizations)
      .where(inArray(schema.cpOrganizations.id, [...organizationIds]));
  }

  if (originalResendApiKey === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = originalResendApiKey;
  }

  if (originalResendFromEmail === undefined) {
    delete process.env.RESEND_FROM_EMAIL;
  } else {
    process.env.RESEND_FROM_EMAIL = originalResendFromEmail;
  }

  if (originalFakeEmailDelivery === undefined) {
    delete process.env.CP_FAKE_EMAIL_DELIVERY;
  } else {
    process.env.CP_FAKE_EMAIL_DELIVERY = originalFakeEmailDelivery;
  }
});

describe('user.service', { concurrency: 1 }, () => {
  it('fails explicitly without provisioning upstream users when delivery is unavailable', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    const adminUserId = nextId('admin');
    const organizationId = await seedOrganization('User Service Org', adminUserId);
    await seedMembership({ organizationId, userId: adminUserId, role: 'admin' });
    await seedUser({
      userId: adminUserId,
      email: `${adminUserId}@example.com`,
      name: 'Admin Creator',
    });

    await assert.rejects(
      () =>
        createOrganizationUser({
          organizationId,
          actedBy: adminUserId,
          email: `teacher-${RUN_ID}@example.com`,
          name: 'Teacher Example',
          role: 'teacher',
        }),
      (error: unknown) => {
        assert.ok(error && typeof error === 'object');
        assert.strictEqual((error as { code?: unknown }).code, 'SERVICE_UNAVAILABLE');
        assert.strictEqual(
          (error as { message?: unknown }).message,
          'The invitation email could not be sent. Try again from this screen.'
        );
        return true;
      }
    );

    const listed = await listOrganizationUsers(organizationId);
    const invitations = await listOrganizationInvitations(organizationId);
    const [upstreamInvitee] = await openpathDb
      .select()
      .from(users)
      .where(eq(users.email, `teacher-${RUN_ID}@example.com`))
      .limit(1);

    assert.strictEqual(
      listed.some((user) => user.email === `teacher-${RUN_ID}@example.com`),
      false
    );
    assert.strictEqual(invitations.length, 0);
    assert.strictEqual(upstreamInvitee, undefined);
  });

  it('creates an invitation for an email that already belongs to an existing OpenPath account', async () => {
    process.env.CP_FAKE_EMAIL_DELIVERY = '1';

    const adminUserId = nextId('admin');
    const existingUserId = nextId('existing');
    const organizationId = await seedOrganization('Existing Invite Org', adminUserId);
    const invitedEmail = `existing-${RUN_ID}@test.local`;

    await seedMembership({ organizationId, userId: adminUserId, role: 'admin' });
    await seedUser({
      userId: adminUserId,
      email: `${adminUserId}@example.com`,
      name: 'Admin Creator',
    });
    await seedUser({
      userId: existingUserId,
      email: invitedEmail,
      name: 'Existing Teacher',
    });

    const created = await createOrganizationUser({
      organizationId,
      actedBy: adminUserId,
      email: invitedEmail,
      name: 'Existing Teacher',
      role: 'teacher',
    });

    const invitations = await listOrganizationInvitations(organizationId);

    assert.strictEqual(created.email, invitedEmail);
    assert.strictEqual(created.emailSent, true);
    assert.strictEqual(invitations.length, 1);
    assert.strictEqual(invitations[0]?.email, invitedEmail);
  });

  it('updates, reassigns, revokes, and deletes organization users', async () => {
    const adminUserId = nextId('admin');
    const targetUserId = nextId('user');
    const groupId = nextId('grp');
    const organizationId = await seedOrganization('Mutable Users Org', adminUserId);
    groupIds.add(groupId);

    await seedMembership({ organizationId, userId: adminUserId, role: 'admin' });
    await seedMembership({ organizationId, userId: targetUserId, role: 'teacher' });
    await seedUser({
      userId: adminUserId,
      email: `${adminUserId}@example.com`,
      name: 'Admin Manager',
    });
    await seedUser({
      userId: targetUserId,
      email: `mutable-${RUN_ID}@example.com`,
      name: 'Mutable User',
    });
    await openpathDb.insert(whitelistGroups).values({
      id: groupId,
      name: `mutable-group-${RUN_ID}`.slice(0, 100),
      displayName: 'Mutable Group',
      enabled: 1,
    });

    const initialRoleId = nextId('role');
    roleIds.add(initialRoleId);
    await openpathDb.insert(roles).values({
      id: initialRoleId,
      userId: targetUserId,
      role: 'teacher',
      groupIds: [],
      createdBy: adminUserId,
    });

    const updatedUser = await updateOrganizationUser({
      organizationId,
      userId: targetUserId,
      name: 'Updated User',
      active: false,
    });
    const assignedRole = await assignOrganizationUserRole({
      organizationId,
      userId: targetUserId,
      actedBy: adminUserId,
      role: 'admin',
      groupIds: [groupId],
    });
    const lookedUpRole = await getOrganizationUserRole({
      organizationId,
      userId: targetUserId,
    });
    const revoked = await revokeOrganizationUserRole({
      organizationId,
      userId: targetUserId,
      actedBy: adminUserId,
    });
    const deleted = await deleteOrganizationUser({
      organizationId,
      userId: targetUserId,
      actedBy: adminUserId,
    });

    const [remainingMembership] = await db
      .select()
      .from(schema.cpMemberships)
      .where(
        and(
          eq(schema.cpMemberships.organizationId, organizationId),
          eq(schema.cpMemberships.userId, targetUserId)
        )
      )
      .limit(1);
    const remainingRoles = await openpathDb
      .select()
      .from(roles)
      .where(eq(roles.userId, targetUserId));

    remainingRoles.forEach((role) => roleIds.add(role.id));

    assert.strictEqual(updatedUser.name, 'Updated User');
    assert.strictEqual(updatedUser.isActive, false);
    assert.strictEqual(assignedRole.role, 'admin');
    assert.deepStrictEqual(assignedRole.groupIds, [groupId]);
    assert.strictEqual(lookedUpRole?.role, 'admin');
    assert.deepStrictEqual(lookedUpRole?.groupIds, [groupId]);
    assert.deepStrictEqual(revoked, { success: true });
    assert.deepStrictEqual(deleted, { success: true });
    assert.strictEqual(remainingMembership, undefined);
    assert.strictEqual(remainingRoles.length, 0);
  });
});
