import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildPromotionEligibilityOutputs,
  evaluatePromotionEligibility,
} from '../scripts/lib/promotion-eligibility.mjs';

const expectedRuntime = {
  EXPECTED_APP_SHA: 'abc123',
  EXPECTED_GATEWAY_IMAGE: 'ghcr.io/balejosg/classroompath-gateway:abc123',
  EXPECTED_MIGRATIONS_IMAGE: 'ghcr.io/balejosg/classroompath-migrations:abc123',
  EXPECTED_OPENPATH_API_IMAGE: 'ghcr.io/balejosg/openpath-api:abc123',
  EXPECTED_OPENPATH_VERSION: '4.1.19',
  EXPECTED_OPENPATH_LINUX_AGENT_VERSION: '4.1.19',
  EXPECTED_SPA_IMAGE: 'ghcr.io/balejosg/classroompath-spa:abc123',
};

const currentState = {
  APP_SHA: 'abc123',
  IMAGE_SOURCE: 'release-candidate',
  CLASSROOMPATH_GATEWAY_IMAGE: 'ghcr.io/balejosg/classroompath-gateway:abc123',
  CLASSROOMPATH_MIGRATIONS_IMAGE: 'ghcr.io/balejosg/classroompath-migrations:abc123',
  OPENPATH_API_IMAGE: 'ghcr.io/balejosg/openpath-api:abc123',
  OPENPATH_VERSION: '4.1.19',
  OPENPATH_LINUX_AGENT_VERSION: '4.1.19',
  CLASSROOMPATH_SPA_IMAGE: 'ghcr.io/balejosg/classroompath-spa:abc123',
};

const verificationState = {
  STAGING_VERIFIED_AT: '2026-04-15T10:00:00Z',
  STAGING_VERIFIED_APP_SHA: 'abc123',
  STAGING_VERIFIED_IMAGE_SOURCE: 'release-candidate',
  STAGING_VERIFIED_GATEWAY_IMAGE: 'ghcr.io/balejosg/classroompath-gateway:abc123',
  STAGING_VERIFIED_MIGRATIONS_IMAGE: 'ghcr.io/balejosg/classroompath-migrations:abc123',
  STAGING_VERIFIED_OPENPATH_API_IMAGE: 'ghcr.io/balejosg/openpath-api:abc123',
  STAGING_VERIFIED_OPENPATH_VERSION: '4.1.19',
  STAGING_VERIFIED_OPENPATH_LINUX_AGENT_VERSION: '4.1.19',
  STAGING_VERIFIED_SPA_IMAGE: 'ghcr.io/balejosg/classroompath-spa:abc123',
  STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS: 'present',
  STAGING_SMOKE_RESULT: 'success',
  STAGING_SMOKE_STATUS: 'PASS',
  STAGING_RELEASE_GATE_RESULT: 'success',
  STAGING_WINDOWS_BOOTSTRAP_RESULT: 'success',
  STAGING_FIREFOX_POLICY_RESULT: 'success',
  STAGING_FIREFOX_EXTENSION_ID: 'openpath@example',
  STAGING_FIREFOX_RELEASE_VERSION: '4.1.19',
  STAGING_FIREFOX_METADATA_SHA256: 'meta123',
  STAGING_FIREFOX_XPI_SHA256: 'xpi123',
  STAGING_FIREFOX_SIGNATURE_SOURCE: 'amo',
  STAGING_FIREFOX_SIGNATURE_STATE: 'signed',
  STAGING_LINUX_BOOTSTRAP_RESULT: 'success',
  STAGING_LINUX_BOOTSTRAP_RUN_ID: '123456789',
  STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID: 'none',
  STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE:
    'Linux AJAX auto-allow canary completed successfully.',
  STAGING_WINDOWS_SELF_UPDATE_RESULT: 'success',
  STAGING_LINUX_SELF_UPDATE_RESULT: 'success',
  STAGING_PREPROMOTION_REHEARSAL_RESULT: 'success',
};

