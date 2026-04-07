const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useIntegrationServer } from './harness.js';
import { createTenantScenario } from './scenario-builder.js';
import { createTenantApiHarness } from '@classroompath/testkit/tenant-api-harness';

const integration = useIntegrationServer({ resetBeforeStart: true });

describe('tenant api harness integration', async () => {
  test('creates tenant groups and classrooms through a typed shared harness', async () => {
    const scenario = createTenantScenario({
      baseUrl: integration.baseUrl,
      jwtSecret: JWT_SECRET,
    });
    const { actor: admin } = await scenario.seedOrgAdmin({
      userId: `tenant-api-admin-${Date.now()}`,
      organizationName: `Tenant API Org ${Date.now()}`,
    });

    const tenantApi = createTenantApiHarness({
      baseUrl: integration.baseUrl,
      token: admin.token,
    });

    const group = await tenantApi.createGroup({
      name: `tenant-api-group-${Date.now()}`,
    });
    const classroom = await tenantApi.createClassroom({
      name: `tenant-api-classroom-${Date.now()}`,
      defaultGroupId: group.id,
    });

    assert.ok(group.id);
    assert.ok(classroom.id);
    assert.equal(classroom.defaultGroupId, group.id);
  });
});
