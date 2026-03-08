import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OpenPathMeResponseSchema,
  OpenPathRoleInfoSchema,
} from '../src/lib/openpath-auth-schema.js';

describe('openpath-auth-schema', () => {
  it('defaults missing role groupIds to an empty array', () => {
    const parsed = OpenPathRoleInfoSchema.parse({
      role: 'admin',
    });

    assert.deepStrictEqual(parsed, {
      role: 'admin',
      groupIds: [],
    });
  });

  it('parses auth.me payloads and defaults missing roles to an empty array', () => {
    const parsed = OpenPathMeResponseSchema.parse({
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User Example',
      },
    });

    assert.deepStrictEqual(parsed, {
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User Example',
        roles: [],
      },
    });
  });

  it('rejects malformed auth.me payloads', () => {
    const result = OpenPathMeResponseSchema.safeParse({
      user: {
        id: 'user-1',
        name: 'User Example',
      },
    });

    assert.equal(result.success, false);
  });
});
