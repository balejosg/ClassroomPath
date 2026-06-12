/**
 * ClassroomPath groups integration tests (/cp/trpc/groups.*)
 */

import { TEST_JWT_SECRET } from '../helpers/test-env.js';

import { test, describe } from 'node:test';
import assert from 'node:assert';

import {
  trpcQuery,
  trpcMutate,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
} from '../test-utils.js';
import { useIntegrationServer } from './harness.js';
import { createTenantScenario } from './scenario-builder.js';
import { db } from '../../src/db/index.js';
import * as cpSchema from '../../src/db/schema.js';
import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { eq, inArray } from 'drizzle-orm';

const integration = useIntegrationServer({ resetBeforeStart: true });

function buildScenario() {
  return createTenantScenario({ baseUrl: integration.baseUrl, jwtSecret: TEST_JWT_SECRET });
}

describe('ClassroomPath groups integration (/cp/trpc)', async () => {
  test('groups.create returns CONFLICT when name/slug already exists', async () => {
    await resetDb();

    const scenario = buildScenario();

    const { actor: admin } = await scenario.createOrgAdmin({
      userId: 'groups-admin',
      organizationName: 'Groups Test Org',
    });

    await scenario.createGroup({ token: admin.token, name: 'dup-group', displayName: 'Dup Group' });

    const dupResp = await trpcMutate(
      integration.baseUrl,
      'groups.create',
      { name: 'dup-group', displayName: 'Dup Group 2' },
      bearerAuth(admin.token)
    );
    assertStatus(dupResp, 409);
    const { code, error } = await parseTRPC(dupResp);
    assert.strictEqual(code, 'CONFLICT');
    assert.ok((error ?? '').toLowerCase().includes('ya existe'));
  });

  test('groups.create allows the same public slug in different organizations and keeps upstream names isolated', async () => {
    await resetDb();

    const scenario = buildScenario();

    const { actor: adminA, organization: orgA } = await scenario.createOrgAdmin({
      userId: 'groups-admin-a',
      organizationName: 'Groups Test Org A',
    });
    const { actor: adminB, organization: orgB } = await scenario.createOrgAdmin({
      userId: 'groups-admin-b',
      organizationName: 'Groups Test Org B',
    });

    const groupA = await scenario.createGroup({
      token: adminA.token,
      name: 'shared-public-slug',
      displayName: 'Shared Public Slug A',
    });
    const groupB = await scenario.createGroup({
      token: adminB.token,
      name: 'shared-public-slug',
      displayName: 'Shared Public Slug B',
    });

    assert.notStrictEqual(groupA.id, groupB.id);
    assert.strictEqual(groupA.name, 'shared-public-slug');
    assert.strictEqual(groupB.name, 'shared-public-slug');

    const orgLinks = await db
      .select({
        organizationId: cpSchema.cpOrganizationGroups.organizationId,
        publicName: cpSchema.cpOrganizationGroups.publicName,
      })
      .from(cpSchema.cpOrganizationGroups)
      .where(eq(cpSchema.cpOrganizationGroups.publicName, 'shared-public-slug'));

    assert.deepStrictEqual(
      orgLinks.map((row) => row.organizationId).sort(),
      [orgA.organizationId, orgB.organizationId].sort()
    );

    const upstreamGroups = await openpathDb
      .select({
        id: openpathSchema.whitelistGroups.id,
        name: openpathSchema.whitelistGroups.name,
      })
      .from(openpathSchema.whitelistGroups)
      .where(inArray(openpathSchema.whitelistGroups.id, [groupA.id, groupB.id]));

    assert.strictEqual(upstreamGroups.length, 2);
    assert.notStrictEqual(upstreamGroups[0].name, upstreamGroups[1].name);
    assert.ok(upstreamGroups.every((group) => group.name.startsWith('cpg-')));
  });

  test('groups.create allows the same public slug in different organizations', async () => {
    await resetDb();

    const scenario = buildScenario();

    const { actor: adminA } = await scenario.createOrgAdmin({
      userId: 'groups-admin-a',
      organizationName: 'Groups Test Org A',
    });
    const { actor: adminB } = await scenario.createOrgAdmin({
      userId: 'groups-admin-b',
      organizationName: 'Groups Test Org B',
    });

    const groupA = await scenario.createGroup({
      token: adminA.token,
      name: 'shared-slug',
      displayName: 'Shared Slug A',
    });
    const groupB = await scenario.createGroup({
      token: adminB.token,
      name: 'shared-slug',
      displayName: 'Shared Slug B',
    });

    assert.strictEqual(groupA.name, 'shared-slug');
    assert.strictEqual(groupB.name, 'shared-slug');
    assert.notStrictEqual(groupA.id, groupB.id);

    const storedGroups = await openpathDb
      .select({
        id: openpathSchema.whitelistGroups.id,
        name: openpathSchema.whitelistGroups.name,
      })
      .from(openpathSchema.whitelistGroups)
      .where(inArray(openpathSchema.whitelistGroups.id, [groupA.id, groupB.id]));

    assert.strictEqual(storedGroups.length, 2);
    const byId = new Map(storedGroups.map((group) => [group.id, group.name]));
    assert.notStrictEqual(byId.get(groupA.id), byId.get(groupB.id));
    assert.notStrictEqual(byId.get(groupA.id), 'shared-slug');
    assert.notStrictEqual(byId.get(groupB.id), 'shared-slug');

    const lookupA = await trpcQuery(
      integration.baseUrl,
      'groups.getByName',
      { name: 'shared-slug' },
      bearerAuth(adminA.token)
    );
    assertStatus(lookupA, 200);
    const { data: dataA } = (await parseTRPC(lookupA)) as { data: any };
    assert.strictEqual(dataA?.id, groupA.id);
    assert.strictEqual(dataA?.name, 'shared-slug');

    const lookupB = await trpcQuery(
      integration.baseUrl,
      'groups.getByName',
      { name: 'shared-slug' },
      bearerAuth(adminB.token)
    );
    assertStatus(lookupB, 200);
    const { data: dataB } = (await parseTRPC(lookupB)) as { data: any };
    assert.strictEqual(dataB?.id, groupB.id);
    assert.strictEqual(dataB?.name, 'shared-slug');
  });

  test('groups.clone blocks inactive sources and exercises rules + templates flows', async () => {
    await resetDb();

    const scenario = buildScenario();

    const { actor: admin, organization } = await scenario.createOrgAdmin({
      userId: 'groups-admin-2',
      organizationName: 'Groups Test Org',
    });
    const teacher = await scenario.addTeacher({
      adminToken: admin.token,
      organizationId: organization.organizationId,
      userId: 'groups-teacher',
    });

    // Admin creates a group and makes it instance_public so teachers can view/clone it.
    const source = await scenario.createGroup({
      token: admin.token,
      name: 'library-source-group',
      displayName: 'Library Source Group',
    });

    await scenario.updateGroup({
      token: admin.token,
      id: source.id,
      visibility: 'instance_public',
    });

    // Add a rule (and trigger duplicate createOrGet branch).
    const createRule1 = await trpcMutate(
      integration.baseUrl,
      'groups.createRule',
      { groupId: source.id, type: 'whitelist', value: 'example.com' },
      bearerAuth(admin.token)
    );
    assertStatus(createRule1, 200);

    const createRuleDup = await trpcMutate(
      integration.baseUrl,
      'groups.createRule',
      { groupId: source.id, type: 'whitelist', value: 'example.com' },
      bearerAuth(admin.token)
    );
    assertStatus(createRuleDup, 200);
    const dupData = (await parseTRPC(createRuleDup)) as { data: any };
    assert.strictEqual(dupData.data?.created, false);

    // Teacher sees it in the library.
    const libraryResp = await trpcQuery(
      integration.baseUrl,
      'groups.libraryList',
      undefined,
      bearerAuth(teacher.token)
    );
    assertStatus(libraryResp, 200);
    const { data: libraryData } = (await parseTRPC(libraryResp)) as { data: any };
    assert.ok(Array.isArray(libraryData));
    assert.ok(libraryData.some((g: any) => g.id === source.id));

    // Teacher clones it (covers group-copy.service actorRole=teacher branch).
    const cloneResp = await trpcMutate(
      integration.baseUrl,
      'groups.clone',
      { sourceGroupId: source.id, name: 'teacher-clone-1', displayName: 'Teacher Clone 1' },
      bearerAuth(teacher.token)
    );
    assertStatus(cloneResp, 200);
    const { data: cloneData } = (await parseTRPC(cloneResp)) as { data: any };
    assert.ok(cloneData?.id, 'clone should return new group id');
    const clonedGroupId = String(cloneData.id);

    // Exercise list/get endpoints on the cloned group.
    const listTeacher = await trpcQuery(
      integration.baseUrl,
      'groups.list',
      undefined,
      bearerAuth(teacher.token)
    );
    assertStatus(listTeacher, 200);
    const { data: teacherGroups } = (await parseTRPC(listTeacher)) as { data: any };
    assert.ok(Array.isArray(teacherGroups));
    assert.ok(teacherGroups.some((g: any) => g.id === clonedGroupId));

    const getById = await trpcQuery(
      integration.baseUrl,
      'groups.getById',
      { id: clonedGroupId },
      bearerAuth(teacher.token)
    );
    assertStatus(getById, 200);

    const getByName = await trpcQuery(
      integration.baseUrl,
      'groups.getByName',
      { name: 'teacher-clone-1' },
      bearerAuth(teacher.token)
    );
    assertStatus(getByName, 200);

    // Rules list + update + delete flows.
    const rulesList = await trpcQuery(
      integration.baseUrl,
      'groups.listRulesPaginated',
      { groupId: clonedGroupId, limit: 50, offset: 0 },
      bearerAuth(teacher.token)
    );
    assertStatus(rulesList, 200);
    const { data: rulesPage } = (await parseTRPC(rulesList)) as { data: any };
    assert.ok(Array.isArray(rulesPage?.rules));
    const firstRuleId = String(rulesPage.rules[0]?.id ?? '');
    assert.ok(firstRuleId, 'expected at least one cloned rule');

    const updateRuleResp = await trpcMutate(
      integration.baseUrl,
      'groups.updateRule',
      { id: firstRuleId, groupId: clonedGroupId, comment: 'updated' },
      bearerAuth(teacher.token)
    );
    assertStatus(updateRuleResp, 200);

    const bulkCreate = await trpcMutate(
      integration.baseUrl,
      'groups.bulkCreateRules',
      { groupId: clonedGroupId, type: 'whitelist', values: ['a.com', 'a.com', 'b.com'] },
      bearerAuth(teacher.token)
    );
    assertStatus(bulkCreate, 200);

    const grouped = await trpcQuery(
      integration.baseUrl,
      'groups.listRulesGrouped',
      { groupId: clonedGroupId, limit: 10, offset: 0 },
      bearerAuth(teacher.token)
    );
    assertStatus(grouped, 200);

    const delRuleResp = await trpcMutate(
      integration.baseUrl,
      'groups.deleteRule',
      { id: firstRuleId, groupId: clonedGroupId },
      bearerAuth(teacher.token)
    );
    assertStatus(delRuleResp, 200);

    // Bulk delete (teacher path).
    const afterRules = await trpcQuery(
      integration.baseUrl,
      'groups.listRulesPaginated',
      { groupId: clonedGroupId, limit: 50, offset: 0 },
      bearerAuth(teacher.token)
    );
    assertStatus(afterRules, 200);
    const { data: afterRulesPage } = (await parseTRPC(afterRules)) as { data: any };
    const ids = (afterRulesPage.rules as any[]).slice(0, 2).map((r) => String(r.id));
    const bulkDelete = await trpcMutate(
      integration.baseUrl,
      'groups.bulkDeleteRules',
      { ids },
      bearerAuth(teacher.token)
    );
    assertStatus(bulkDelete, 200);

    // System stats endpoints (admin + teacher branches).
    const statsAdmin = await trpcQuery(
      integration.baseUrl,
      'groups.stats',
      undefined,
      bearerAuth(admin.token)
    );
    assertStatus(statsAdmin, 200);
    const statsTeacher = await trpcQuery(
      integration.baseUrl,
      'groups.stats',
      undefined,
      bearerAuth(teacher.token)
    );
    assertStatus(statsTeacher, 200);

    const systemStatus = await trpcQuery(
      integration.baseUrl,
      'groups.systemStatus',
      undefined,
      bearerAuth(admin.token)
    );
    assertStatus(systemStatus, 200);

    // Templates: publish from group (admin-only) and import as teacher.
    const publishTpl = await trpcMutate(
      integration.baseUrl,
      'templates.publishFromGroup',
      { groupId: clonedGroupId },
      bearerAuth(admin.token)
    );
    assertStatus(publishTpl, 200);
    const { data: tplData } = (await parseTRPC(publishTpl)) as { data: any };
    assert.ok(tplData?.id, 'publishFromGroup should return template id');
    const templateId = String(tplData.id);

    const importTpl = await trpcMutate(
      integration.baseUrl,
      'templates.import',
      { templateId, name: 'tpl-import-1', displayName: 'Imported' },
      bearerAuth(teacher.token)
    );
    assertStatus(importTpl, 200);
    const { data: importedData } = (await parseTRPC(importTpl)) as { data: any };
    assert.ok(importedData?.id, 'templates.import should return group id');

    // Disable the original source group and ensure cloning now fails with CONFLICT.
    await scenario.updateGroup({ token: admin.token, id: source.id, enabled: false });
    const cloneInactive = await trpcMutate(
      integration.baseUrl,
      'groups.clone',
      { sourceGroupId: source.id, name: 'teacher-clone-inactive' },
      bearerAuth(teacher.token)
    );
    assertStatus(cloneInactive, 409);
    const inactiveErr = await parseTRPC(cloneInactive);
    assert.strictEqual(inactiveErr.code, 'CONFLICT');
  });
});
