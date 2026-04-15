import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  presentClassroomBase,
  presentClassroomListItem,
  toPublicClassroomName,
} from '../src/services/classrooms/classroom-list-presenter.js';

void describe('classroom-list-presenter', () => {
  void test('exports the classroom list presentation helpers', () => {
    assert.equal(typeof toPublicClassroomName, 'function');
    assert.equal(typeof presentClassroomBase, 'function');
    assert.equal(typeof presentClassroomListItem, 'function');
  });
});
