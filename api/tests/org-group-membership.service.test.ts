import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { eq } from 'drizzle-orm';

import { db, schema } from '../src/db/index.js';
import { orgHasGroup } from '../src/services/org-group-membership.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);

const ORG_ID = `org_ogm_${RUN_ID}`;
const GROUP_ID = `ogm_g_${RUN_ID}`;

describe('org-group-membership.service', () => {
  before(async () => {
    await db
      .delete(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Org Group Membership ${RUN_ID}`,
      createdBy: 'doctor-test',
    });

    await db.insert(schema.cpOrganizationGroups).values({
      id: `og_${RUN_ID}_1`,
      organizationId: ORG_ID,
      groupId: GROUP_ID,
      publicName: `org-group-membership-${RUN_ID}`,
    });
  });

  after(async () => {
    await db
      .delete(schema.cpOrganizationGroups)
      .where(eq(schema.cpOrganizationGroups.organizationId, ORG_ID));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
  });

  it('returns true when org has group', async () => {
    assert.strictEqual(await orgHasGroup({ organizationId: ORG_ID, groupId: GROUP_ID }), true);
  });

  it('returns false when group is missing', async () => {
    assert.strictEqual(await orgHasGroup({ organizationId: ORG_ID, groupId: 'missing' }), false);
  });

  it('returns false when org is missing', async () => {
    assert.strictEqual(await orgHasGroup({ organizationId: 'missing', groupId: GROUP_ID }), false);
  });
});
