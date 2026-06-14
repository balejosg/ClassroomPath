// @ts-check

/**
 * Canonical contract for the advisory staging-promotion-eligibility gate.
 *
 * This module is PURE (no I/O, no side effects). It defines:
 *   - The ordered list of fields that constitute the advisory gate.
 *   - Stable key/label constants shared by both the advisory path
 *     (release-status-evaluator.mjs) and the authoritative live path
 *     (release-evidence-snapshot.mjs) for consistent error messaging.
 *   - `evaluateStagingEligibility`, which returns the same boolean outcome
 *     as the previous `isStagingPromotionEligible` implementation but also
 *     surfaces the failing fields with expected/actual values.
 *
 * IMPORTANT: The authoritative live gate (`evaluatePromotionEligibility` in
 * release-evidence-snapshot.mjs) checks a STRICTLY BROADER set of conditions
 * (deployment mode, runtime image digests, enrollment downloads, signed Firefox,
 * high-risk Windows/Firefox evidence). Routing the live path through
 * `evaluateStagingEligibility` would silently DROP those checks, so the live
 * path retains its own evaluation logic and only imports KEY/LABEL constants
 * from this module for consistent messaging.
 *
 * Invoked by: release-status-evaluator.mjs (advisory) and
 *   release-evidence-snapshot.mjs (label constants only).
 * Usage: (library module, not invoked directly)
 * Tested by tests/promotion-eligibility-contract.test.ts.
 */

/** @param {unknown} value */
function isSuccess(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'success'
  );
}

/**
 * Stable field keys used by both the advisory and authoritative gates.
 * Importing these constants keeps error messages consistent across both paths.
 */
export const STAGING_ELIGIBILITY_KEYS = Object.freeze({
  VERIFIED_APP_SHA: 'STAGING_VERIFIED_APP_SHA',
  VERIFIED_OPENPATH_SHA: 'STAGING_VERIFIED_OPENPATH_SHA',
  VERIFIED_IMAGE_SOURCE: 'STAGING_VERIFIED_IMAGE_SOURCE',
  CURRENT_IMAGE_SOURCE: 'IMAGE_SOURCE (current images)',
  SMOKE_RESULT: 'STAGING_SMOKE_RESULT / STAGING_SMOKE_STATUS',
  RELEASE_GATE_RESULT: 'STAGING_RELEASE_GATE_RESULT',
  PREPROMOTION_REHEARSAL_RESULT: 'STAGING_PREPROMOTION_REHEARSAL_RESULT',
});

/**
 * Human labels for each field, used in blocker messages.
 */
export const STAGING_ELIGIBILITY_LABELS = Object.freeze({
  [STAGING_ELIGIBILITY_KEYS.VERIFIED_APP_SHA]: 'staging verified app SHA',
  [STAGING_ELIGIBILITY_KEYS.VERIFIED_OPENPATH_SHA]: 'staging verified OpenPath SHA',
  [STAGING_ELIGIBILITY_KEYS.VERIFIED_IMAGE_SOURCE]: 'staging verified image source',
  [STAGING_ELIGIBILITY_KEYS.CURRENT_IMAGE_SOURCE]: 'current staging image source',
  [STAGING_ELIGIBILITY_KEYS.SMOKE_RESULT]: 'staging smoke result',
  [STAGING_ELIGIBILITY_KEYS.RELEASE_GATE_RESULT]: 'staging release gate result',
  [STAGING_ELIGIBILITY_KEYS.PREPROMOTION_REHEARSAL_RESULT]: 'staging prepromotion rehearsal result',
});

/**
 * @typedef {{
 *   stagingState: Record<string, string | undefined | null>;
 *   stagingCurrentImages: Record<string, string | undefined | null>;
 *   headSha: string;
 *   submoduleSha: string;
 * }} StagingEligibilityContext
 *
 * @typedef {{
 *   field: string;
 *   expected: string;
 *   actual: string;
 * }} StagingEligibilityFailure
 *
 * @typedef {{
 *   eligible: boolean;
 *   failures: StagingEligibilityFailure[];
 * }} StagingEligibilityResult
 */

/**
 * Ordered field definitions for the advisory staging-eligibility gate.
 * Each entry mirrors one predicate from the original `isStagingPromotionEligible`.
 *
 * @type {ReadonlyArray<{
 *   field: string;
 *   expected: string;
 *   evaluate: (ctx: StagingEligibilityContext) => { pass: boolean; actual: string };
 * }>}
 */
