import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listTenantClassroomMachines,
  presentClassroomMachineSummary,
} from '../src/services/classrooms/classroom-machine-access.service.js';

void describe('classroom-machine-access.service', () => {
  void test('exports the classroom machine access use-cases', () => {
    assert.equal(typeof listTenantClassroomMachines, 'function');
    assert.equal(typeof presentClassroomMachineSummary, 'function');
  });
});
