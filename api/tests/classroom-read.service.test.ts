import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getTenantClassroomById,
  listTenantClassrooms,
  presentTenantClassroom,
} from '../src/services/classrooms/classroom-read.service.js';

void describe('classroom-read.service', () => {
  void test('exports the classroom read use-cases', () => {
    assert.equal(typeof listTenantClassrooms, 'function');
    assert.equal(typeof getTenantClassroomById, 'function');
    assert.equal(typeof presentTenantClassroom, 'function');
  });
});
