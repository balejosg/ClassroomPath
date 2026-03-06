import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { eq } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import {
  getOrgClassroomIds,
  orgHasClassroom,
} from '../src/services/org-classroom-membership.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `org_ocm_${RUN_ID}`;
const CLASSROOM_A = `ocm_classroom_a_${RUN_ID}`;
const CLASSROOM_B = `ocm_classroom_b_${RUN_ID}`;

describe('org-classroom-membership.service', () => {
  before(async () => {
    await db
      .delete(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.organizationId, ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Org Classroom Membership ${RUN_ID}`,
      createdBy: 'doctor-test',
    });

    await db.insert(schema.cpOrganizationClassrooms).values([
      { id: `oc_${RUN_ID}_1`, organizationId: ORG_ID, classroomId: CLASSROOM_A },
      { id: `oc_${RUN_ID}_2`, organizationId: ORG_ID, classroomId: CLASSROOM_B },
    ]);
  });

  after(async () => {
    await db
      .delete(schema.cpOrganizationClassrooms)
      .where(eq(schema.cpOrganizationClassrooms.organizationId, ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
  });

  it('lists classroom ids linked to the organization', async () => {
    const ids = await getOrgClassroomIds({ organizationId: ORG_ID });
    assert.deepStrictEqual(ids.sort(), [CLASSROOM_A, CLASSROOM_B].sort());
  });

  it('returns true only when the organization has the classroom link', async () => {
    assert.strictEqual(await orgHasClassroom({ organizationId: ORG_ID, classroomId: CLASSROOM_A }), true);
    assert.strictEqual(await orgHasClassroom({ organizationId: ORG_ID, classroomId: 'missing' }), false);
  });
});