export const STAGING_ELIGIBILITY_FIELDS = Object.freeze([
  {
    field: STAGING_ELIGIBILITY_KEYS.VERIFIED_APP_SHA,
    expected: '<headSha>',
    evaluate: (ctx) => {
      const actual = String(ctx.stagingState.STAGING_VERIFIED_APP_SHA ?? '');
      return { pass: actual === ctx.headSha, actual: actual || 'n/a' };
    },
  },
  {
    field: STAGING_ELIGIBILITY_KEYS.VERIFIED_OPENPATH_SHA,
    expected: '<submoduleSha>',
    evaluate: (ctx) => {
      const actual = String(ctx.stagingState.STAGING_VERIFIED_OPENPATH_SHA ?? '');
      return { pass: actual === ctx.submoduleSha, actual: actual || 'n/a' };
    },
  },
  {
    field: STAGING_ELIGIBILITY_KEYS.VERIFIED_IMAGE_SOURCE,
    expected: 'release-candidate',
    evaluate: (ctx) => {
      const actual = String(ctx.stagingState.STAGING_VERIFIED_IMAGE_SOURCE ?? '');
      return { pass: actual === 'release-candidate', actual: actual || 'n/a' };
    },
  },
  {
    field: STAGING_ELIGIBILITY_KEYS.CURRENT_IMAGE_SOURCE,
    expected: 'release-candidate',
    evaluate: (ctx) => {
      const actual = String(ctx.stagingCurrentImages.IMAGE_SOURCE ?? '');
      return { pass: actual === 'release-candidate', actual: actual || 'n/a' };
    },
  },
  {
    field: STAGING_ELIGIBILITY_KEYS.SMOKE_RESULT,
    expected: 'success',
    evaluate: (ctx) => {
      const raw = ctx.stagingState.STAGING_SMOKE_RESULT ?? ctx.stagingState.STAGING_SMOKE_STATUS;
      const actual = String(raw ?? '');
      return { pass: isSuccess(raw), actual: actual || 'n/a' };
    },
  },
  {
    field: STAGING_ELIGIBILITY_KEYS.RELEASE_GATE_RESULT,
    expected: 'success',
    evaluate: (ctx) => {
      const actual = String(ctx.stagingState.STAGING_RELEASE_GATE_RESULT ?? '');
      return {
        pass: isSuccess(ctx.stagingState.STAGING_RELEASE_GATE_RESULT),
        actual: actual || 'n/a',
      };
    },
  },
  {
    field: STAGING_ELIGIBILITY_KEYS.PREPROMOTION_REHEARSAL_RESULT,
    expected: 'success',
    evaluate: (ctx) => {
      const actual = String(ctx.stagingState.STAGING_PREPROMOTION_REHEARSAL_RESULT ?? '');
      return {
        pass: isSuccess(ctx.stagingState.STAGING_PREPROMOTION_REHEARSAL_RESULT),
        actual: actual || 'n/a',
      };
    },
  },
]);

/**
 * Evaluates the advisory staging-eligibility gate against a context object.
 *
 * Behavior is byte-identical to the original `isStagingPromotionEligible`
 * predicate: a context that would have returned `true` returns
 * `{ eligible: true, failures: [] }`, and one that would have returned `false`
 * returns `{ eligible: false, failures: [...] }` with the failing fields listed.
 *
 * @param {StagingEligibilityContext} context
 * @returns {StagingEligibilityResult}
 */
export function evaluateStagingEligibility(context) {
  /** @type {StagingEligibilityFailure[]} */
  const failures = [];

  for (const fieldDef of STAGING_ELIGIBILITY_FIELDS) {
    const { pass, actual } = fieldDef.evaluate(context);
    if (!pass) {
      const expected =
        fieldDef.field === STAGING_ELIGIBILITY_KEYS.VERIFIED_APP_SHA
          ? context.headSha || '<headSha>'
          : fieldDef.field === STAGING_ELIGIBILITY_KEYS.VERIFIED_OPENPATH_SHA
            ? context.submoduleSha || '<submoduleSha>'
            : fieldDef.expected;
      failures.push({ field: fieldDef.field, expected, actual });
    }
  }

  return { eligible: failures.length === 0, failures };
}
