import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getTeacherSchedulesForTenant } from '../src/services/schedules/schedule-teacher-read.service.js';

describe('schedule-teacher-read.service', () => {
  test('exports the teacher schedule reader', () => {
    assert.equal(typeof getTeacherSchedulesForTenant, 'function');
  });
});
