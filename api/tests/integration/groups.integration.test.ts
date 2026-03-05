/**
 * ClassroomPath groups integration tests (/cp/trpc/groups.*)
 */

const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';

import {
  getAvailablePort,
  trpcQuery,
  trpcMutate,
  parseTRPC,
  bearerAuth,
  assertStatus,
  resetDb,
  uniqueEmail,
} from '../test-utils.js';

import { openpathDb, openpathSchema } from '../../src/db/openpath.js';
import { closeConnection } from '../../src/db/index.js';
import { closeOpenPathConnection } from '../../src/db/openpath.js';

let PORT: number;
let API_URL: string;
let server: Server | undefined;

type TestUser = {
  userId: string;
  email: string;
  name: string;
};

function signToken(params: { userId: string; email: string; name: string; roles: any[] }): string {
  return jwt.sign(
    {
      sub: params.userId,
      email: params.email,
      name: params.name,
      roles: params.roles,
    },
    JWT_SECRET
  );
}

async function ensureOpenPathUser(u: TestUser): Promise<void> {
  await openpathDb
    .insert(openpathSchema.users)
    .values({
      id: u.userId,
      email: u.email,
      name: u.name,
      passwordHash: 'hashed',
    })
    .onConflictDoNothing();
}

async function bootstrapOrg(admin: { token: string }): Promise<{ organizationId: string }> {
  const createResp = await trpcMutate(
    API_URL,
    'onboarding.createOrganization',
    { name: 'Groups Test Org' },
    bearerAuth(admin.token)
  );
  assertStatus(createResp, 200);
  const { data } = (await parseTRPC(createResp)) as { data: any };
  assert.ok(data?.organizationId, 'createOrganization should return organizationId');
  return { organizationId: String(data.organizationId) };
}

async function approveTeacher(params: {
  adminToken: string;
  teacherToken: string;
  teacherUserId: string;
  organizationId: string;
}): Promise<void> {
  const waitResp = await trpcMutate(
    API_URL,
    'onboarding.waitForInvitation',
    { targetOrganizationId: params.organizationId },
    bearerAuth(params.teacherToken)
  );
  assertStatus(waitResp, 200);

  const approveResp = await trpcMutate(
    API_URL,
    'pendingUsers.approve',
    { userId: params.teacherUserId, role: 'teacher' },
    bearerAuth(params.adminToken)
  );
  assertStatus(approveResp, 200);
}

async function createGroup(params: {
  token: string;
  name: string;
  displayName?: string;
}): Promise<{ id: string; name: string }> {
  const resp = await trpcMutate(
    API_URL,
    'groups.create',
    { name: params.name, displayName: params.displayName ?? params.name },
    bearerAuth(params.token)
  );
  assertStatus(resp, 200);
  const { data } = (await parseTRPC(resp)) as { data: any };
  assert.ok(data?.id, 'groups.create should return id');
  return { id: String(data.id), name: String(data.name) };
}

async function updateGroup(params: {
  token: string;
  id: string;
  enabled?: boolean;
  visibility?: 'private' | 'instance_public';
  displayName?: string;
}): Promise<void> {
  const resp = await trpcMutate(
    API_URL,
    'groups.update',
    {
      id: params.id,
      enabled: params.enabled,
      visibility: params.visibility,
      displayName: params.displayName,
    },
    bearerAuth(params.token)
  );
  assertStatus(resp, 200);
}

