import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TRPCError } from '@trpc/server';

import {
  assertCanManageSchedule,
  assertQuarterHour,
  assertQuarterHourInstant,
  mapToOneOffScheduleBase,
  mapToWeeklyScheduleBase,
  parseIsoDate,
} from '../src/services/schedules/schedule-write-shared.service.js';

describe('schedule-write-shared.service', () => {
  it('accepts 5-minute-step times and rejects invalid minute increments', () => {
    assert.doesNotThrow(() => assertQuarterHour('10:30', 'startTime'));
    assert.doesNotThrow(() => assertQuarterHour('10:20', 'startTime'));
    assert.doesNotThrow(() => assertQuarterHour('10:35', 'startTime'));

    assert.throws(
      () => assertQuarterHour('10:07', 'startTime'),
      (error) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'BAD_REQUEST');
        assert.strictEqual(error.message, 'startTime must be in 5-minute increments');
        return true;
      }
    );
  });

  it('parses ISO instants and rejects invalid dates', () => {
    const parsed = parseIsoDate('2026-03-06T10:30:00.000Z', 'startAt');
    assert.strictEqual(parsed.toISOString(), '2026-03-06T10:30:00.000Z');

    assert.throws(
      () => parseIsoDate('not-a-date', 'startAt'),
      (error) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'BAD_REQUEST');
        assert.strictEqual(error.message, 'startAt must be a valid date');
        return true;
      }
    );
  });

  it('rejects instants with seconds or non-5-minute values', () => {
    assert.doesNotThrow(() =>
      assertQuarterHourInstant(new Date('2026-03-06T10:30:00.000Z'), 'startAt')
    );
    assert.doesNotThrow(() =>
      assertQuarterHourInstant(new Date('2026-03-06T10:20:00.000Z'), 'startAt')
    );

    assert.throws(
      () => assertQuarterHourInstant(new Date('2026-03-06T10:30:15.000Z'), 'startAt'),
      (error) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'BAD_REQUEST');
        assert.strictEqual(error.message, 'startAt must not include seconds');
        return true;
      }
    );

    assert.throws(
      () => assertQuarterHourInstant(new Date('2026-03-06T10:22:00.000Z'), 'startAt'),
      (error) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'BAD_REQUEST');
        assert.strictEqual(error.message, 'startAt must be in 5-minute increments');
        return true;
      }
    );
  });

  it('allows owners/admins to manage schedules and blocks other teachers', () => {
    const schedule = {
      id: 'schedule-1',
      classroomId: 'classroom-1',
      teacherId: 'teacher-a',
      groupId: 'group-1',
      recurrence: 'weekly',
      dayOfWeek: 1,
      startTime: '10:00',
      endTime: '11:00',
      startAt: null,
      endAt: null,
      createdAt: new Date('2026-03-06T10:00:00.000Z'),
      updatedAt: new Date('2026-03-06T10:00:00.000Z'),
    };

    assert.doesNotThrow(() =>
      assertCanManageSchedule(
        { organizationId: 'org-1', userRole: 'teacher', user: { sub: 'teacher-a' } },
        schedule
      )
    );

    assert.doesNotThrow(() =>
      assertCanManageSchedule(
        { organizationId: 'org-1', userRole: 'admin', user: { sub: 'admin-1' } },
        schedule
      )
    );

    assert.throws(
      () =>
        assertCanManageSchedule(
          { organizationId: 'org-1', userRole: 'teacher', user: { sub: 'teacher-b' } },
          schedule
        ),
      (error) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'FORBIDDEN');
        assert.strictEqual(error.message, 'You can only manage your own schedules');
        return true;
      }
    );
  });

  it('maps weekly and one-off rows into public shapes', () => {
    const weekly = {
      id: 'schedule-weekly',
      classroomId: 'classroom-1',
      teacherId: 'teacher-1',
      groupId: 'group-1',
      recurrence: 'weekly',
      dayOfWeek: 2,
      startTime: '10:00:00',
      endTime: '11:15:00',
      startAt: null,
      endAt: null,
      createdAt: new Date('2026-03-06T08:00:00.000Z'),
      updatedAt: new Date('2026-03-06T08:30:00.000Z'),
    };
    const oneOff = {
      ...weekly,
      id: 'schedule-one-off',
      recurrence: 'one_off',
      dayOfWeek: null,
      startTime: null,
      endTime: null,
      startAt: new Date('2026-03-06T10:00:00.000Z'),
      endAt: new Date('2026-03-06T11:00:00.000Z'),
    };

    assert.deepStrictEqual(mapToWeeklyScheduleBase(weekly), {
      id: 'schedule-weekly',
      classroomId: 'classroom-1',
      dayOfWeek: 2,
      startTime: '10:00',
      endTime: '11:15',
      groupId: 'group-1',
      teacherId: 'teacher-1',
      recurrence: 'weekly',
      createdAt: '2026-03-06T08:00:00.000Z',
      updatedAt: '2026-03-06T08:30:00.000Z',
    });

    assert.deepStrictEqual(mapToOneOffScheduleBase(oneOff), {
      id: 'schedule-one-off',
      classroomId: 'classroom-1',
      startAt: '2026-03-06T10:00:00.000Z',
      endAt: '2026-03-06T11:00:00.000Z',
      groupId: 'group-1',
      teacherId: 'teacher-1',
      recurrence: 'one_off',
      createdAt: '2026-03-06T08:00:00.000Z',
      updatedAt: '2026-03-06T08:30:00.000Z',
    });
  });
});
