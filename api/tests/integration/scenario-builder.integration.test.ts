const JWT_SECRET = 'test-jwt-secret';
process.env.JWT_SECRET = JWT_SECRET;
process.env.NODE_ENV = 'test';

import { describe, test } from 'node:test';
import assert from 'node:assert';

import { assertStatus, bearerAuth, parseTRPC, trpcQuery } from '../test-utils.js';
import { useIntegrationServer } from './harness.js';
import { createTenantScenario } from './scenario-builder.js';

const integration = useIntegrationServer({ resetBeforeStart: true });

describe('integration scenario builder', async () => {
  test('seedOrgAdmin and seedMember build reusable direct-db tenant fixtures', async () => {
    const scenario = createTenantScenario({
      baseUrl: integration.baseUrl,
      jwtSecret: JWT_SECRET,
    });
    const { actor: admin, organization } = await scenario.seedOrgAdmin({
      userId: `seed-admin-${Date.now()}`,
      organizationName: `Seed Org ${Date.now()}`,
    });

    const teacher = await scenario.seedMember({
      organizationId: organization.organizationId,
      invitedBy: admin.userId,
      role: 'teacher',
      userId: `seed-teacher-${Date.now()}`,
    });

    const response = await trpcQuery(
      integration.baseUrl,
      'users.list',
      undefined,
      bearerAuth(admin.token)
    );
    assertStatus(response, 200);

    const { data } = (await parseTRPC(response)) as {
      data: Array<{ email: string; role?: string; roles?: Array<{ role: string }> }>;
    };
    const emails = new Set(data.map((user) => user.email));

    assert.ok(emails.has(admin.email));
    assert.ok(emails.has(teacher.email));
  });
});