describe('ClassroomPath groups integration (/cp/trpc)', async () => {
  before(async () => {
    await resetDb();

    PORT = await getAvailablePort();
    API_URL = `http://localhost:${String(PORT)}`;
    process.env.CP_PORT = String(PORT);

    const { app } = await import('../../src/server.js');
    server = app.listen(PORT);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  after(async () => {
    const srv = server;
    server = undefined;
    if (srv !== undefined) {
      try {
        if ((srv as any).listening === true) {
          await new Promise<void>((resolve, reject) => {
            srv.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      } catch (err: any) {
        if (err?.code !== 'ERR_SERVER_NOT_RUNNING') throw err;
      }
    }

    await closeConnection();
    await closeOpenPathConnection();

    // Close undici keep-alives so node:test can exit cleanly.
    try {
      const undici: any = await import('undici');
      const dispatcher: any = undici.getGlobalDispatcher?.();
      if (typeof dispatcher?.close === 'function') {
        await dispatcher.close();
      }
    } catch {
      // best-effort
    }
  });

  test('groups.create returns CONFLICT when name/slug already exists', async () => {
    await resetDb();

    const adminUserId = 'groups-admin';
    const adminEmail = uniqueEmail('admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    await bootstrapOrg({ token: adminToken });

    await createGroup({ token: adminToken, name: 'dup-group', displayName: 'Dup Group' });

    const dupResp = await trpcMutate(
      API_URL,
      'groups.create',
      { name: 'dup-group', displayName: 'Dup Group 2' },
      bearerAuth(adminToken)
    );
    assertStatus(dupResp, 409);
    const { code, error } = await parseTRPC(dupResp);
    assert.strictEqual(code, 'CONFLICT');
    assert.ok((error ?? '').toLowerCase().includes('ya existe'));
  });

  test('groups.clone blocks inactive sources and exercises rules + templates flows', async () => {
    await resetDb();

    const adminUserId = 'groups-admin-2';
    const adminEmail = uniqueEmail('admin');
    await ensureOpenPathUser({ userId: adminUserId, email: adminEmail, name: 'Admin User' });
    const adminToken = signToken({
      userId: adminUserId,
      email: adminEmail,
      name: 'Admin User',
      roles: [{ role: 'admin' }],
    });

    const teacherUserId = 'groups-teacher';
    const teacherEmail = uniqueEmail('teacher');
    await ensureOpenPathUser({ userId: teacherUserId, email: teacherEmail, name: 'Teacher User' });
    const teacherToken = signToken({
      userId: teacherUserId,
      email: teacherEmail,
      name: 'Teacher User',
      roles: [{ role: 'teacher', groupIds: [] }],
    });

    const { organizationId } = await bootstrapOrg({ token: adminToken });
    await approveTeacher({
      adminToken,
      teacherToken,
      teacherUserId,
      organizationId,
    });

    // Admin creates a group and makes it instance_public so teachers can view/clone it.
    const source = await createGroup({
      token: adminToken,
      name: 'library-source-group',
      displayName: 'Library Source Group',
    });

    await updateGroup({ token: adminToken, id: source.id, visibility: 'instance_public' });

    // Add a rule (and trigger duplicate createOrGet branch).
    const createRule1 = await trpcMutate(
      API_URL,
      'groups.createRule',
      { groupId: source.id, type: 'whitelist', value: 'example.com' },
      bearerAuth(adminToken)
    );
    assertStatus(createRule1, 200);

    const createRuleDup = await trpcMutate(
      API_URL,
      'groups.createRule',
      { groupId: source.id, type: 'whitelist', value: 'example.com' },
      bearerAuth(adminToken)
    );
    assertStatus(createRuleDup, 200);
    const dupData = (await parseTRPC(createRuleDup)) as { data: any };
    assert.strictEqual(dupData.data?.created, false);

    // Teacher sees it in the library.
    const libraryResp = await trpcQuery(
      API_URL,
      'groups.libraryList',
      undefined,
      bearerAuth(teacherToken)
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
      bearerAuth(teacherToken)
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
      bearerAuth(teacherToken)
    );
    assertStatus(listTeacher, 200);
    const { data: teacherGroups } = (await parseTRPC(listTeacher)) as { data: any };
    assert.ok(Array.isArray(teacherGroups));
    assert.ok(teacherGroups.some((g: any) => g.id === clonedGroupId));

    const getById = await trpcQuery(
      API_URL,
      'groups.getById',
      { id: clonedGroupId },
      bearerAuth(teacherToken)
    );
    assertStatus(getById, 200);

    const getByName = await trpcQuery(
      API_URL,
      'groups.getByName',
      { name: 'teacher-clone-1' },
      bearerAuth(teacherToken)
    );
    assertStatus(getByName, 200);

    // Rules list + update + delete flows.
    const rulesList = await trpcQuery(
      API_URL,
      'groups.listRulesPaginated',
      { groupId: clonedGroupId, limit: 50, offset: 0 },
      bearerAuth(teacherToken)
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
      bearerAuth(teacherToken)
    );
    assertStatus(updateRuleResp, 200);

    const bulkCreate = await trpcMutate(
      API_URL,
      'groups.bulkCreateRules',
      { groupId: clonedGroupId, type: 'whitelist', values: ['a.com', 'a.com', 'b.com'] },
      bearerAuth(teacherToken)
    );
    assertStatus(bulkCreate, 200);

    const grouped = await trpcQuery(
      API_URL,
      'groups.listRulesGrouped',
      { groupId: clonedGroupId, limit: 10, offset: 0 },
      bearerAuth(teacherToken)
    );
    assertStatus(grouped, 200);

    const delRuleResp = await trpcMutate(
      API_URL,
      'groups.deleteRule',
      { id: firstRuleId, groupId: clonedGroupId },
      bearerAuth(teacherToken)
    );
    assertStatus(delRuleResp, 200);

    // Bulk delete (teacher path).
    const afterRules = await trpcQuery(
      API_URL,
      'groups.listRulesPaginated',
      { groupId: clonedGroupId, limit: 50, offset: 0 },
      bearerAuth(teacherToken)
    );
    assertStatus(afterRules, 200);
    const { data: afterRulesPage } = (await parseTRPC(afterRules)) as { data: any };
    const ids = (afterRulesPage.rules as any[]).slice(0, 2).map((r) => String(r.id));
    const bulkDelete = await trpcMutate(
      API_URL,
      'groups.bulkDeleteRules',
      { ids },
      bearerAuth(teacherToken)
    );
    assertStatus(bulkDelete, 200);

    // System stats endpoints (admin + teacher branches).
    const statsAdmin = await trpcQuery(API_URL, 'groups.stats', undefined, bearerAuth(adminToken));
    assertStatus(statsAdmin, 200);
    const statsTeacher = await trpcQuery(
      API_URL,
      'groups.stats',
      undefined,
      bearerAuth(teacherToken)
    );
    assertStatus(statsTeacher, 200);

    const systemStatus = await trpcQuery(
      API_URL,
      'groups.systemStatus',
      undefined,
      bearerAuth(adminToken)
    );
    assertStatus(systemStatus, 200);

    // Templates: publish from group (admin-only) and import as teacher.
    const publishTpl = await trpcMutate(
      API_URL,
      'templates.publishFromGroup',
      { groupId: clonedGroupId },
      bearerAuth(adminToken)
    );
    assertStatus(publishTpl, 200);
    const { data: tplData } = (await parseTRPC(publishTpl)) as { data: any };
    assert.ok(tplData?.id, 'publishFromGroup should return template id');
    const templateId = String(tplData.id);

    const importTpl = await trpcMutate(
      API_URL,
      'templates.import',
      { templateId, name: 'tpl-import-1', displayName: 'Imported' },
      bearerAuth(teacherToken)
    );
    assertStatus(importTpl, 200);
    const { data: importedData } = (await parseTRPC(importTpl)) as { data: any };
    assert.ok(importedData?.id, 'templates.import should return group id');

    // Disable the original source group and ensure cloning now fails with CONFLICT.
    await updateGroup({ token: adminToken, id: source.id, enabled: false });
    const cloneInactive = await trpcMutate(
      API_URL,
      'groups.clone',
      { sourceGroupId: source.id, name: 'teacher-clone-inactive' },
      bearerAuth(teacherToken)
    );
    assertStatus(cloneInactive, 409);
    const inactiveErr = await parseTRPC(cloneInactive);
    assert.strictEqual(inactiveErr.code, 'CONFLICT');
  });
});
