// @ts-check

import {
  buildStagingReleaseEvidenceOutputs,
  validateCurrentReleaseState,
  validateHighRiskStagingVerification,
  validateStagingVerification,
} from './release-state-contract.mjs';

export const STAGING_DEPLOYMENT_MODES = /** @type {const} */ (['promotion-eligible', 'debug']);

/**
 * @typedef {'promotion-eligible' | 'debug'} StagingDeploymentMode
 */

/**
 * @param {string} deploymentMode
 * @returns {deploymentMode is StagingDeploymentMode}
 */
export function isStagingDeploymentMode(deploymentMode) {
  return STAGING_DEPLOYMENT_MODES.includes(/** @type {StagingDeploymentMode} */ (deploymentMode));
}

/**
 * @param {'release-candidate' | 'source-build'} imageSource
 * @returns {StagingDeploymentMode}
 */
export function deriveStagingDeploymentMode(imageSource) {
  return imageSource === 'release-candidate' ? 'promotion-eligible' : 'debug';
}

/**
 * @param {{
 *   status: 'pass' | 'fail' | 'not_applicable';
 *   errors: string[];
 * }} params
 */
function buildCheck(params) {
  return {
    status: params.status,
    errors: [...params.errors],
  };
}

/**
 * @param {{
 *   deploymentMode: StagingDeploymentMode;
 *   imageSource: 'release-candidate' | 'source-build';
 *   currentState: Record<string, string | undefined>;
 *   verificationState: Record<string, string | undefined>;
 *   expectedRuntime: Record<string, string | undefined>;
 *   highRisk: boolean;
 * }} params
 */
export function evaluatePromotionEligibility({
  deploymentMode,
  imageSource,
  currentState,
  verificationState,
  expectedRuntime,
  highRisk,
}) {
  /** @type {string[]} */
  const deploymentModeErrors = [];

  if (deploymentMode !== 'promotion-eligible') {
    deploymentModeErrors.push(
      '::error::Staging deploy is not promotion-eligible. Use release-candidate promotion mode before tagging production.'
    );
  }

  if (imageSource !== 'release-candidate') {
    deploymentModeErrors.push(
      `::error::Promotion requires immutable release-candidate images (imageSource=${imageSource})`
    );
  }

  const runtimeErrors = validateCurrentReleaseState(currentState, expectedRuntime);
  const verificationErrors = validateStagingVerification(verificationState, expectedRuntime);
  const windowsFirefoxErrors = highRisk
    ? validateHighRiskStagingVerification(verificationState)
    : [];

  const checks = {
    deploymentMode: buildCheck({
      status: deploymentModeErrors.length === 0 ? 'pass' : 'fail',
      errors: deploymentModeErrors,
    }),
    currentRuntime: buildCheck({
      status: runtimeErrors.length === 0 ? 'pass' : 'fail',
      errors: runtimeErrors,
    }),
    stagingVerification: buildCheck({
      status: verificationErrors.length === 0 ? 'pass' : 'fail',
      errors: verificationErrors,
    }),
    windowsFirefox: highRisk
      ? buildCheck({
          status: windowsFirefoxErrors.length === 0 ? 'pass' : 'fail',
          errors: windowsFirefoxErrors,
        })
      : buildCheck({
          status: 'not_applicable',
          errors: [],
        }),
  };

  const errors = [
    ...checks.deploymentMode.errors,
    ...checks.currentRuntime.errors,
    ...checks.stagingVerification.errors,
    ...checks.windowsFirefox.errors,
  ];

  return {
    version: 1,
    eligible: errors.length === 0,
    deploymentMode,
    imageSource,
    highRisk,
    checks,
    errors,
    outputs: buildStagingReleaseEvidenceOutputs(verificationState),
  };
}

/**
 * @param {ReturnType<typeof evaluatePromotionEligibility>} report
 */
export function buildPromotionEligibilityOutputs(report) {
  return {
    promotion_eligible: report.eligible ? 'true' : 'false',
    promotion_deployment_mode: report.deploymentMode,
    ...report.outputs,
  };
}
