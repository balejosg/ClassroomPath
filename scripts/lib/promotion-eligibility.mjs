// @ts-check

/**
 * Re-exports promotion eligibility helpers from `release-evidence.mjs` under a stable public interface.
 *
 * Invoked by: Imported by `scripts/lib/release-plan.mjs`.
 * Usage: (library module, not invoked directly)
 * Tested by `tests/promotion-eligibility.test.ts` and `tests/workflow-deploy.test.ts`.
 */

export {
  STAGING_DEPLOYMENT_MODES,
  buildPromotionEligibilityOutputs,
  deriveStagingDeploymentMode,
  evaluatePromotionEligibility,
  isStagingDeploymentMode,
} from './release-evidence.mjs';
