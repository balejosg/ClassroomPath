import { describe, it } from 'node:test';
import assert from 'node:assert';

import { eq, inArray, sql } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import {
  AMBIGUOUS_TENANT_CONTEXT_MESSAGE,
  assertNoExistingMembershipOrThrow,
  getSingleMembershipOrThrow,
  SINGLE_ORG_MEMBERSHIP_MESSAGE,
} from '../src/lib/tenant-memberships.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const USER_ID = `tm_user_${RUN_ID}`;
const FIRST_ORG_ID = `tm_org_${RUN_ID}_a`;
const SECOND_ORG_ID = `tm_org_${RUN_ID}_b`;
const CONSTRAINT_NAME = 'cp_memberships_user_id_key';

async function cleanupMembershipFixtures() {
  await db.delete(schema.cpMemberships).where(eq(schema.cpMemberships.userId, USER_ID));
  await db
    .delete(schema.cpOrganizations)
    .where(inArray(schema.cpOrganizations.id, [FIRST_ORG_ID, SECOND_ORG_ID]));
}

async function dropSingleOrgConstraint() {
  await db.execute(
    sql.raw(`ALTER TABLE "cp_memberships" DROP CONSTRAINT IF EXISTS "${CONSTRAINT_NAME}"`)
  );
}

async function restoreSingleOrgConstraint() {
  await db.execute(
    sql.raw(`ALTER TABLE "cp_memberships" ADD CONSTRAINT "${CONSTRAINT_NAME}" UNIQUE("user_id")`)
  );
}

describe('tenant-memberships', () => {
  it('allows users without memberships and blocks creating another membership once one exists', async () => {
    await cleanupMembershipFixtures();

    await assert.doesNotReject(assertNoExistingMembershipOrThrow(USER_ID));
    assert.strictEqual(await getSingleMembershipOrThrow(USER_ID), null);

    await db.insert(schema.cpOrganizations).values({
      id: FIRST_ORG_ID,
      name: `Tenant Membership Org ${RUN_ID}`,
      createdBy: USER_ID,
    });

    await db.insert(schema.cpMemberships).values({
      id: `tm_mem_${RUN_ID}`,
      userId: USER_ID,
      organizationId: FIRST_ORG_ID,
      role: 'admin',
      invitedBy: USER_ID,
    });

    const membership = await getSingleMembershipOrThrow(USER_ID);
    assert.strictEqual(membership?.organizationId, FIRST_ORG_ID);

    await assert.rejects(
      assertNoExistingMembershipOrThrow(USER_ID),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        (error as { code?: unknown }).code === 'CONFLICT' &&
        error.message === SINGLE_ORG_MEMBERSHIP_MESSAGE
    );

    await cleanupMembershipFixtures();
  });

  it('rejects ambiguous legacy memberships with a conflict', async () => {
    await cleanupMembershipFixtures();
    await dropSingleOrgConstraint();

    try {
      await db.insert(schema.cpOrganizations).values([
        {
          id: FIRST_ORG_ID,
          name: `Tenant Membership Org ${RUN_ID} A`,
          createdBy: USER_ID,
        },
        {
          id: SECOND_ORG_ID,
          name: `Tenant Membership Org ${RUN_ID} B`,
          createdBy: USER_ID,
        },
      ]);

      await db.insert(schema.cpMemberships).values([
        {
          id: `tm_mem_${RUN_ID}_a`,
          userId: USER_ID,
          organizationId: FIRST_ORG_ID,
          role: 'admin',
          invitedBy: USER_ID,
        },
        {
          id: `tm_mem_${RUN_ID}_b`,
          userId: USER_ID,
          organizationId: SECOND_ORG_ID,
          role: 'teacher',
          invitedBy: USER_ID,
        },
      ]);

      await assert.rejects(
        getSingleMembershipOrThrow(USER_ID),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          (error as { code?: unknown }).code === 'CONFLICT' &&
          error.message === AMBIGUOUS_TENANT_CONTEXT_MESSAGE
      );
    } finally {
      await cleanupMembershipFixtures();
      await restoreSingleOrgConstraint();
    }
  });
});
