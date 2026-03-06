import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  getScheduleClock,
  normalizeTimeHHMM,
  parseTimeToMinutes,
} from '../src/services/schedules/schedule-time.js';

describe('schedule-time', () => {
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

  describe('getScheduleClock', () => {
    it('returns weekday and HH:MM string', () => {
      const { dayOfWeek, timeHHMM } = getScheduleClock(new Date('2025-01-01T10:05:30.500Z'));

      assert.ok(Number.isInteger(dayOfWeek));
      assert.ok(dayOfWeek >= 0 && dayOfWeek <= 6);
      assert.ok(/^\d{2}:\d{2}$/.test(timeHHMM));
    });
  });
});
