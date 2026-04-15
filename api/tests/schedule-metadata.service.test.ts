import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DbSchedule } from '../src/services/schedules/schedule-write-shared.service.js';
import { collectScheduleMetadataIds } from '../src/services/schedules/schedule-metadata.service.js';

describe('schedule-metadata.service', () => {
  test('collects group and teacher ids from schedule rows', () => {
    const rows: DbSchedule[] = [
      {
        id: 'schedule-1',
        classroomId: 'classroom-1',
        teacherId: 'teacher-1',
        groupId: 'group-1',
        recurrence: 'weekly',
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:00',
        startAt: null,
        endAt: null,
        createdAt: new Date('2026-03-06T08:00:00.000Z'),
        updatedAt: new Date('2026-03-06T08:30:00.000Z'),
      },
      {
        id: 'schedule-2',
        classroomId: 'classroom-1',
        teacherId: 'teacher-2',
        groupId: 'group-2',
        recurrence: 'one_off',
        dayOfWeek: null,
        startTime: null,
        endTime: null,
        startAt: new Date('2026-03-07T08:00:00.000Z'),
        endAt: new Date('2026-03-07T09:00:00.000Z'),
        createdAt: new Date('2026-03-06T08:00:00.000Z'),
        updatedAt: new Date('2026-03-06T08:30:00.000Z'),
      },
    ];

    assert.deepEqual(collectScheduleMetadataIds(rows), {
      groupIds: ['group-1', 'group-2'],
      teacherIds: ['teacher-1', 'teacher-2'],
    });
  });
});