describe('promotion eligibility', () => {
  test('marks a release-candidate staging deployment as promotion-eligible when all checks pass', () => {
    const report = evaluatePromotionEligibility({
      deploymentMode: 'promotion-eligible',
      imageSource: 'release-candidate',
      currentState,
      verificationState,
      expectedRuntime,
      highRisk: true,
    });

    assert.equal(report.version, 1);
    assert.equal(report.eligible, true);
    assert.equal(report.deploymentMode, 'promotion-eligible');
    assert.equal(report.checks.currentRuntime.status, 'pass');
    assert.equal(report.checks.stagingVerification.status, 'pass');
    assert.equal(report.checks.windowsFirefox.status, 'pass');
    assert.deepEqual(report.errors, []);
    assert.equal(
      buildPromotionEligibilityOutputs(report).staging_verified_at,
      '2026-04-15T10:00:00Z'
    );
  });

  test('fails closed for debug staging deploys even if smoke evidence exists', () => {
    const report = evaluatePromotionEligibility({
      deploymentMode: 'debug',
      imageSource: 'source-build',
      currentState: {
        ...currentState,
        IMAGE_SOURCE: 'source-build',
      },
      verificationState: {
        ...verificationState,
        STAGING_VERIFIED_IMAGE_SOURCE: 'source-build',
      },
      expectedRuntime,
      highRisk: false,
    });

    assert.equal(report.eligible, false);
    assert.equal(report.deploymentMode, 'debug');
    assert.equal(report.checks.deploymentMode.status, 'fail');
    assert.match(report.errors.join('\n'), /not promotion-eligible/i);
  });

  test('requires live windows and firefox evidence for high-risk promotions', () => {
    const report = evaluatePromotionEligibility({
      deploymentMode: 'promotion-eligible',
      imageSource: 'release-candidate',
      currentState,
      verificationState: {
        ...verificationState,
        STAGING_WINDOWS_BOOTSTRAP_RESULT: 'failed',
      },
      expectedRuntime,
      highRisk: true,
    });

    assert.equal(report.eligible, false);
    assert.equal(report.checks.windowsFirefox.status, 'fail');
    assert.match(report.errors.join('\n'), /Windows bootstrap evidence is missing or failed/);
  });

  test('requires signed Firefox release evidence for low-risk production promotions', () => {
    const report = evaluatePromotionEligibility({
      deploymentMode: 'promotion-eligible',
      imageSource: 'release-candidate',
      currentState,
      verificationState: {
        ...verificationState,
        STAGING_FIREFOX_SIGNATURE_STATE: undefined,
      },
      expectedRuntime,
      highRisk: false,
    });

    assert.equal(report.eligible, false);
    assert.equal(report.checks.signedFirefoxRelease.status, 'fail');
    assert.equal(report.checks.windowsFirefox.status, 'not_applicable');
    assert.match(report.errors.join('\n'), /STAGING_FIREFOX_SIGNATURE_STATE/);
  });

  test('accepts LAN staging Linux bootstrap skip for high-risk promotions', () => {
    const report = evaluatePromotionEligibility({
      deploymentMode: 'promotion-eligible',
      imageSource: 'release-candidate',
      currentState,
      verificationState: {
        ...verificationState,
        STAGING_LINUX_BOOTSTRAP_RESULT: 'skipped-lan-staging',
        STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID: 'skipped-lan-staging',
      },
      expectedRuntime,
      highRisk: true,
    });

    assert.equal(report.eligible, true);
    assert.equal(report.checks.windowsFirefox.status, 'pass');
  });

  test('rejects LAN staging Linux bootstrap skip when the boundary does not match', () => {
    const report = evaluatePromotionEligibility({
      deploymentMode: 'promotion-eligible',
      imageSource: 'release-candidate',
      currentState,
      verificationState: {
        ...verificationState,
        STAGING_LINUX_BOOTSTRAP_RESULT: 'skipped-lan-staging',
        STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID: 'firefox-extension-ready',
      },
      expectedRuntime,
      highRisk: true,
    });

    assert.equal(report.eligible, false);
    assert.equal(report.checks.windowsFirefox.status, 'fail');
    assert.match(report.errors.join('\n'), /Linux bootstrap evidence is missing or failed/);
  });

  test('does not hard-gate self-update and prepromotion rehearsal evidence yet', () => {
    const report = evaluatePromotionEligibility({
      deploymentMode: 'promotion-eligible',
      imageSource: 'release-candidate',
      currentState,
      verificationState: {
        ...verificationState,
        STAGING_WINDOWS_SELF_UPDATE_RESULT: undefined,
        STAGING_LINUX_SELF_UPDATE_RESULT: undefined,
        STAGING_PREPROMOTION_REHEARSAL_RESULT: undefined,
      },
      expectedRuntime,
      highRisk: true,
    });

    assert.equal(report.eligible, true);
    assert.deepEqual(report.errors, []);
  });
});
