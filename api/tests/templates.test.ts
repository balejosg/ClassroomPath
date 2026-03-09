import assert from 'node:assert';
import { after, before, beforeEach, describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';
import { eq, inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { templatesRouter } from '../src/trpc/routers/templates.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const ORG_ID = `org_templates_${RUN_ID}`;
const ADMIN_ID = `admin_templates_${RUN_ID}`;
const TEACHER_ID = `teacher_templates_${RUN_ID}`;
const TEMPLATE_ALPHA_ID = `tpl_alpha_${RUN_ID}`;
const TEMPLATE_BETA_ID = `tpl_beta_${RUN_ID}`;

function createCaller(userId: string) {
  return templatesRouter.createCaller({
    user: {
      sub: userId,
      email: `${userId}@example.com`,
      name: userId,
      roles: [],
    },
    token: null,
    req: {} as never,
    res: {} as never,
    authFailure: null,
  });
}

async function cleanupTemplates() {
  const templateIds = [TEMPLATE_ALPHA_ID, TEMPLATE_BETA_ID];

  await db
    .delete(schema.cpGroupTemplateRules)
    .where(inArray(schema.cpGroupTemplateRules.templateId, templateIds));
  await db.delete(schema.cpGroupTemplates).where(inArray(schema.cpGroupTemplates.id, templateIds));
}

describe('Templates Router', () => {
  before(async () => {
    await cleanupTemplates();
    await db
      .delete(schema.cpMemberships)
      .where(inArray(schema.cpMemberships.userId, [ADMIN_ID, TEACHER_ID]));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));

    await db.insert(schema.cpOrganizations).values({
      id: ORG_ID,
      name: `Templates Org ${RUN_ID}`,
      createdBy: ADMIN_ID,
    });

    await db.insert(schema.cpMemberships).values([
      {
        id: `membership_admin_${RUN_ID}`,
        userId: ADMIN_ID,
        organizationId: ORG_ID,
        role: 'admin',
        invitedBy: ADMIN_ID,
      },
      {
        id: `membership_teacher_${RUN_ID}`,
        userId: TEACHER_ID,
        organizationId: ORG_ID,
        role: 'teacher',
        invitedBy: ADMIN_ID,
      },
    ]);
  });

  beforeEach(async () => {
    await cleanupTemplates();
  });

  after(async () => {
    await cleanupTemplates();
    await db
      .delete(schema.cpMemberships)
      .where(inArray(schema.cpMemberships.userId, [ADMIN_ID, TEACHER_ID]));
    await db.delete(schema.cpOrganizations).where(eq(schema.cpOrganizations.id, ORG_ID));
  });

  it('lists templates with rule counts and ISO dates', async () => {
    const alphaCreatedAt = new Date('2026-02-01T10:00:00.000Z');
    const betaCreatedAt = new Date('2026-02-02T10:00:00.000Z');

    await db.insert(schema.cpGroupTemplates).values([
      {
        id: TEMPLATE_ALPHA_ID,
        name: `template-alpha-${RUN_ID}`,
        displayName: 'Template Alpha',
        description: 'Alpha description',
        createdBy: ADMIN_ID,
        createdAt: alphaCreatedAt,
        updatedAt: alphaCreatedAt,
      },
      {
        id: TEMPLATE_BETA_ID,
        name: `template-beta-${RUN_ID}`,
        displayName: 'Template Beta',
        description: null,
        createdBy: ADMIN_ID,
        createdAt: betaCreatedAt,
        updatedAt: betaCreatedAt,
      },
    ]);

    await db.insert(schema.cpGroupTemplateRules).values([
      {
        id: `rule_alpha_one_${RUN_ID}`,
        templateId: TEMPLATE_ALPHA_ID,
        type: 'whitelist',
        value: 'alpha.example.com',
        comment: 'Alpha rule',
      },
      {
        id: `rule_alpha_two_${RUN_ID}`,
        templateId: TEMPLATE_ALPHA_ID,
        type: 'blocked_path',
        value: 'alpha.example.com/private',
        comment: null,
      },
      {
        id: `rule_beta_one_${RUN_ID}`,
        templateId: TEMPLATE_BETA_ID,
        type: 'whitelist',
        value: 'beta.example.com',
        comment: 'Beta rule',
      },
    ]);

    const caller = createCaller(ADMIN_ID);
    const templates = await caller.list();

    const alpha = templates.find((template) => template.id === TEMPLATE_ALPHA_ID);
    const beta = templates.find((template) => template.id === TEMPLATE_BETA_ID);

    assert.ok(alpha);
    assert.ok(beta);
    assert.strictEqual(alpha.ruleCount, 2);
    assert.strictEqual(beta.ruleCount, 1);
    assert.strictEqual(alpha.createdAt, alphaCreatedAt.toISOString());
    assert.strictEqual(beta.updatedAt, betaCreatedAt.toISOString());
  });

  it('paginates and filters template rules and rejects missing templates', async () => {
    await db.insert(schema.cpGroupTemplates).values({
      id: TEMPLATE_ALPHA_ID,
      name: `template-alpha-${RUN_ID}`,
      displayName: 'Template Alpha',
      description: 'Alpha description',
      createdBy: ADMIN_ID,
    });

    await db.insert(schema.cpGroupTemplateRules).values([
      {
        id: `rule_paginated_one_${RUN_ID}`,
        templateId: TEMPLATE_ALPHA_ID,
        type: 'whitelist',
        value: 'alpha.example.com',
        comment: 'Alpha Teacher',
      },
      {
        id: `rule_paginated_two_${RUN_ID}`,
        templateId: TEMPLATE_ALPHA_ID,
        type: 'whitelist',
        value: 'beta.example.com',
        comment: 'Second rule',
      },
      {
        id: `rule_paginated_three_${RUN_ID}`,
        templateId: TEMPLATE_ALPHA_ID,
        type: 'blocked_path',
        value: 'beta.example.com/private',
        comment: 'Hidden path',
      },
    ]);

    const caller = createCaller(ADMIN_ID);

    const firstPage = await caller.listRulesPaginated({
      templateId: TEMPLATE_ALPHA_ID,
      limit: 1,
      offset: 0,
    });

    assert.strictEqual(firstPage.total, 3);
    assert.strictEqual(firstPage.rules.length, 1);
    assert.strictEqual(firstPage.hasMore, true);

    const filtered = await caller.listRulesPaginated({
      templateId: TEMPLATE_ALPHA_ID,
      type: 'whitelist',
      limit: 10,
      offset: 0,
      search: 'teacher',
    });

    assert.strictEqual(filtered.total, 1);
    assert.strictEqual(filtered.hasMore, false);
    assert.strictEqual(filtered.rules[0]?.value, 'alpha.example.com');
    assert.strictEqual(filtered.rules[0]?.comment, 'Alpha Teacher');

    await assert.rejects(
      () =>
        caller.listRulesPaginated({
          templateId: `missing_${RUN_ID}`,
          limit: 10,
          offset: 0,
        }),
      (error: unknown) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'NOT_FOUND');
        return true;
      }
    );
  });

  it('requires admin access to publish templates from groups', async () => {
    const teacherCaller = createCaller(TEACHER_ID);

    await assert.rejects(
      () =>
        teacherCaller.publishFromGroup({
          groupId: `group_${RUN_ID}`,
        }),
      (error: unknown) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'FORBIDDEN');
        assert.strictEqual(error.message, 'Admin access required');
        return true;
      }
    );
  });
});
