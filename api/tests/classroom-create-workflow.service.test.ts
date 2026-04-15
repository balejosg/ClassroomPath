import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { runCreateClassroomWorkflow } from '../src/services/classrooms/classroom-create-workflow.service.js';

describe('classroom-create-workflow.service', () => {
  test('exports the classroom create workflow helper', () => {
    assert.equal(typeof runCreateClassroomWorkflow, 'function');
  });
});
