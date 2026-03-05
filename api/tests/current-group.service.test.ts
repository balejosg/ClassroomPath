import { describe, it } from 'node:test';
import assert from 'node:assert';

import { TRPCError } from '@trpc/server';

import {
  calculateWeeklyScheduleExpiresAt,
  normalizeTimeHHMM,
  parseTimeToMinutes,
} from '../src/services/current-group.service.js';

describe('current-group.service', () => {
  describe('normalizeTimeHHMM', () => {
    it('keeps HH:MM unchanged', () => {
      assert.strictEqual(normalizeTimeHHMM('09:30'), '09:30');
    });

    it('trims seconds from HH:MM:SS', () => {
      assert.strictEqual(normalizeTimeHHMM('09:30:00'), '09:30');
    });

    it('stringifies null input', () => {
      assert.strictEqual(normalizeTimeHHMM(null), 'null');
    });
  });

  describe('parseTimeToMinutes', () => {
    it('parses valid HH:MM', () => {
      assert.strictEqual(parseTimeToMinutes('00:00'), 0);
      assert.strictEqual(parseTimeToMinutes('10:15'), 615);
      assert.strictEqual(parseTimeToMinutes('23:59'), 23 * 60 + 59);
    });

    it('returns NaN for invalid input', () => {
      assert.ok(Number.isNaN(parseTimeToMinutes('not-a-time')));
    });
  });

  describe('calculateWeeklyScheduleExpiresAt', () => {
    it('returns schedule end aligned to minute boundary', () => {
      const now = new Date('2025-01-01T10:05:30.500Z');

      const expiresAt = calculateWeeklyScheduleExpiresAt({
        now,
        nowTimeHHMM: '10:05',
        endTime: '10:15:00',
      });

      assert.strictEqual(expiresAt.toISOString(), '2025-01-01T10:15:00.000Z');
    });

    it('throws BAD_REQUEST when endTime is not after nowTime', () => {
      const now = new Date('2025-01-01T10:05:30.500Z');

      assert.throws(
        () =>
          calculateWeeklyScheduleExpiresAt({
            now,
            nowTimeHHMM: '10:05',
            endTime: '10:05:00',
          }),
        (err: unknown) => {
          assert.ok(err instanceof TRPCError);
          assert.strictEqual(err.code, 'BAD_REQUEST');
          assert.strictEqual(err.message, 'Invalid schedule end time');
          return true;
        }
      );
    });
  });
});
