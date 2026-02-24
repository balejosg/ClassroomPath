import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Templates Router Tests
 *
 * The templates router provides SaaS-wide policy templates (copy-on-import).
 * Behavioral coverage should live in integration tests once UI flows depend on it.
 */
describe('Templates Router', () => {
  it('should export templatesRouter with expected procedures', async () => {
    const { templatesRouter } = await import('../src/trpc/routers/templates.js');

    assert.ok(templatesRouter, 'templatesRouter should be exported');
    assert.ok(templatesRouter._def, 'templatesRouter should be a valid tRPC router');

    const procedures = templatesRouter._def.procedures;
    assert.ok(procedures.list, 'should have list procedure');
    assert.ok(procedures.listRulesPaginated, 'should have listRulesPaginated procedure');
    assert.ok(procedures.publishFromGroup, 'should have publishFromGroup procedure');
    assert.ok(procedures.import, 'should have import procedure');
  });
});
