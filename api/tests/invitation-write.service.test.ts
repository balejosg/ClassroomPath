import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  revokeOrganizationInvitation,
} from '../src/services/invitation-write.service.js';
import { hashInvitationToken } from '../src/services/invitation-shared.service.js';
import { acquireTestDbLock, releaseTestDbLock } from './test-db.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `inv_write_org_${RUN_ID}`;
const USER_ID = `inv_write_user_${RUN_ID}`;
const MANUAL_INVITATION_IDS = [`inv_write_revoke_${RUN_ID}`, `inv_write_accept_${RUN_ID}`];
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;

describe('invitation-write.service', () => {
  before(async () => {
    await acquireTestDbLock();

    await db
      .delete(schema.cpMemberships)
      .where(inArray(schema.cpMemberships.userId, [USER_ID, `inv_write_admin_${RUN_ID}`]));
    await db
      .delete(schema.cpInvitations)
      .where(inArray(schema.cpInvitations.id, MANUAL_INVITATION_IDS));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, USER_ID));

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Invitation Write Org ${RUN_ID}`,
      createdBy: `inv_write_admin_${RUN_ID}`,
    });

    await openpathDb.insert(openpathSchema.users).values({
      id: USER_ID,
      email: `invited-user-${RUN_ID}@example.com`,
      name: 'Invited User',
      passwordHash: 'hashed-password',
      isActive: true,
    });
  });

  after(async () => {
    try {
      const generatedInvitations = await db
        .select({ id: schema.cpInvitations.id })
        .from(schema.cpInvitations)
        .where(eq(schema.cpInvitations.organizationId, ORG_ID));
      const invitationIds = [
        ...MANUAL_INVITATION_IDS,
        ...generatedInvitations.map((invitation) => invitation.id),
      ];

      if (invitationIds.length > 0) {
        await db
          .delete(schema.cpInvitations)
          .where(inArray(schema.cpInvitations.id, invitationIds));
      }

      await db
        .delete(schema.cpMemberships)
        .where(inArray(schema.cpMemberships.userId, [USER_ID, `inv_write_admin_${RUN_ID}`]));
      await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
      await openpathDb.delete(openpathSchema.users).where(eq(openpathSchema.users.id, USER_ID));

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
    } finally {
      await releaseTestDbLock();
    }
  });

  it('rolls back a created invitation when delivery is unavailable', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    await assert.rejects(
      () =>
        createOrganizationInvitation({
          organizationId: ORG_ID,
          invitedBy: `inv_write_admin_${RUN_ID}`,
          email: `teacher-${RUN_ID}@example.com`,
          name: 'Teacher Invitee',
          role: 'teacher',
        }),
      (error: unknown) => {
        assert.ok(error && typeof error === 'object');
        assert.strictEqual((error as { code?: unknown }).code, 'SERVICE_UNAVAILABLE');
        return true;
      }
    );

    const persisted = await db
      .select({ id: schema.cpInvitations.id })
      .from(schema.cpInvitations)
      .where(eq(schema.cpInvitations.organizationId, ORG_ID));
    assert.strictEqual(persisted.length, 0);
  });

  it('revokes invitations and accepts them into memberships', async () => {
    await db.insert(schema.cpInvitations).values([
      {
        id: MANUAL_INVITATION_IDS[0],
        organizationId: ORG_ID,
        email: `revoke-${RUN_ID}@example.com`,
        name: 'Revoke Me',
        role: 'admin',
        tokenHash: hashInvitationToken(`revoke-token-${RUN_ID}`),
        invitedBy: `inv_write_admin_${RUN_ID}`,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
      {
        id: MANUAL_INVITATION_IDS[1],
        organizationId: ORG_ID,
        email: `accept-${RUN_ID}@example.com`,
        name: 'Accept Me',
        role: 'teacher',
        tokenHash: hashInvitationToken(`accept-token-${RUN_ID}`),
        invitedBy: `inv_write_admin_${RUN_ID}`,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
    ]);

    const revoked = await revokeOrganizationInvitation({
      organizationId: ORG_ID,
      invitationId: MANUAL_INVITATION_IDS[0],
      actedBy: `inv_write_admin_${RUN_ID}`,
    });
    assert.deepStrictEqual(revoked, { success: true });

    await acceptOrganizationInvitation({
      invitationId: MANUAL_INVITATION_IDS[1],
      organizationId: ORG_ID,
      userId: USER_ID,
      invitedBy: `inv_write_admin_${RUN_ID}`,
      role: 'teacher',
    });

    const remainingInvitations = await db
      .select({ id: schema.cpInvitations.id })
      .from(schema.cpInvitations)
      .where(inArray(schema.cpInvitations.id, MANUAL_INVITATION_IDS));
    assert.strictEqual(remainingInvitations.length, 0);

    const membership = await db
      .select({
        organizationId: schema.cpMemberships.organizationId,
        role: schema.cpMemberships.role,
      })
      .from(schema.cpMemberships)
      .where(eq(schema.cpMemberships.userId, USER_ID))
      .limit(1);
    assert.deepStrictEqual(membership[0], {
      organizationId: ORG_ID,
      role: 'teacher',
    });
  });
});
