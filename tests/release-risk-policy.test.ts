import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RELEASE_RISK_POLICY_DEFINITIONS,
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
  ]);

  for (const definition of RELEASE_RISK_POLICY_DEFINITIONS) {
    assert.deepEqual(definition.canaries, [
      'windows-firefox-canary',
      'production-client-update-canary',
    ]);
  }
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
