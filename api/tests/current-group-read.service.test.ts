import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  getCurrentOneOffScheduleGroupId,
  getCurrentScheduleGroupByClassroomId,
  getCurrentScheduleGroupId,
  getCurrentWeeklyScheduleGroupId,
} from '../src/services/schedules/current-group-read.service.js';

void describe('current-group-read.service', () => {
  void test('exports the active schedule group lookup helpers', () => {
    assert.equal(typeof getCurrentWeeklyScheduleGroupId, 'function');
    assert.equal(typeof getCurrentOneOffScheduleGroupId, 'function');
    assert.equal(typeof getCurrentScheduleGroupId, 'function');
    assert.equal(typeof getCurrentScheduleGroupByClassroomId, 'function');
  });
});
