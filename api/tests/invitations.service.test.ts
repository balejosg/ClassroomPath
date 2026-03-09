import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import {
  createOrganizationInvitation,
  getInvitationByToken,
  listOrganizationInvitations,
  revokeOrganizationInvitation,
} from '../src/services/invitations.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const organizationIds = new Set<string>();
const invitationIds = new Set<string>();
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;

function nextId(prefix: string): string {
  return `${prefix}_${RUN_ID}_${Math.random().toString(36).slice(2, 8)}`;
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

after(async () => {
  if (invitationIds.size > 0) {
    await db
      .delete(schema.cpInvitations)
      .where(inArray(schema.cpInvitations.id, [...invitationIds]));
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
});

describe('invitations.service', () => {
  it('creates a pending invitation and resolves it back from the token', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    const invitedBy = nextId('admin');
    const organizationId = await seedOrganization('Invitations Org', invitedBy);

    const invitation = await createOrganizationInvitation({
      organizationId,
      invitedBy,
      email: `teacher-${RUN_ID}@example.com`,
      name: 'Teacher Invitee',
      role: 'teacher',
    });
    invitationIds.add(invitation.id);

    assert.strictEqual(invitation.emailSent, false);
    assert.strictEqual(invitation.status, 'Pending');
    assert.match(invitation.invitationUrl, /accept-invitation\?token=/);

    const token = new URL(invitation.invitationUrl).searchParams.get('token');
    assert.ok(token);

    const lookedUp = await getInvitationByToken(token);
    const listed = await listOrganizationInvitations(organizationId);

    assert.strictEqual(lookedUp?.id, invitation.id);
    assert.strictEqual(lookedUp?.organizationName, 'Invitations Org');
    assert.strictEqual(lookedUp?.email, `teacher-${RUN_ID}@example.com`);
    assert.strictEqual(listed.length, 1);
    assert.strictEqual(listed[0]?.id, invitation.id);
  });

  it('revokes pending invitations', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    const invitedBy = nextId('admin');
    const organizationId = await seedOrganization('Revoke Invitations Org', invitedBy);

    const invitation = await createOrganizationInvitation({
      organizationId,
      invitedBy,
      email: `revoke-${RUN_ID}@example.com`,
      name: 'Revoke Me',
      role: 'admin',
    });

    await revokeOrganizationInvitation({
      organizationId,
      invitationId: invitation.id,
    });

    const listed = await listOrganizationInvitations(organizationId);
    const persisted = await db
      .select({ id: schema.cpInvitations.id })
      .from(schema.cpInvitations)
      .where(eq(schema.cpInvitations.id, invitation.id))
      .limit(1);

    assert.strictEqual(listed.length, 0);
    assert.strictEqual(persisted.length, 0);
  });
});
