import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createClassroomForTenant } from '../src/services/classrooms/classroom-create.service.js';

void describe('classroom-create.service', () => {
  void test('exports the classroom create use-case', () => {
    assert.equal(typeof createClassroomForTenant, 'function');
  });
});
