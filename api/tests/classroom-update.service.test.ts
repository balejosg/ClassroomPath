import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  setActiveGroupForTenant,
  updateClassroomForTenant,
} from '../src/services/classrooms/classroom-update.service.js';

void describe('classroom-update.service', () => {
  void test('exports the classroom update use-cases', () => {
    assert.equal(typeof updateClassroomForTenant, 'function');
    assert.equal(typeof setActiveGroupForTenant, 'function');
  });
});
