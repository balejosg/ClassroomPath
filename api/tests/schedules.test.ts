import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Schedules Router Tests
 *
 * The /cp/trpc schedules router enforces tenant scoping and role rules.
 * Behavioral coverage lives in integration tests.
 */
describe('Schedules Router', () => {
  it('should export schedulesRouter with expected procedures', async () => {
    const { schedulesRouter } = await import('../src/trpc/routers/schedules.js');

    assert.ok(schedulesRouter, 'schedulesRouter should be exported');
    assert.ok(schedulesRouter._def, 'schedulesRouter should be a valid tRPC router');

    const procedures = schedulesRouter._def.procedures;
    assert.ok(procedures.getMine, 'should have getMine procedure');
    assert.ok(procedures.getByClassroom, 'should have getByClassroom procedure');
    assert.ok(procedures.create, 'should have create procedure');
    assert.ok(procedures.createOneOff, 'should have createOneOff procedure');
    assert.ok(procedures.update, 'should have update procedure');
    assert.ok(procedures.updateOneOff, 'should have updateOneOff procedure');
    assert.ok(procedures.delete, 'should have delete procedure');
  });
});
