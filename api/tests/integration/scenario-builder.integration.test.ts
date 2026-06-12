import { TEST_JWT_SECRET } from '../helpers/test-env.js';

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
      jwtSecret: TEST_JWT_SECRET,
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

  test('standalone actors can be moved into a seeded tenant flow', async () => {
    const scenario = createTenantScenario({
      baseUrl: integration.baseUrl,
      jwtSecret: TEST_JWT_SECRET,
    });
    const admin = await scenario.createActor({
      userId: `scenario-admin-${Date.now()}`,
      name: 'Scenario Admin',
      role: 'admin',
    });

    const organization = await scenario.seedOrganizationForActor({
      actor: admin,
      organizationName: `Scenario Org ${Date.now()}`,
    });
    const group = await scenario.createGroup({
      actor: admin,
      name: `scenario-group-${Date.now()}`,
    });
    const classroom = await scenario.createClassroom({
      actor: admin,
      name: `scenario-classroom-${Date.now()}`,
      defaultGroupId: group.id,
    });
    const schedule = await scenario.createWeeklySchedule({
      actor: admin,
      classroomId: classroom.id,
      groupId: group.id,
      dayOfWeek: 2,
      startTime: '10:00',
      endTime: '11:00',
    });

    assert.ok(organization.organizationId);
    assert.ok(group.id);
    assert.ok(classroom.id);
    assert.ok(schedule.id);
  });
});
