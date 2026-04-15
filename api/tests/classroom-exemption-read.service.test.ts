import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { listActiveClassroomExemptions } from '../src/services/classrooms/classroom-exemption-read.service.js';

void describe('classroom-exemption-read.service', () => {
  void test('exports the classroom exemption read use-case', () => {
    assert.equal(typeof listActiveClassroomExemptions, 'function');
  });
});
