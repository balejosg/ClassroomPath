import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  groupMachinesByClassroomIdForList,
  presentMachineForClassroomList,
} from '../src/services/classrooms/classroom-machine-presenter.js';

void describe('classroom-machine-presenter', () => {
  void test('exports the machine presentation helpers', () => {
    assert.equal(typeof presentMachineForClassroomList, 'function');
    assert.equal(typeof groupMachinesByClassroomIdForList, 'function');
  });
});
