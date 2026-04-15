import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { deleteClassroomForTenant } from '../src/services/classrooms/classroom-delete.service.js';

void describe('classroom-delete.service', () => {
  void test('exports the classroom delete use-case', () => {
    assert.equal(typeof deleteClassroomForTenant, 'function');
  });
});
