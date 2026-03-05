import { describe, it } from 'node:test';
import assert from 'node:assert';

import { TRPCError } from '@trpc/server';

import { calculateWeeklyScheduleExpiresAt } from '../src/services/current-group.service.js';

describe('current-group.service', () => {
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
