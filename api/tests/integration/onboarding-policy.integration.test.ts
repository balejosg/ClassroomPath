const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert';
import { eq } from 'drizzle-orm';

import { db, schema } from '../../src/db/index.js';
import {
  bearerAuth,
  parseTRPC,
  resetDb,
  trpcMutate,
  trpcQuery,
  uniqueEmail,
} from '../test-utils.js';
import { ensureOpenPathUser, signToken, useIntegrationServer } from './harness.js';

const integration = useIntegrationServer({ resetBeforeStart: true });

const originalNodeEnv = process.env.NODE_ENV;
const originalAllowSelfServiceOrgs = process.env.CP_ALLOW_SELF_SERVICE_ORGS;
const originalAllowOrgDirectory = process.env.CP_ALLOW_ORG_DIRECTORY;
const originalPublicUrl = process.env.PUBLIC_URL;
const originalCorsOrigins = process.env.CORS_ORIGINS;

const productionPolicyOrigin = 'https://classroompath.test';

function restorePolicyEnv(): void {
  process.env.NODE_ENV = originalNodeEnv ?? 'test';

  if (originalAllowSelfServiceOrgs === undefined) {
    delete process.env.CP_ALLOW_SELF_SERVICE_ORGS;
  } else {
    process.env.CP_ALLOW_SELF_SERVICE_ORGS = originalAllowSelfServiceOrgs;
  }

  if (originalAllowOrgDirectory === undefined) {
    delete process.env.CP_ALLOW_ORG_DIRECTORY;
  } else {
    process.env.CP_ALLOW_ORG_DIRECTORY = originalAllowOrgDirectory;
  }

  if (originalPublicUrl === undefined) {
    delete process.env.PUBLIC_URL;
  } else {
    process.env.PUBLIC_URL = originalPublicUrl;
  }

  if (originalCorsOrigins === undefined) {
    delete process.env.CORS_ORIGINS;
  } else {
    process.env.CORS_ORIGINS = originalCorsOrigins;
  }
}

function setProductionPolicyEnv(): void {
  process.env.NODE_ENV = 'production';
  process.env.PUBLIC_URL = productionPolicyOrigin;
  process.env.CORS_ORIGINS = productionPolicyOrigin;
}

async function issueToken(userId: string, email: string, name = 'Onboarding Policy User') {
  await ensureOpenPathUser({ userId, email, name });

  return signToken({
    jwtSecret: JWT_SECRET,
    userId,
    email,
    name,
    roles: [],
  });
}

function uniqueOrgId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

