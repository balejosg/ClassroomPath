import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import { TRPCError } from '@trpc/server';
import { inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';
import { listTemplateRulesPaginated, listTemplates } from '../src/services/template.service.js';

const RUN_ID = Math.random().toString(36).slice(2, 10);
const templateIds = new Set<string>();
const ruleIds = new Set<string>();
let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${RUN_ID}_${String(counter)}`;
}

after(async () => {
  if (ruleIds.size > 0) {
    await db
      .delete(schema.cpGroupTemplateRules)
      .where(inArray(schema.cpGroupTemplateRules.id, [...ruleIds]));
  }

  if (templateIds.size > 0) {
    await db
      .delete(schema.cpGroupTemplates)
      .where(inArray(schema.cpGroupTemplates.id, [...templateIds]));
  }
});

describe('template.service', () => {
  it('lists templates with rule counts and ISO timestamps', async () => {
    const firstTemplateId = nextId('tpl');
    const secondTemplateId = nextId('tpl');
    templateIds.add(firstTemplateId);
    templateIds.add(secondTemplateId);

    const firstCreatedAt = new Date('2026-02-01T10:00:00.000Z');
    const secondCreatedAt = new Date('2026-02-02T10:00:00.000Z');

    await db.insert(schema.cpGroupTemplates).values([
      {
        id: firstTemplateId,
        name: `alpha-${RUN_ID}`,
        displayName: 'Alpha Template',
        description: 'Alpha',
        createdBy: 'seed-user',
        createdAt: firstCreatedAt,
        updatedAt: firstCreatedAt,
      },
      {
        id: secondTemplateId,
        name: `beta-${RUN_ID}`,
        displayName: 'Beta Template',
        description: null,
        createdBy: 'seed-user',
        createdAt: secondCreatedAt,
        updatedAt: secondCreatedAt,
      },
    ]);

    const firstRuleId = nextId('rule');
    const secondRuleId = nextId('rule');
    const thirdRuleId = nextId('rule');
    ruleIds.add(firstRuleId);
    ruleIds.add(secondRuleId);
    ruleIds.add(thirdRuleId);

    await db.insert(schema.cpGroupTemplateRules).values([
      {
        id: firstRuleId,
        templateId: firstTemplateId,
        type: 'whitelist',
        value: 'alpha.example.com',
        comment: 'Allow alpha',
      },
      {
        id: secondRuleId,
        templateId: firstTemplateId,
        type: 'blocked_path',
        value: 'alpha.example.com/docs',
        comment: null,
      },
      {
        id: thirdRuleId,
        templateId: secondTemplateId,
        type: 'whitelist',
        value: 'beta.example.com',
        comment: 'Allow beta',
      },
    ]);

    const templates = await listTemplates();
    const alpha = templates.find((template) => template.id === firstTemplateId);
    const beta = templates.find((template) => template.id === secondTemplateId);

    assert.ok(alpha);
    assert.ok(beta);
    assert.strictEqual(alpha?.ruleCount, 2);
    assert.strictEqual(beta?.ruleCount, 1);
    assert.strictEqual(alpha?.createdAt, firstCreatedAt.toISOString());
    assert.strictEqual(beta?.updatedAt, secondCreatedAt.toISOString());
  });

  it('paginates and filters template rules and rejects missing templates', async () => {
    const templateId = nextId('tpl');
    templateIds.add(templateId);

    await db.insert(schema.cpGroupTemplates).values({
      id: templateId,
      name: `paginated-${RUN_ID}`,
      displayName: 'Paginated Template',
      description: 'Template for pagination',
      createdBy: 'seed-user',
    });

    const ids = [nextId('rule'), nextId('rule'), nextId('rule')];
    ids.forEach((id) => ruleIds.add(id));

    await db.insert(schema.cpGroupTemplateRules).values([
      {
        id: ids[0],
        templateId,
        type: 'whitelist',
        value: 'alpha.example.com',
        comment: 'Teacher visible',
      },
      {
        id: ids[1],
        templateId,
        type: 'whitelist',
        value: 'beta.example.com',
        comment: 'Second rule',
      },
      {
        id: ids[2],
        templateId,
        type: 'blocked_path',
        value: 'beta.example.com/private',
        comment: 'Hidden path',
      },
    ]);

    const firstPage = await listTemplateRulesPaginated({
      templateId,
      limit: 1,
      offset: 0,
    });
    const filtered = await listTemplateRulesPaginated({
      templateId,
      type: 'whitelist',
      limit: 10,
      offset: 0,
      search: 'teacher',
    });

    assert.strictEqual(firstPage.total, 3);
    assert.strictEqual(firstPage.rules.length, 1);
    assert.strictEqual(firstPage.hasMore, true);
    assert.strictEqual(filtered.total, 1);
    assert.strictEqual(filtered.hasMore, false);
    assert.strictEqual(filtered.rules[0]?.value, 'alpha.example.com');

    await assert.rejects(
      () =>
        listTemplateRulesPaginated({
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
});
