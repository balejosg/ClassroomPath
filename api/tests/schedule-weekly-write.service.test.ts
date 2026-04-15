import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createWeeklyScheduleForTenant,
  updateWeeklyScheduleForTenant,
} from '../src/services/schedules/schedule-weekly-write.service.js';

void describe('schedule-weekly-write.service', () => {
  void test('exports the weekly schedule write use-cases', () => {
    assert.equal(typeof createWeeklyScheduleForTenant, 'function');
    assert.equal(typeof updateWeeklyScheduleForTenant, 'function');
  });
});
