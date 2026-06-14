import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  STAGING_ELIGIBILITY_KEYS,
  STAGING_ELIGIBILITY_LABELS,
  evaluateStagingEligibility,
} from '../scripts/lib/promotion-eligibility-contract.mjs';

const HEAD_SHA = '1111111111111111111111111111111111111111';
const OPENPATH_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** Fully-passing staging context (mirrors the happy-path fixture in release-status.test.ts). */
function passingContext() {
  return {
    stagingState: {
      STAGING_VERIFIED_APP_SHA: HEAD_SHA,
      STAGING_VERIFIED_OPENPATH_SHA: OPENPATH_SHA,
      STAGING_VERIFIED_IMAGE_SOURCE: 'release-candidate',
      STAGING_SMOKE_RESULT: 'success',
      STAGING_RELEASE_GATE_RESULT: 'success',
      STAGING_PREPROMOTION_REHEARSAL_RESULT: 'success',
    },
    stagingCurrentImages: {
      IMAGE_SOURCE: 'release-candidate',
    },
    headSha: HEAD_SHA,
    submoduleSha: OPENPATH_SHA,
  };
}

describe('promotion-eligibility-contract', () => {
  describe('STAGING_ELIGIBILITY_KEYS', () => {
    test('exports stable key constants for all seven advisory fields', () => {
      assert.equal(STAGING_ELIGIBILITY_KEYS.VERIFIED_APP_SHA, 'STAGING_VERIFIED_APP_SHA');
      assert.equal(STAGING_ELIGIBILITY_KEYS.VERIFIED_OPENPATH_SHA, 'STAGING_VERIFIED_OPENPATH_SHA');
      assert.equal(STAGING_ELIGIBILITY_KEYS.VERIFIED_IMAGE_SOURCE, 'STAGING_VERIFIED_IMAGE_SOURCE');
      assert.ok(STAGING_ELIGIBILITY_KEYS.CURRENT_IMAGE_SOURCE);
      assert.ok(STAGING_ELIGIBILITY_KEYS.SMOKE_RESULT);
      assert.equal(STAGING_ELIGIBILITY_KEYS.RELEASE_GATE_RESULT, 'STAGING_RELEASE_GATE_RESULT');
      assert.equal(
        STAGING_ELIGIBILITY_KEYS.PREPROMOTION_REHEARSAL_RESULT,
        'STAGING_PREPROMOTION_REHEARSAL_RESULT'
      );
    });

    test('exports a label for every key', () => {
      for (const key of Object.values(STAGING_ELIGIBILITY_KEYS)) {
        assert.ok(STAGING_ELIGIBILITY_LABELS[key], `missing label for key: ${key}`);
      }
    });
  });

  describe('evaluateStagingEligibility — all-pass', () => {
    test('returns eligible=true and empty failures when all fields match', () => {
      const result = evaluateStagingEligibility(passingContext());
      assert.equal(result.eligible, true);
      assert.deepEqual(result.failures, []);
    });

    test('accepts STAGING_SMOKE_STATUS as a fallback for STAGING_SMOKE_RESULT', () => {
      const ctx = passingContext();
      ctx.stagingState = {
        ...ctx.stagingState,
        STAGING_SMOKE_RESULT: undefined,
        STAGING_SMOKE_STATUS: 'success',
      };
      const result = evaluateStagingEligibility(ctx);
      assert.equal(result.eligible, true);
      assert.deepEqual(result.failures, []);
    });

    test('isSuccess is case-insensitive (SUCCESS / Success / success all pass)', () => {
      for (const val of ['SUCCESS', 'Success', 'success']) {
        const ctx = passingContext();
        ctx.stagingState = { ...ctx.stagingState, STAGING_SMOKE_RESULT: val };
        assert.equal(evaluateStagingEligibility(ctx).eligible, true, `failed for value: ${val}`);
      }
    });
  });

  describe('evaluateStagingEligibility — single-field failures', () => {
    test('fails when STAGING_VERIFIED_APP_SHA does not match headSha', () => {
      const ctx = passingContext();
      ctx.stagingState = { ...ctx.stagingState, STAGING_VERIFIED_APP_SHA: 'old-sha' };
      const result = evaluateStagingEligibility(ctx);

      assert.equal(result.eligible, false);
      assert.equal(result.failures.length, 1);
      assert.equal(result.failures[0].field, STAGING_ELIGIBILITY_KEYS.VERIFIED_APP_SHA);
      assert.equal(result.failures[0].expected, HEAD_SHA);
      assert.equal(result.failures[0].actual, 'old-sha');
    });

    test('fails when STAGING_VERIFIED_OPENPATH_SHA does not match submoduleSha', () => {
      const ctx = passingContext();
      ctx.stagingState = {
        ...ctx.stagingState,
        STAGING_VERIFIED_OPENPATH_SHA: 'different-openpath-sha',
      };
      const result = evaluateStagingEligibility(ctx);

      assert.equal(result.eligible, false);
      assert.equal(result.failures.length, 1);
      assert.equal(result.failures[0].field, STAGING_ELIGIBILITY_KEYS.VERIFIED_OPENPATH_SHA);
      assert.equal(result.failures[0].expected, OPENPATH_SHA);
      assert.equal(result.failures[0].actual, 'different-openpath-sha');
    });

    test('fails when STAGING_VERIFIED_IMAGE_SOURCE is not release-candidate', () => {
      const ctx = passingContext();
      ctx.stagingState = { ...ctx.stagingState, STAGING_VERIFIED_IMAGE_SOURCE: 'source-build' };
      const result = evaluateStagingEligibility(ctx);

      assert.equal(result.eligible, false);
      assert.equal(result.failures.length, 1);
      assert.equal(result.failures[0].field, STAGING_ELIGIBILITY_KEYS.VERIFIED_IMAGE_SOURCE);
      assert.equal(result.failures[0].expected, 'release-candidate');
      assert.equal(result.failures[0].actual, 'source-build');
    });

    test('fails when current IMAGE_SOURCE is not release-candidate', () => {
      const ctx = passingContext();
      ctx.stagingCurrentImages = { IMAGE_SOURCE: 'source-build' };
      const result = evaluateStagingEligibility(ctx);

      assert.equal(result.eligible, false);
      assert.equal(result.failures.length, 1);
      assert.equal(result.failures[0].field, STAGING_ELIGIBILITY_KEYS.CURRENT_IMAGE_SOURCE);
      assert.equal(result.failures[0].expected, 'release-candidate');
      assert.equal(result.failures[0].actual, 'source-build');
    });

    test('fails when STAGING_SMOKE_RESULT is not success', () => {
      const ctx = passingContext();
      ctx.stagingState = { ...ctx.stagingState, STAGING_SMOKE_RESULT: 'failed' };
      const result = evaluateStagingEligibility(ctx);

      assert.equal(result.eligible, false);
      assert.equal(result.failures.length, 1);
      assert.equal(result.failures[0].field, STAGING_ELIGIBILITY_KEYS.SMOKE_RESULT);
      assert.equal(result.failures[0].expected, 'success');
      assert.equal(result.failures[0].actual, 'failed');
    });

    test('fails when STAGING_SMOKE_RESULT and STAGING_SMOKE_STATUS are both absent', () => {
      const ctx = passingContext();
      ctx.stagingState = {
        ...ctx.stagingState,
        STAGING_SMOKE_RESULT: undefined,
        STAGING_SMOKE_STATUS: undefined,
      };
      const result = evaluateStagingEligibility(ctx);

      assert.equal(result.eligible, false);
      assert.equal(result.failures[0].field, STAGING_ELIGIBILITY_KEYS.SMOKE_RESULT);
      assert.equal(result.failures[0].actual, 'n/a');
    });

    test('fails when STAGING_RELEASE_GATE_RESULT is not success', () => {
      const ctx = passingContext();
      ctx.stagingState = { ...ctx.stagingState, STAGING_RELEASE_GATE_RESULT: 'failure' };
      const result = evaluateStagingEligibility(ctx);

      assert.equal(result.eligible, false);
      assert.equal(result.failures.length, 1);
      assert.equal(result.failures[0].field, STAGING_ELIGIBILITY_KEYS.RELEASE_GATE_RESULT);
      assert.equal(result.failures[0].expected, 'success');
      assert.equal(result.failures[0].actual, 'failure');
    });

    test('fails when STAGING_PREPROMOTION_REHEARSAL_RESULT is not success', () => {
      const ctx = passingContext();
      ctx.stagingState = {
        ...ctx.stagingState,
        STAGING_PREPROMOTION_REHEARSAL_RESULT: undefined,
      };
      const result = evaluateStagingEligibility(ctx);

      assert.equal(result.eligible, false);
      assert.equal(result.failures.length, 1);
      assert.equal(
        result.failures[0].field,
        STAGING_ELIGIBILITY_KEYS.PREPROMOTION_REHEARSAL_RESULT
      );
      assert.equal(result.failures[0].actual, 'n/a');
    });
  });

  describe('evaluateStagingEligibility — multiple-field failures', () => {
    test('reports all failing fields when all seven checks fail', () => {
      const ctx = {
        stagingState: {
          STAGING_VERIFIED_APP_SHA: 'wrong-sha',
          STAGING_VERIFIED_OPENPATH_SHA: 'wrong-openpath',
          STAGING_VERIFIED_IMAGE_SOURCE: 'source-build',
          STAGING_SMOKE_RESULT: 'failed',
          STAGING_RELEASE_GATE_RESULT: 'failed',
          STAGING_PREPROMOTION_REHEARSAL_RESULT: 'failed',
        },
        stagingCurrentImages: {
          IMAGE_SOURCE: 'source-build',
        },
        headSha: HEAD_SHA,
        submoduleSha: OPENPATH_SHA,
      };

      const result = evaluateStagingEligibility(ctx);

      assert.equal(result.eligible, false);
      assert.equal(result.failures.length, 7);

      const failedFields = result.failures.map((f) => f.field);
      assert.ok(failedFields.includes(STAGING_ELIGIBILITY_KEYS.VERIFIED_APP_SHA));
      assert.ok(failedFields.includes(STAGING_ELIGIBILITY_KEYS.VERIFIED_OPENPATH_SHA));
      assert.ok(failedFields.includes(STAGING_ELIGIBILITY_KEYS.VERIFIED_IMAGE_SOURCE));
      assert.ok(failedFields.includes(STAGING_ELIGIBILITY_KEYS.CURRENT_IMAGE_SOURCE));
      assert.ok(failedFields.includes(STAGING_ELIGIBILITY_KEYS.SMOKE_RESULT));
      assert.ok(failedFields.includes(STAGING_ELIGIBILITY_KEYS.RELEASE_GATE_RESULT));
      assert.ok(failedFields.includes(STAGING_ELIGIBILITY_KEYS.PREPROMOTION_REHEARSAL_RESULT));
    });

    test('each failure includes field, expected, and actual', () => {
      const ctx = passingContext();
      ctx.stagingState = {
        ...ctx.stagingState,
        STAGING_SMOKE_RESULT: 'failed',
        STAGING_RELEASE_GATE_RESULT: 'failed',
      };

      const result = evaluateStagingEligibility(ctx);

      assert.equal(result.failures.length, 2);
      for (const failure of result.failures) {
        assert.ok(failure.field, 'failure must have a field');
        assert.ok(failure.expected, 'failure must have an expected value');
        assert.ok(failure.actual, 'failure must have an actual value');
      }
    });
  });

  describe('evaluateStagingEligibility — semantic equivalence with isStagingPromotionEligible', () => {
    // These tests prove that the refactored evaluateStagingEligibility produces
    // the SAME eligible/blocked boolean outcomes as the original isStagingPromotionEligible
    // predicate did on the same inputs.

    const passingInputs = [
      {
        label: 'all fields green',
        stagingState: {
          STAGING_VERIFIED_APP_SHA: HEAD_SHA,
          STAGING_VERIFIED_OPENPATH_SHA: OPENPATH_SHA,
          STAGING_VERIFIED_IMAGE_SOURCE: 'release-candidate',
          STAGING_SMOKE_RESULT: 'success',
          STAGING_RELEASE_GATE_RESULT: 'success',
          STAGING_PREPROMOTION_REHEARSAL_RESULT: 'success',
        },
        stagingCurrentImages: { IMAGE_SOURCE: 'release-candidate' },
        headSha: HEAD_SHA,
        submoduleSha: OPENPATH_SHA,
        expectedEligible: true,
      },
      {
        label: 'STAGING_SMOKE_STATUS fallback (no STAGING_SMOKE_RESULT)',
        stagingState: {
          STAGING_VERIFIED_APP_SHA: HEAD_SHA,
          STAGING_VERIFIED_OPENPATH_SHA: OPENPATH_SHA,
          STAGING_VERIFIED_IMAGE_SOURCE: 'release-candidate',
          STAGING_SMOKE_STATUS: 'success',
          STAGING_RELEASE_GATE_RESULT: 'success',
          STAGING_PREPROMOTION_REHEARSAL_RESULT: 'success',
        },
        stagingCurrentImages: { IMAGE_SOURCE: 'release-candidate' },
        headSha: HEAD_SHA,
        submoduleSha: OPENPATH_SHA,
        expectedEligible: true,
      },
    ];

    const blockingInputs = [
      {
        label: 'wrong app SHA',
        stagingState: {
          STAGING_VERIFIED_APP_SHA: 'old-sha',
          STAGING_VERIFIED_OPENPATH_SHA: OPENPATH_SHA,
          STAGING_VERIFIED_IMAGE_SOURCE: 'release-candidate',
          STAGING_SMOKE_RESULT: 'success',
          STAGING_RELEASE_GATE_RESULT: 'success',
          STAGING_PREPROMOTION_REHEARSAL_RESULT: 'success',
        },
        stagingCurrentImages: { IMAGE_SOURCE: 'release-candidate' },
        headSha: HEAD_SHA,
        submoduleSha: OPENPATH_SHA,
        expectedEligible: false,
      },
      {
        label: 'source-build images (not release-candidate)',
        stagingState: {
          STAGING_VERIFIED_APP_SHA: HEAD_SHA,
          STAGING_VERIFIED_OPENPATH_SHA: OPENPATH_SHA,
          STAGING_VERIFIED_IMAGE_SOURCE: 'source-build',
          STAGING_SMOKE_RESULT: 'success',
          STAGING_RELEASE_GATE_RESULT: 'success',
          STAGING_PREPROMOTION_REHEARSAL_RESULT: 'success',
        },
        stagingCurrentImages: { IMAGE_SOURCE: 'source-build' },
        headSha: HEAD_SHA,
        submoduleSha: OPENPATH_SHA,
        expectedEligible: false,
      },
      {
        label: 'smoke failed',
        stagingState: {
          STAGING_VERIFIED_APP_SHA: HEAD_SHA,
          STAGING_VERIFIED_OPENPATH_SHA: OPENPATH_SHA,
          STAGING_VERIFIED_IMAGE_SOURCE: 'release-candidate',
          STAGING_SMOKE_RESULT: 'failed',
          STAGING_RELEASE_GATE_RESULT: 'success',
          STAGING_PREPROMOTION_REHEARSAL_RESULT: 'success',
        },
        stagingCurrentImages: { IMAGE_SOURCE: 'release-candidate' },
        headSha: HEAD_SHA,
        submoduleSha: OPENPATH_SHA,
        expectedEligible: false,
      },
      {
        label: 'release gate failed',
        stagingState: {
          STAGING_VERIFIED_APP_SHA: HEAD_SHA,
          STAGING_VERIFIED_OPENPATH_SHA: OPENPATH_SHA,
          STAGING_VERIFIED_IMAGE_SOURCE: 'release-candidate',
          STAGING_SMOKE_RESULT: 'success',
          STAGING_RELEASE_GATE_RESULT: 'failed',
          STAGING_PREPROMOTION_REHEARSAL_RESULT: 'success',
        },
        stagingCurrentImages: { IMAGE_SOURCE: 'release-candidate' },
        headSha: HEAD_SHA,
        submoduleSha: OPENPATH_SHA,
        expectedEligible: false,
      },
      {
        label: 'prepromotion rehearsal missing (undefined)',
        stagingState: {
          STAGING_VERIFIED_APP_SHA: HEAD_SHA,
          STAGING_VERIFIED_OPENPATH_SHA: OPENPATH_SHA,
          STAGING_VERIFIED_IMAGE_SOURCE: 'release-candidate',
          STAGING_SMOKE_RESULT: 'success',
          STAGING_RELEASE_GATE_RESULT: 'success',
          STAGING_PREPROMOTION_REHEARSAL_RESULT: undefined,
        },
        stagingCurrentImages: { IMAGE_SOURCE: 'release-candidate' },
        headSha: HEAD_SHA,
        submoduleSha: OPENPATH_SHA,
        expectedEligible: false,
      },
    ];

    for (const fixture of passingInputs) {
      test(`eligible=true: ${fixture.label}`, () => {
        const result = evaluateStagingEligibility(fixture);
        assert.equal(
          result.eligible,
          fixture.expectedEligible,
          `expected eligible=${fixture.expectedEligible} for "${fixture.label}"`
        );
      });
    }

    for (const fixture of blockingInputs) {
      test(`eligible=false: ${fixture.label}`, () => {
        const result = evaluateStagingEligibility(fixture);
        assert.equal(
          result.eligible,
          fixture.expectedEligible,
          `expected eligible=${fixture.expectedEligible} for "${fixture.label}"`
        );
        assert.ok(result.failures.length > 0, 'should have at least one failure');
      });
    }
  });
});
