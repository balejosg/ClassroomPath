import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_JWT_SECRET,
  isLocalDevelopment,
  isProduction,
  parseBooleanEnv,
  trimToNull,
} from '../src/config/shared.js';
import { GroupVisibility, calculateClassroomStatus } from '../src/openpath/shared.js';

void describe('shared modules', () => {
  void test('config shared helpers normalize env values', () => {
    assert.equal(parseBooleanEnv(' yes ', false), true);
    assert.equal(parseBooleanEnv('OFF', true), false);
    assert.equal(parseBooleanEnv('unknown', true), true);
    assert.equal(trimToNull('  value  '), 'value');
    assert.equal(trimToNull('   '), null);
    assert.equal(isProduction({ NODE_ENV: 'production' }), true);
    assert.equal(isLocalDevelopment({ NODE_ENV: undefined }), true);
    assert.equal(DEFAULT_JWT_SECRET.length > 0, true);
  });

  void test('openpath shared adapter re-exports the expected surface', () => {
    assert.ok(GroupVisibility);
    assert.equal(typeof calculateClassroomStatus, 'function');
  });
});
