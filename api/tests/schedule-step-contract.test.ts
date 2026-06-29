import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TRPCError } from '@trpc/server';

// Source of truth lives in OpenPath (vendored via upstream/openpath as
// @openpath/shared). This contract test guards that the wrapper's local
// schedule-time step never drifts from upstream. If OpenPath changes the step
// and the submodule is bumped without updating the wrapper copy, this fails.
import { SCHEDULE_TIME_STEP_MINUTES as OPENPATH_STEP } from '@openpath/shared';
import {
  SCHEDULE_TIME_STEP_MINUTES as WRAPPER_STEP,
  assertQuarterHour,
} from '../src/services/schedules/schedule-write-shared.service.js';

describe('schedule time-step cross-repo contract', () => {
  it('keeps the wrapper step in sync with OpenPath', () => {
    assert.strictEqual(WRAPPER_STEP, OPENPATH_STEP);
  });

  it('accepts times on the 5-minute step and rejects others', () => {
    assert.strictEqual(WRAPPER_STEP, 5);

    assert.doesNotThrow(() => assertQuarterHour('07:05', 'startTime'));
    assert.doesNotThrow(() => assertQuarterHour('10:20', 'startTime'));
    assert.doesNotThrow(() => assertQuarterHour('14:35', 'startTime'));

    assert.throws(
      () => assertQuarterHour('10:03', 'startTime'),
      (error) => {
        assert.ok(error instanceof TRPCError);
        assert.strictEqual(error.code, 'BAD_REQUEST');
        return true;
      }
    );
  });
});
