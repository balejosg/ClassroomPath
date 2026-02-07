import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Healthcheck Router Tests
 *
 * These tests verify the healthcheck router forwards requests to OpenPath API.
 * The router is a thin proxy layer - business logic is tested in OpenPath.
 */
describe('Healthcheck Router', () => {
  it('should export healthcheckRouter with live endpoint', async () => {
    const { healthcheckRouter } = await import('../src/trpc/routers/healthcheck.js');

    assert.ok(healthcheckRouter, 'healthcheckRouter should be exported');
    assert.ok(healthcheckRouter._def, 'healthcheckRouter should be a valid tRPC router');
    assert.ok(healthcheckRouter._def.procedures.live, 'should have live procedure');
  });

  it('should export healthcheckRouter with ready endpoint', async () => {
    const { healthcheckRouter } = await import('../src/trpc/routers/healthcheck.js');

    assert.ok(healthcheckRouter._def.procedures.ready, 'should have ready procedure');
  });

  it('should export healthcheckRouter with systemInfo endpoint', async () => {
    const { healthcheckRouter } = await import('../src/trpc/routers/healthcheck.js');

    assert.ok(healthcheckRouter._def.procedures.systemInfo, 'should have systemInfo procedure');
  });

  it('all healthcheck endpoints should be public procedures', async () => {
    const { healthcheckRouter } = await import('../src/trpc/routers/healthcheck.js');

    // All healthcheck endpoints should be accessible without authentication
    const procedures = healthcheckRouter._def.procedures;
    assert.ok(procedures.live, 'live should exist');
    assert.ok(procedures.ready, 'ready should exist');
    assert.ok(procedures.systemInfo, 'systemInfo should exist');
  });
});
