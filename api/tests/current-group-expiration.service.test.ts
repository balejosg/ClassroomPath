import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  calculateWeeklyScheduleExpiresAt,
  resolveActiveScheduleExpiresAt,
} from '../src/services/schedules/current-group-expiration.service.js';

void describe('current-group-expiration.service', () => {
  void test('exports the active schedule expiration helpers', () => {
    assert.equal(typeof calculateWeeklyScheduleExpiresAt, 'function');
    assert.equal(typeof resolveActiveScheduleExpiresAt, 'function');
  });
});