describe('ClassroomPath onboarding policy integration', { concurrency: 1 }, async () => {
  beforeEach(async () => {
    restorePolicyEnv();
    await resetDb();
  });

  afterEach(() => {
    restorePolicyEnv();
  });

  test('blocks self-service organization creation by default in production while hiding the directory', async () => {
    setProductionPolicyEnv();
    delete process.env.CP_ALLOW_SELF_SERVICE_ORGS;
    delete process.env.CP_ALLOW_ORG_DIRECTORY;

    const token = await issueToken('policy-prod-create', uniqueEmail('policy-prod-create'));

    const response = await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      { name: 'Default Production Org' },
      bearerAuth(token)
    );

    assert.strictEqual(response.status, 403);

    const statusResponse = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
    );
    assert.strictEqual(statusResponse.status, 200);
    const statusParsed = (await parseTRPC(statusResponse)) as {
      data?: {
        policy?: { allowSelfServiceOrgs?: boolean; allowOrgDirectory?: boolean };
      };
    };
    assert.strictEqual(statusParsed.data?.policy?.allowSelfServiceOrgs, false);
    assert.strictEqual(statusParsed.data?.policy?.allowOrgDirectory, false);

    const listResponse = await trpcQuery(
      integration.baseUrl,
      'onboarding.listOrganizations',
      undefined,
      bearerAuth(token)
    );
    assert.strictEqual(listResponse.status, 200);
    const listParsed = (await parseTRPC(listResponse)) as {
      data?: Array<{ id: string; name: string }>;
    };
    assert.deepStrictEqual(listParsed.data, []);
  });

  test('hides the organization directory by default in production', async () => {
    setProductionPolicyEnv();
    delete process.env.CP_ALLOW_SELF_SERVICE_ORGS;
    delete process.env.CP_ALLOW_ORG_DIRECTORY;

    const hiddenOrgId1 = uniqueOrgId('org_policy_hidden_1');
    const hiddenOrgId2 = uniqueOrgId('org_policy_hidden_2');

    await db.insert(schema.cpOrganizations).values([
      {
        id: hiddenOrgId1,
        name: 'Hidden Org 1',
        createdBy: 'seed-user',
      },
      {
        id: hiddenOrgId2,
        name: 'Hidden Org 2',
        createdBy: 'seed-user',
      },
    ]);

    const token = await issueToken('policy-prod-directory', uniqueEmail('policy-prod-directory'));

    const response = await trpcQuery(
      integration.baseUrl,
      'onboarding.listOrganizations',
      undefined,
      bearerAuth(token)
    );

    assert.strictEqual(response.status, 200);
    const parsed = (await parseTRPC(response)) as {
      data?: Array<{ id: string; name: string }>;
    };
    assert.deepStrictEqual(parsed.data, []);
  });

  test('still allows wait-for-invitation when the directory is hidden and only one org exists', async () => {
    setProductionPolicyEnv();
    delete process.env.CP_ALLOW_SELF_SERVICE_ORGS;
    delete process.env.CP_ALLOW_ORG_DIRECTORY;

    const waitOnlyOrgId = uniqueOrgId('org_policy_wait_only');

    await db.insert(schema.cpOrganizations).values({
      id: waitOnlyOrgId,
      name: 'Only Organization',
      createdBy: 'seed-user',
    });

    const token = await issueToken('policy-prod-wait', uniqueEmail('policy-prod-wait'));

    const waitResponse = await trpcMutate(
      integration.baseUrl,
      'onboarding.waitForInvitation',
      {},
      bearerAuth(token)
    );
    assert.strictEqual(waitResponse.status, 200);

    const statusResponse = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
    );
    assert.strictEqual(statusResponse.status, 200);
    const parsed = (await parseTRPC(statusResponse)) as {
      data?: { isWaiting?: boolean; policy?: { allowOrgDirectory?: boolean } };
    };
    assert.strictEqual(parsed.data?.isWaiting, true);
    assert.strictEqual(parsed.data?.policy?.allowOrgDirectory, false);
  });

  test('allows generic waiting when the directory is hidden and multiple orgs exist', async () => {
    setProductionPolicyEnv();
    delete process.env.CP_ALLOW_SELF_SERVICE_ORGS;
    delete process.env.CP_ALLOW_ORG_DIRECTORY;

    await db.insert(schema.cpOrganizations).values([
      {
        id: uniqueOrgId('org_policy_hidden_wait_1'),
        name: 'Hidden Wait Org 1',
        createdBy: 'seed-user',
      },
      {
        id: uniqueOrgId('org_policy_hidden_wait_2'),
        name: 'Hidden Wait Org 2',
        createdBy: 'seed-user',
      },
    ]);

    const userId = 'policy-prod-hidden-generic-wait';
    const email = uniqueEmail('policy-prod-hidden-generic-wait');
    const token = await issueToken(userId, email);

    const waitResponse = await trpcMutate(
      integration.baseUrl,
      'onboarding.waitForInvitation',
      {},
      bearerAuth(token)
    );
    assert.strictEqual(waitResponse.status, 200);

    const statusResponse = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
    );
    assert.strictEqual(statusResponse.status, 200);
    const statusParsed = (await parseTRPC(statusResponse)) as {
      data?: { isWaiting?: boolean; policy?: { allowOrgDirectory?: boolean } };
    };
    assert.strictEqual(statusParsed.data?.isWaiting, true);
    assert.strictEqual(statusParsed.data?.policy?.allowOrgDirectory, false);

    const [storedStatus] = await db
      .select({
        status: schema.cpUserStatus.status,
        targetOrganizationId: schema.cpUserStatus.targetOrganizationId,
      })
      .from(schema.cpUserStatus)
      .where(eq(schema.cpUserStatus.userId, userId))
      .limit(1);
    assert.strictEqual(storedStatus?.status, 'waiting');
    assert.strictEqual(storedStatus?.targetOrganizationId ?? null, null);
  });

  test('re-enables self-service creation and org discovery when feature flags are on', async () => {
    setProductionPolicyEnv();
    process.env.CP_ALLOW_SELF_SERVICE_ORGS = 'true';
    process.env.CP_ALLOW_ORG_DIRECTORY = 'true';

    const visibleOrgId = uniqueOrgId('org_policy_visible');

    await db.insert(schema.cpOrganizations).values({
      id: visibleOrgId,
      name: 'Visible Org',
      createdBy: 'seed-user',
    });

    const token = await issueToken('policy-prod-enabled', uniqueEmail('policy-prod-enabled'));

    const statusResponse = await trpcQuery(
      integration.baseUrl,
      'onboarding.status',
      undefined,
      bearerAuth(token)
    );
    assert.strictEqual(statusResponse.status, 200);
    const statusParsed = (await parseTRPC(statusResponse)) as {
      data?: {
        policy?: { allowSelfServiceOrgs?: boolean; allowOrgDirectory?: boolean };
      };
    };
    assert.strictEqual(statusParsed.data?.policy?.allowSelfServiceOrgs, true);
    assert.strictEqual(statusParsed.data?.policy?.allowOrgDirectory, true);

    const listResponse = await trpcQuery(
      integration.baseUrl,
      'onboarding.listOrganizations',
      undefined,
      bearerAuth(token)
    );
    assert.strictEqual(listResponse.status, 200);
    const listParsed = (await parseTRPC(listResponse)) as {
      data?: Array<{ id: string; name: string }>;
    };
    assert.deepStrictEqual(listParsed.data, [
      {
        id: visibleOrgId,
        name: 'Visible Org',
      },
    ]);

    const createResponse = await trpcMutate(
      integration.baseUrl,
      'onboarding.createOrganization',
      { name: 'Feature Flagged Org' },
      bearerAuth(token)
    );
    assert.strictEqual(createResponse.status, 200);
  });
});
