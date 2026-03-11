import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import { createHash } from 'node:crypto';
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

function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

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

describe('invitations.service', { concurrency: 1 }, () => {
  it('fails explicitly and removes the pending invitation when delivery is unavailable', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    const invitedBy = nextId('admin');
    const organizationId = await seedOrganization('Invitations Org', invitedBy);
    const email = `teacher-${RUN_ID}@example.com`;

    await assert.rejects(
      () =>
        createOrganizationInvitation({
          organizationId,
          invitedBy,
          email,
          name: 'Teacher Invitee',
          role: 'teacher',
        }),
      (error: unknown) => {
        assert.ok(error && typeof error === 'object');
        assert.strictEqual((error as { code?: unknown }).code, 'SERVICE_UNAVAILABLE');
        assert.strictEqual(
          (error as { message?: unknown }).message,
          'No se pudo enviar la invitación. Reintenta desde esta pantalla.'
        );
        return true;
      }
    );

    const listed = await listOrganizationInvitations(organizationId);
    const persisted = await db
      .select({ id: schema.cpInvitations.id })
      .from(schema.cpInvitations)
      .where(eq(schema.cpInvitations.email, email))
      .limit(1);

    assert.strictEqual(listed.length, 0);
    assert.strictEqual(persisted.length, 0);
  });

  it('resolves an invitation back from a known token', async () => {
    const invitedBy = nextId('admin');
    const organizationId = await seedOrganization('Lookup Invitations Org', invitedBy);
    const invitationId = nextId('inv');
    const token = `invite-token-${RUN_ID}`;

    invitationIds.add(invitationId);

    await db.insert(schema.cpInvitations).values({
      id: invitationId,
      organizationId,
      email: `lookup-${RUN_ID}@example.com`,
      name: 'Lookup Invitee',
      role: 'teacher',
      tokenHash: hashInvitationToken(token),
      invitedBy,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    const lookedUp = await getInvitationByToken(token);

    assert.strictEqual(lookedUp?.id, invitationId);
    assert.strictEqual(lookedUp?.organizationName, 'Lookup Invitations Org');
    assert.strictEqual(lookedUp?.email, `lookup-${RUN_ID}@example.com`);
  });

  it('revokes pending invitations', async () => {
    const invitedBy = nextId('admin');
    const organizationId = await seedOrganization('Revoke Invitations Org', invitedBy);
    const invitationId = nextId('inv');

    invitationIds.add(invitationId);

    await db.insert(schema.cpInvitations).values({
      id: invitationId,
      organizationId,
      email: `revoke-${RUN_ID}@example.com`,
      name: 'Revoke Me',
      role: 'admin',
      tokenHash: hashInvitationToken(`revoke-token-${RUN_ID}`),
      invitedBy,
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    });

    await revokeOrganizationInvitation({
      organizationId,
      invitationId,
      actedBy: invitedBy,
    });

    const listed = await listOrganizationInvitations(organizationId);
    const persisted = await db
      .select({ id: schema.cpInvitations.id })
      .from(schema.cpInvitations)
      .where(eq(schema.cpInvitations.id, invitationId))
      .limit(1);

    assert.strictEqual(listed.length, 0);
    assert.strictEqual(persisted.length, 0);
  });
});
