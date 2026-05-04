import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RELEASE_RISK_POLICY_DEFINITIONS,
  evaluateReleaseRiskPathsForCanary,
  evaluateReleaseRiskPaths,
} from '../scripts/lib/release-risk-policy.mjs';

test('release risk policy keeps canary-triggering client and extension paths in a single catalog', () => {
  const ruleIds = RELEASE_RISK_POLICY_DEFINITIONS.map((definition) => definition.id);

  assert.deepEqual(ruleIds, [
    'openpath-gitlink',
    'openpath-windows-runtime',
    'openpath-linux-runtime',
    'openpath-firefox-extension',
    'openpath-api-bootstrap',
    'classroompath-api-image',
    'classroompath-email-delivery-runtime',
    'classroompath-onboarding-runtime',
    'classroompath-billing-runtime',
  ]);

  for (const definition of RELEASE_RISK_POLICY_DEFINITIONS.slice(0, 6)) {
    assert.deepEqual(definition.canaries, [
      'windows-firefox-canary',
      'production-client-update-canary',
    ]);
  }

  assert.deepEqual(RELEASE_RISK_POLICY_DEFINITIONS[0].preproductionEvidence, [
    'windows-installed-client',
    'firefox-policy-ajax',
    'linux-bootstrap-ajax',
    'windows-self-update',
    'linux-self-update',
  ]);
  assert.deepEqual(RELEASE_RISK_POLICY_DEFINITIONS[1].preproductionEvidence, [
    'windows-installed-client',
    'firefox-policy-ajax',
    'windows-self-update',
  ]);
  assert.deepEqual(RELEASE_RISK_POLICY_DEFINITIONS[2].preproductionEvidence, [
    'linux-bootstrap-ajax',
    'linux-self-update',
  ]);

  for (const definition of RELEASE_RISK_POLICY_DEFINITIONS.slice(6)) {
    assert.deepEqual(definition.canaries, ['email-delivery-preflight']);
  }
});

test('release risk policy maps platform changes to required preproduction evidence', () => {
  const gitlinkChange = evaluateReleaseRiskPaths(['upstream/openpath']);
  const windowsChange = evaluateReleaseRiskPaths(['upstream/openpath/windows/OpenPathAgent.psm1']);
  const linuxChange = evaluateReleaseRiskPaths(['upstream/openpath/linux/install-openpath.sh']);
  const firefoxChange = evaluateReleaseRiskPaths([
    'upstream/openpath/firefox-extension/manifest.json',
  ]);

  assert.deepEqual(gitlinkChange.requiredPreproductionEvidence, [
    'windows-installed-client',
    'firefox-policy-ajax',
    'linux-bootstrap-ajax',
    'windows-self-update',
    'linux-self-update',
  ]);
  assert.deepEqual(windowsChange.requiredPreproductionEvidence, [
    'windows-installed-client',
    'firefox-policy-ajax',
    'windows-self-update',
  ]);
  assert.deepEqual(linuxChange.requiredPreproductionEvidence, [
    'linux-bootstrap-ajax',
    'linux-self-update',
  ]);
  assert.deepEqual(firefoxChange.requiredPreproductionEvidence, [
    'windows-installed-client',
    'firefox-policy-ajax',
  ]);
});

test('release risk policy evaluates high-risk client promotions declaratively', () => {
  const linuxChange = evaluateReleaseRiskPaths([
    'upstream/openpath/linux/debian-package/DEBIAN/control',
  ]);
  const apiDockerfileChange = evaluateReleaseRiskPaths(['docker/Dockerfile.api']);
  const lowRiskChange = evaluateReleaseRiskPaths(['docs/runbooks/deploy-production.md']);

  assert.equal(linuxChange.highRisk, true);
  assert.equal(linuxChange.matchedRules[0]?.id, 'openpath-linux-runtime');

  assert.equal(apiDockerfileChange.highRisk, true);
  assert.equal(apiDockerfileChange.matchedRules[0]?.id, 'classroompath-api-image');

  assert.equal(lowRiskChange.highRisk, false);
  assert.deepEqual(lowRiskChange.matchedRules, []);
});

test('release risk policy evaluates email delivery preflight risk independently', () => {
  const emailRuntimeChange = evaluateReleaseRiskPathsForCanary(
    ['api/src/services/email.service.ts'],
    'email-delivery-preflight'
  );
  const onboardingChange = evaluateReleaseRiskPathsForCanary(
    ['api/src/trpc/routers/auth-email-delivery.ts'],
    'email-delivery-preflight'
  );
  const deployToolingChange = evaluateReleaseRiskPathsForCanary(
    ['api/src/services/email-delivery-preflight.service.ts'],
    'email-delivery-preflight'
  );
  const recoveryChange = evaluateReleaseRiskPathsForCanary(
    ['api/src/services/auth-recovery.service.ts'],
    'email-delivery-preflight'
  );
  const emailConfigChange = evaluateReleaseRiskPathsForCanary(
    ['api/src/config/runtime.ts'],
    'email-delivery-preflight'
  );
  const clientRuntimeChange = evaluateReleaseRiskPathsForCanary(
    ['upstream/openpath/linux/debian-package/DEBIAN/control'],
    'email-delivery-preflight'
  );
  const windowsFirefoxRisk = evaluateReleaseRiskPathsForCanary(
    ['upstream/openpath/firefox-extension/manifest.json'],
    'windows-firefox-canary'
  );

  assert.equal(emailRuntimeChange.highRisk, true);
  assert.equal(emailRuntimeChange.matchedRules[0]?.id, 'classroompath-email-delivery-runtime');
  assert.equal(onboardingChange.highRisk, true);
  assert.equal(onboardingChange.matchedRules[0]?.id, 'classroompath-onboarding-runtime');
  assert.equal(recoveryChange.highRisk, true);
  assert.equal(recoveryChange.matchedRules[0]?.id, 'classroompath-onboarding-runtime');
  assert.equal(emailConfigChange.highRisk, true);
  assert.equal(emailConfigChange.matchedRules[0]?.id, 'classroompath-email-delivery-runtime');
  assert.equal(deployToolingChange.highRisk, false);
  assert.equal(clientRuntimeChange.highRisk, false);
  assert.equal(windowsFirefoxRisk.highRisk, true);
  assert.equal(windowsFirefoxRisk.matchedRules[0]?.id, 'openpath-firefox-extension');
});
