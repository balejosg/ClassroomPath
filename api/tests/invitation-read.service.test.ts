import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { openpathDb, openpathSchema } from '../src/db/openpath.js';
import {
  getInvitationByToken,
  listOrganizationInvitations,
} from '../src/services/invitation-read.service.js';
import { hashInvitationToken } from '../src/services/invitation-shared.service.js';
import { acquireTestDbLock, releaseTestDbLock } from './test-db.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `inv_read_org_${RUN_ID}`;
const CURRENT_ORG_ID = `inv_read_current_org_${RUN_ID}`;
const EXISTING_USER_ID = `inv_read_user_${RUN_ID}`;
const INVITATION_IDS = [`inv_read_active_${RUN_ID}`, `inv_read_expired_${RUN_ID}`];

describe('invitation-read.service', () => {
  before(async () => {
    await acquireTestDbLock();

    await db.delete(schema.cpInvitations).where(inArray(schema.cpInvitations.id, INVITATION_IDS));
    await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, EXISTING_USER_ID));
    await openpathDb
      .delete(openpathSchema.users)
      .where(eq(openpathSchema.users.id, EXISTING_USER_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, CURRENT_ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Invitation Read Org ${RUN_ID}`,
      createdBy: `inv_read_admin_${RUN_ID}`,
    });

    await db.insert(schema.cpOrganizations).values({
      id: CURRENT_ORG_ID,
      name: `Current Org ${RUN_ID}`,
      createdBy: EXISTING_USER_ID,
    });

    await openpathDb.insert(openpathSchema.users).values({
      id: EXISTING_USER_ID,
      email: `active-${RUN_ID}@example.com`,
      name: 'Active Invitee',
      passwordHash: 'hashed-password',
      isActive: true,
    });

    await db.insert(schema.cpMemberships).values({
      id: `mem_${RUN_ID}`,
      organizationId: CURRENT_ORG_ID,
      userId: EXISTING_USER_ID,
      role: 'teacher',
      invitedBy: EXISTING_USER_ID,
    });

    await db.insert(schema.cpInvitations).values([
      {
        id: INVITATION_IDS[0],
        organizationId: ORG_ID,
        email: `active-${RUN_ID}@example.com`,
        name: 'Active Invitee',
        role: 'teacher',
        tokenHash: hashInvitationToken(`active-token-${RUN_ID}`),
        invitedBy: `inv_read_admin_${RUN_ID}`,
        expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
      },
      {
        id: INVITATION_IDS[1],
        organizationId: ORG_ID,
        email: `expired-${RUN_ID}@example.com`,
        name: 'Expired Invitee',
        role: 'admin',
        tokenHash: hashInvitationToken(`expired-token-${RUN_ID}`),
        invitedBy: `inv_read_admin_${RUN_ID}`,
        expiresAt: new Date(Date.now() - 60 * 1000),
      },
    ]);
  });

  after(async () => {
    try {
      await db.delete(schema.cpInvitations).where(inArray(schema.cpInvitations.id, INVITATION_IDS));
      await db
        .delete(schema.cpMemberships)
        .where(eq(schema.cpMemberships.userId, EXISTING_USER_ID));
      await openpathDb
        .delete(openpathSchema.users)
        .where(eq(openpathSchema.users.id, EXISTING_USER_ID));
      await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, CURRENT_ORG_ID));
      await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
    } finally {
      await releaseTestDbLock();
    }
  });

  it('lists active invitations and deletes expired lookups on demand', async () => {
    const listed = await listOrganizationInvitations(ORG_ID);
    const active = await getInvitationByToken(`active-token-${RUN_ID}`);
    const expired = await getInvitationByToken(`expired-token-${RUN_ID}`);

    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0]?.id, INVITATION_IDS[0]);

    assert.strictEqual(active?.id, INVITATION_IDS[0]);
    assert.strictEqual(active?.organizationName, `Invitation Read Org ${RUN_ID}`);
    assert.strictEqual(active?.hasExistingAccount, true);
    assert.strictEqual(active?.currentOrganizationName, `Current Org ${RUN_ID}`);
    assert.strictEqual(expired, null);

    const persistedExpired = await db
      .select({ id: schema.cpInvitations.id })
      .from(schema.cpInvitations)
      .where(eq(schema.cpInvitations.id, INVITATION_IDS[1]))
      .limit(1);
    assert.strictEqual(persistedExpired.length, 0);
  });
});
