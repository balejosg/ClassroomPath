import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { DbSchedule } from '../src/services/schedules/schedule-write-shared.service.js';
import {
  presentOneOffSchedule,
  presentOneOffScheduleWithPermissions,
  presentWeeklySchedule,
  presentWeeklyScheduleWithPermissions,
  type ScheduleMetadataMaps,
} from '../src/services/schedules/schedule-presenter.js';

function buildWeeklySchedule(overrides: Partial<DbSchedule> = {}): DbSchedule {
  return {
    id: 'schedule-1',
    classroomId: 'classroom-1',
    teacherId: 'teacher-1',
    groupId: 'group-1',
    recurrence: 'weekly',
    dayOfWeek: 2,
    startTime: '10:00',
    endTime: '11:00',
    startAt: null,
    endAt: null,
    createdAt: new Date('2026-03-06T08:00:00.000Z'),
    updatedAt: new Date('2026-03-06T08:30:00.000Z'),
    ...overrides,
  };
}

function buildOneOffSchedule(overrides: Partial<DbSchedule> = {}): DbSchedule {
  return {
    id: 'schedule-2',
    classroomId: 'classroom-1',
    teacherId: 'teacher-2',
    groupId: 'group-2',
    recurrence: 'one_off',
    dayOfWeek: null,
    startTime: null,
    endTime: null,
    startAt: new Date('2026-03-06T10:00:00.000Z'),
    endAt: new Date('2026-03-06T11:00:00.000Z'),
    createdAt: new Date('2026-03-06T08:00:00.000Z'),
    updatedAt: new Date('2026-03-06T08:30:00.000Z'),
    ...overrides,
  };
}

const metadata: ScheduleMetadataMaps = {
  groupDisplayNamesById: new Map([
    ['group-1', 'Plan 1'],
    ['group-2', 'Plan 2'],
  ]),
  teacherNamesById: new Map([
    ['teacher-1', 'Teacher Uno'],
    ['teacher-2', 'Teacher Dos'],
  ]),
};

describe('schedule-presenter', () => {
  it('adds readable metadata to weekly schedules', () => {
    const row = buildWeeklySchedule();

    assert.deepStrictEqual(presentWeeklySchedule(row, metadata), {
      id: 'schedule-1',
      classroomId: 'classroom-1',
      dayOfWeek: 2,
      startTime: '10:00',
      endTime: '11:00',
      groupId: 'group-1',
      teacherId: 'teacher-1',
      recurrence: 'weekly',
      createdAt: '2026-03-06T08:00:00.000Z',
      updatedAt: '2026-03-06T08:30:00.000Z',
      groupDisplayName: 'Plan 1',
      teacherName: 'Teacher Uno',
    });
  });

  it('adds permission flags for classroom views', () => {
    const row = buildWeeklySchedule();

    assert.deepStrictEqual(
      presentWeeklyScheduleWithPermissions(row, metadata, {
        userId: 'teacher-1',
        admin: false,
      }),
      {
        id: 'schedule-1',
        classroomId: 'classroom-1',
        dayOfWeek: 2,
        startTime: '10:00',
        endTime: '11:00',
        groupId: 'group-1',
        teacherId: 'teacher-1',
        recurrence: 'weekly',
        createdAt: '2026-03-06T08:00:00.000Z',
        updatedAt: '2026-03-06T08:30:00.000Z',
        groupDisplayName: 'Plan 1',
        teacherName: 'Teacher Uno',
        isMine: true,
        canEdit: true,
      }
    );

    assert.deepStrictEqual(
      presentOneOffScheduleWithPermissions(buildOneOffSchedule(), metadata, {
        userId: 'teacher-1',
        admin: false,
      }),
      {
        id: 'schedule-2',
        classroomId: 'classroom-1',
        startAt: '2026-03-06T10:00:00.000Z',
        endAt: '2026-03-06T11:00:00.000Z',
        groupId: 'group-2',
        teacherId: 'teacher-2',
        recurrence: 'one_off',
        createdAt: '2026-03-06T08:00:00.000Z',
        updatedAt: '2026-03-06T08:30:00.000Z',
        groupDisplayName: 'Plan 2',
        teacherName: 'Teacher Dos',
        isMine: false,
        canEdit: false,
      }
    );
  });

  it('falls back to null names when metadata is missing', () => {
    const emptyMetadata: ScheduleMetadataMaps = {
      groupDisplayNamesById: new Map(),
      teacherNamesById: new Map(),
    };

    assert.deepStrictEqual(presentOneOffSchedule(buildOneOffSchedule(), emptyMetadata), {
      id: 'schedule-2',
      classroomId: 'classroom-1',
      startAt: '2026-03-06T10:00:00.000Z',
      endAt: '2026-03-06T11:00:00.000Z',
      groupId: 'group-2',
      teacherId: 'teacher-2',
      recurrence: 'one_off',
      createdAt: '2026-03-06T08:00:00.000Z',
      updatedAt: '2026-03-06T08:30:00.000Z',
      groupDisplayName: null,
      teacherName: null,
    });
  });
});
