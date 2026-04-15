import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { deleteScheduleForTenant } from '../src/services/schedules/schedule-delete.service.js';

void describe('schedule-delete.service', () => {
  void test('exports the schedule delete use-case', () => {
    assert.equal(typeof deleteScheduleForTenant, 'function');
  });
});
