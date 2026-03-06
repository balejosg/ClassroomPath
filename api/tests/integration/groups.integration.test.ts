/**
 * ClassroomPath groups integration tests (/cp/trpc/groups.*)
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
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
import {
  type IntegrationServerHandle,
  startIntegrationServer,
  stopIntegrationServer,
} from './harness.js';
import { createTenantScenario } from './scenario-builder.js';

let API_URL: string;
let integrationServer: IntegrationServerHandle | undefined;

describe('ClassroomPath groups integration (/cp/trpc)', async () => {
  before(async () => {
    await resetDb();

    integrationServer = await startIntegrationServer();
    API_URL = integrationServer.baseUrl;
  });

  after(async () => {
    const currentServer = integrationServer;
    integrationServer = undefined;
    await stopIntegrationServer(currentServer?.server);
  });

  test('groups.create returns CONFLICT when name/slug already exists', async () => {
    await resetDb();

    const scenario = createTenantScenario({ baseUrl: API_URL, jwtSecret: JWT_SECRET });

    const { actor: admin } = await scenario.createOrgAdmin({
      userId: 'groups-admin',
      organizationName: 'Groups Test Org',
    });

    await scenario.createGroup({ token: admin.token, name: 'dup-group', displayName: 'Dup Group' });

    const dupResp = await trpcMutate(
      API_URL,
      'groups.create',
      { name: 'dup-group', displayName: 'Dup Group 2' },
      bearerAuth(admin.token)
    );
    assertStatus(dupResp, 409);
    const { code, error } = await parseTRPC(dupResp);
    assert.strictEqual(code, 'CONFLICT');
    assert.ok((error ?? '').toLowerCase().includes('ya existe'));
  });

  test('groups.clone blocks inactive sources and exercises rules + templates flows', async () => {
    await resetDb();

    const scenario = createTenantScenario({ baseUrl: API_URL, jwtSecret: JWT_SECRET });

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
      API_URL,
      'groups.createRule',
      { groupId: source.id, type: 'whitelist', value: 'example.com' },
      bearerAuth(admin.token)
    );
    assertStatus(createRule1, 200);

    const createRuleDup = await trpcMutate(
      API_URL,
      'groups.createRule',
      { groupId: source.id, type: 'whitelist', value: 'example.com' },
      bearerAuth(admin.token)
    );
    assertStatus(createRuleDup, 200);
    const dupData = (await parseTRPC(createRuleDup)) as { data: any };
    assert.strictEqual(dupData.data?.created, false);

    // Teacher sees it in the library.
    const libraryResp = await trpcQuery(
      API_URL,
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
      API_URL,
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
      API_URL,
      'groups.list',
      undefined,
      bearerAuth(teacher.token)
    );
    assertStatus(listTeacher, 200);
    const { data: teacherGroups } = (await parseTRPC(listTeacher)) as { data: any };
    assert.ok(Array.isArray(teacherGroups));
    assert.ok(teacherGroups.some((g: any) => g.id === clonedGroupId));

    const getById = await trpcQuery(
      API_URL,
      'groups.getById',
      { id: clonedGroupId },
      bearerAuth(teacher.token)
    );
    assertStatus(getById, 200);

    const getByName = await trpcQuery(
      API_URL,
      'groups.getByName',
      { name: 'teacher-clone-1' },
      bearerAuth(teacher.token)
    );
    assertStatus(getByName, 200);

    // Rules list + update + delete flows.
    const rulesList = await trpcQuery(
      API_URL,
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
      API_URL,
      'groups.updateRule',
      { id: firstRuleId, groupId: clonedGroupId, comment: 'updated' },
      bearerAuth(teacher.token)
    );
    assertStatus(updateRuleResp, 200);

    const bulkCreate = await trpcMutate(
      API_URL,
      'groups.bulkCreateRules',
      { groupId: clonedGroupId, type: 'whitelist', values: ['a.com', 'a.com', 'b.com'] },
      bearerAuth(teacher.token)
    );
    assertStatus(bulkCreate, 200);

    const grouped = await trpcQuery(
      API_URL,
      'groups.listRulesGrouped',
      { groupId: clonedGroupId, limit: 10, offset: 0 },
      bearerAuth(teacher.token)
    );
    assertStatus(grouped, 200);

    const delRuleResp = await trpcMutate(
      API_URL,
      'groups.deleteRule',
      { id: firstRuleId, groupId: clonedGroupId },
      bearerAuth(teacher.token)
    );
    assertStatus(delRuleResp, 200);

    // Bulk delete (teacher path).
    const afterRules = await trpcQuery(
      API_URL,
      'groups.listRulesPaginated',
      { groupId: clonedGroupId, limit: 50, offset: 0 },
      bearerAuth(teacher.token)
    );
    assertStatus(afterRules, 200);
    const { data: afterRulesPage } = (await parseTRPC(afterRules)) as { data: any };
    const ids = (afterRulesPage.rules as any[]).slice(0, 2).map((r) => String(r.id));
    const bulkDelete = await trpcMutate(
      API_URL,
      'groups.bulkDeleteRules',
      { ids },
      bearerAuth(teacher.token)
    );
    assertStatus(bulkDelete, 200);

    // System stats endpoints (admin + teacher branches).
    const statsAdmin = await trpcQuery(API_URL, 'groups.stats', undefined, bearerAuth(admin.token));
    assertStatus(statsAdmin, 200);
    const statsTeacher = await trpcQuery(
      API_URL,
      'groups.stats',
      undefined,
      bearerAuth(teacher.token)
    );
    assertStatus(statsTeacher, 200);

    const systemStatus = await trpcQuery(
      API_URL,
      'groups.systemStatus',
      undefined,
      bearerAuth(admin.token)
    );
    assertStatus(systemStatus, 200);

    // Templates: publish from group (admin-only) and import as teacher.
    const publishTpl = await trpcMutate(
      API_URL,
      'templates.publishFromGroup',
      { groupId: clonedGroupId },
      bearerAuth(admin.token)
    );
    assertStatus(publishTpl, 200);
    const { data: tplData } = (await parseTRPC(publishTpl)) as { data: any };
    assert.ok(tplData?.id, 'publishFromGroup should return template id');
    const templateId = String(tplData.id);

    const importTpl = await trpcMutate(
      API_URL,
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
      API_URL,
      'groups.clone',
      { sourceGroupId: source.id, name: 'teacher-clone-inactive' },
      bearerAuth(teacher.token)
    );
    assertStatus(cloneInactive, 409);
    const inactiveErr = await parseTRPC(cloneInactive);
    assert.strictEqual(inactiveErr.code, 'CONFLICT');
  });
});
