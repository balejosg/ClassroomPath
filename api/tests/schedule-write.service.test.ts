import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createOneOffScheduleForTenant,
  createWeeklyScheduleForTenant,
  deleteScheduleForTenant,
  updateOneOffScheduleForTenant,
  updateWeeklyScheduleForTenant,
} from '../src/services/schedules/schedule-write.service.js';

describe('schedule-write.service', () => {
  it('re-exports the schedule write use-cases', () => {
    assert.equal(typeof createWeeklyScheduleForTenant, 'function');
    assert.equal(typeof updateWeeklyScheduleForTenant, 'function');
    assert.equal(typeof createOneOffScheduleForTenant, 'function');
    assert.equal(typeof updateOneOffScheduleForTenant, 'function');
    assert.equal(typeof deleteScheduleForTenant, 'function');
  });
});
