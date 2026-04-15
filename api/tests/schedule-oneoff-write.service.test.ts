import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createOneOffScheduleForTenant,
  updateOneOffScheduleForTenant,
} from '../src/services/schedules/schedule-oneoff-write.service.js';

void describe('schedule-oneoff-write.service', () => {
  void test('exports the one-off schedule write use-cases', () => {
    assert.equal(typeof createOneOffScheduleForTenant, 'function');
    assert.equal(typeof updateOneOffScheduleForTenant, 'function');
  });
});
