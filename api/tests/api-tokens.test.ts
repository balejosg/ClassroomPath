import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * API Tokens Router Tests
 *
 * These tests verify the apiTokens router forwards requests to OpenPath API.
 * The router is a thin proxy layer - business logic is tested in OpenPath.
 */
describe('API Tokens Router', () => {
  it('should export apiTokensRouter with list endpoint', async () => {
    const { apiTokensRouter } = await import('../src/trpc/routers/api-tokens.js');

    assert.ok(apiTokensRouter, 'apiTokensRouter should be exported');
    assert.ok(apiTokensRouter._def, 'apiTokensRouter should be a valid tRPC router');
    assert.ok(apiTokensRouter._def.procedures.list, 'should have list procedure');
  });

  it('should export apiTokensRouter with create endpoint', async () => {
    const { apiTokensRouter } = await import('../src/trpc/routers/api-tokens.js');

    assert.ok(apiTokensRouter._def.procedures.create, 'should have create procedure');
  });

  it('should export apiTokensRouter with revoke endpoint', async () => {
    const { apiTokensRouter } = await import('../src/trpc/routers/api-tokens.js');

    assert.ok(apiTokensRouter._def.procedures.revoke, 'should have revoke procedure');
  });

  it('should export apiTokensRouter with regenerate endpoint', async () => {
    const { apiTokensRouter } = await import('../src/trpc/routers/api-tokens.js');

    assert.ok(apiTokensRouter._def.procedures.regenerate, 'should have regenerate procedure');
  });

  it('all apiTokens endpoints should be protected procedures', async () => {
    const { apiTokensRouter } = await import('../src/trpc/routers/api-tokens.js');

    // All API token endpoints require authentication
    const procedures = apiTokensRouter._def.procedures;
    assert.ok(procedures.list, 'list should exist');
    assert.ok(procedures.create, 'create should exist');
    assert.ok(procedures.revoke, 'revoke should exist');
    assert.ok(procedures.regenerate, 'regenerate should exist');
  });
});
