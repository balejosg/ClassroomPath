import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getClassroomSchedulesForTenant } from '../src/services/schedules/schedule-classroom-read.service.js';

describe('schedule-classroom-read.service', () => {
  test('exports the classroom schedule reader', () => {
    assert.equal(typeof getClassroomSchedulesForTenant, 'function');
  });
});
