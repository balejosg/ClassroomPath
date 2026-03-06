import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TRPCError } from '@trpc/server';

import {
  assertCanManageSchedule,
  assertQuarterHour,
  assertQuarterHourInstant,
  parseIsoDate,
} from '../src/services/schedules/schedule-write.service.js';

describe('schedule-write.service', () => {
  it('accepts quarter-hour times and rejects invalid minute increments', () => {
    assert.doesNotThrow(() => assertQuarterHour('10:30', 'startTime'));

    assert.throws(
      () => assertQuarterHour('10:07', 'startTime'),
      (error) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'BAD_REQUEST');
        assert.strictEqual(error.message, 'startTime must be in 15-minute increments');
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

  it('rejects instants with seconds or non-quarter-minute values', () => {
    assert.doesNotThrow(() =>
      assertQuarterHourInstant(new Date('2026-03-06T10:30:00.000Z'), 'startAt')
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
        assert.strictEqual(error.message, 'startAt must be in 15-minute increments');
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
});
