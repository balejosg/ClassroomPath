import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildScheduleViewerPermissions } from '../src/services/schedules/schedule-permission-presenter.js';

describe('schedule-permission-presenter', () => {
  test('marks schedules as editable when the viewer is the owner', () => {
    assert.deepEqual(
      buildScheduleViewerPermissions({
        teacherId: 'teacher-1',
        viewer: { userId: 'teacher-1', admin: false },
      }),
      { isMine: true, canEdit: true }
    );
  });

  test('marks schedules as editable for admins even when they are not the owner', () => {
    assert.deepEqual(
      buildScheduleViewerPermissions({
        teacherId: 'teacher-2',
        viewer: { userId: 'admin-1', admin: true },
      }),
      { isMine: false, canEdit: true }
    );
  });
});
