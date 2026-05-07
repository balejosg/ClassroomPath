import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  classifyPackageJsonChange,
  classifyOpenPathChangedPaths,
  classifyReleaseCandidateComponents,
  isManifestOnlyReleaseCandidateChange,
  PACKAGE_JSON_CHANGE_KIND,
} from '../scripts/lib/release-candidate-components.mjs';

describe('release candidate component classification', () => {
  test('maps OpenPath linux-agent contract changes to openpath-api and verifier only', () => {
    const flags = classifyOpenPathChangedPaths(['linux/scripts/runtime/openpath-self-update.sh']);

    assert.deepEqual(flags, {
      gatewayChanged: false,
      migrationsChanged: false,
      openpathApiChanged: true,
      spaChanged: false,
      verifierChanged: true,
    });
    assert.equal(flags.openpathLinuxAgentRequired, true);
  });

  test('maps OpenPath Firefox extension changes to the Firefox assets family without rebuilding OpenPath API', () => {
    const flags = classifyOpenPathChangedPaths([
      'firefox-extension/src/background.ts',
      'firefox-extension/manifest.json',
    ]);

    assert.equal(flags.openpathApiChanged, false);
    assert.equal(flags.openpathFirefoxAssetsChanged, true);
    assert.equal(flags.openpathLinuxAgentRequired, false);
    assert.equal(flags.verifierChanged, true);
  });

  test('maps OpenPath Firefox signing release tooling changes to Firefox assets', () => {
    const flags = classifyOpenPathChangedPaths([
      'firefox-extension/sign-firefox-release.mjs',
      'firefox-extension/tests/firefox-release.test.ts',
      'tests/repo-config/workflow-contracts.test.mjs',
    ]);

    assert.equal(flags.openpathApiChanged, false);
    assert.equal(flags.openpathFirefoxAssetsChanged, true);
    assert.equal(flags.openpathLinuxAgentRequired, false);
    assert.equal(flags.verifierChanged, true);
  });

  test('maps release-candidate image workflow plumbing changes to every server image family', () => {
    const flags = classifyReleaseCandidateComponents({
      changedFiles: [
        '.github/workflows/reusable-release-candidate-image-family.yml',
        '.github/actions/publish-release-candidate-manifest/action.yml',
      ],
    });

    assert.deepEqual(flags, {
      gatewayChanged: true,
      migrationsChanged: true,
      openpathApiChanged: true,
      spaChanged: true,
      verifierChanged: true,
    });
    assert.equal(flags.openpathFirefoxAssetsChanged, false);
  });

  test('keeps release-candidate workflow detector-only changes from forcing Firefox signing', () => {
    const flags = classifyReleaseCandidateComponents({
      changedFiles: [
        '.github/workflows/release-candidate-images.yml',
        'tests/workflow-release-candidate.test.ts',
      ],
      openpathChangedFiles: [],
    });

    assert.equal(flags.gatewayChanged, true);
    assert.equal(flags.migrationsChanged, true);
    assert.equal(flags.openpathApiChanged, true);
    assert.equal(flags.openpathFirefoxAssetsChanged, false);
    assert.equal(flags.spaChanged, true);
    assert.equal(flags.verifierChanged, true);
    assert.equal(isManifestOnlyReleaseCandidateChange(flags), false);
  });

  test('preserves Firefox asset detection when release-candidate plumbing changes with OpenPath Firefox runtime', () => {
    const flags = classifyReleaseCandidateComponents({
      changedFiles: ['.github/workflows/release-candidate-images.yml', 'upstream/openpath'],
      openpathChangedFiles: ['firefox-extension/src/background.ts'],
    });

    assert.equal(flags.gatewayChanged, true);
    assert.equal(flags.migrationsChanged, true);
    assert.equal(flags.openpathApiChanged, true);
    assert.equal(flags.openpathFirefoxAssetsChanged, true);
    assert.equal(flags.spaChanged, true);
    assert.equal(flags.verifierChanged, true);
  });

  test('keeps manifest publish action changes out of image rebuilds', () => {
    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: ['.github/actions/publish-release-candidate-manifest/action.yml'],
        openpathChangedFiles: [],
      }),
      {
        gatewayChanged: false,
        migrationsChanged: false,
        openpathApiChanged: false,
        spaChanged: false,
        verifierChanged: false,
      }
    );
  });

  test('maps OpenPath shared and public SPA changes to the dependent ClassroomPath families', () => {
    assert.deepEqual(
      classifyOpenPathChangedPaths([
        'shared/src/lib/roles.ts',
        'react-spa/public-ui.ts',
        'react-spa/src/components/Nav.tsx',
      ]),
      {
        gatewayChanged: true,
        migrationsChanged: false,
        openpathApiChanged: true,
        spaChanged: true,
        verifierChanged: true,
      }
    );
  });

  test('falls back to rebuilding every image family for unknown OpenPath paths', () => {
    const flags = classifyOpenPathChangedPaths(['docs/ADR.md']);

    assert.deepEqual(flags, {
      gatewayChanged: false,
      migrationsChanged: false,
      openpathApiChanged: false,
      spaChanged: false,
      verifierChanged: false,
    });
    assert.equal(flags.openpathLinuxAgentRequired, false);
  });

  test('maps OpenPath test-only changes to the verifier family without rebuilding product images', () => {
    assert.deepEqual(
      classifyOpenPathChangedPaths([
        'api/tests/token-delivery.test.ts',
        'react-spa/src/__tests__/router.test.tsx',
      ]),
      {
        gatewayChanged: false,
        migrationsChanged: false,
        openpathApiChanged: false,
        spaChanged: false,
        verifierChanged: true,
      }
    );
  });

  test('keeps OpenPath CI and repo-level test changes out of release image rebuilds', () => {
    const flags = classifyOpenPathChangedPaths([
      '.github/workflows/prerelease-deb.yml',
      '.github/workflows/release-scripts.yml',
      'tests/install.bats',
      'tests/repo-config/workflow-contracts.test.mjs',
    ]);

    assert.deepEqual(flags, {
      gatewayChanged: false,
      migrationsChanged: false,
      openpathApiChanged: false,
      spaChanged: false,
      verifierChanged: false,
    });
    assert.equal(flags.openpathLinuxAgentRequired, false);
  });

  test('still falls back to rebuilding every image family for ambiguous OpenPath paths', () => {
    const flags = classifyOpenPathChangedPaths(['misc/custom-generator.ts']);

    assert.deepEqual(flags, {
      gatewayChanged: true,
      migrationsChanged: true,
      openpathApiChanged: true,
      spaChanged: true,
      verifierChanged: true,
    });
    assert.equal(flags.openpathLinuxAgentRequired, true);
  });

  test('classifies top-level ClassroomPath changes without broadening unrelated image families', () => {
    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: ['react-spa/src/app/router.tsx'],
        openpathChangedFiles: [],
      }),
      {
        gatewayChanged: false,
        migrationsChanged: false,
        openpathApiChanged: false,
        spaChanged: true,
        verifierChanged: true,
      }
    );
  });

  test('keeps firefox asset workflow changes out of release image rebuilds', () => {
    const flags = classifyReleaseCandidateComponents({
      changedFiles: [
        '.github/workflows/firefox-release-assets.yml',
        'scripts/firefox-release-evidence.mjs',
        'scripts/resolve-firefox-release-assets-cache.mjs',
        'tests/firefox-release-assets-cache.test.ts',
      ],
      openpathChangedFiles: [],
    });

    assert.equal(flags.gatewayChanged, false);
    assert.equal(flags.migrationsChanged, false);
    assert.equal(flags.openpathApiChanged, false);
    assert.equal(flags.openpathFirefoxAssetsChanged, false);
    assert.equal(flags.spaChanged, false);
    assert.equal(flags.verifierChanged, false);
  });

  test('keeps top-level OpenPath API dockerfile changes out of unrelated release families', () => {
    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: ['docker/Dockerfile.api'],
        openpathChangedFiles: [],
      }),
      {
        gatewayChanged: false,
        migrationsChanged: false,
        openpathApiChanged: true,
        spaChanged: false,
        verifierChanged: false,
      }
    );
  });

  test('keeps ClassroomPath dependency lockfile changes out of OpenPath API signing', () => {
    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: ['package-lock.json'],
        openpathChangedFiles: [],
      }),
      {
        gatewayChanged: true,
        migrationsChanged: true,
        openpathApiChanged: false,
        spaChanged: true,
        verifierChanged: true,
      }
    );
  });

  test('keeps package.json operational script-only changes out of image rebuilds', () => {
    assert.equal(
      classifyPackageJsonChange(
        JSON.stringify({
          name: 'classroompath',
          scripts: {
            build: 'bash scripts/build-classroompath.sh',
          },
          dependencies: {
            express: '1.0.0',
          },
        }),
        JSON.stringify({
          name: 'classroompath',
          scripts: {
            build: 'bash scripts/build-classroompath.sh',
            'release:evidence-bundle': 'node scripts/release-evidence-bundle.mjs',
          },
          dependencies: {
            express: '1.0.0',
          },
        })
      ),
      PACKAGE_JSON_CHANGE_KIND.OPERATIONAL_SCRIPTS_ONLY
    );

    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: ['package.json'],
        openpathChangedFiles: [],
        packageJsonChangeKind: PACKAGE_JSON_CHANGE_KIND.OPERATIONAL_SCRIPTS_ONLY,
      }),
      {
        gatewayChanged: false,
        migrationsChanged: false,
        openpathApiChanged: false,
        spaChanged: false,
        verifierChanged: false,
      }
    );
  });

  test('keeps package.json dependency changes on the runtime rebuild path', () => {
    assert.equal(
      classifyPackageJsonChange(
        JSON.stringify({
          scripts: {
            'release:evidence-bundle': 'node scripts/release-evidence-bundle.mjs',
          },
          dependencies: {
            express: '1.0.0',
          },
        }),
        JSON.stringify({
          scripts: {
            'release:evidence-bundle': 'node scripts/release-evidence-bundle.mjs',
          },
          dependencies: {
            express: '1.0.1',
          },
        })
      ),
      PACKAGE_JSON_CHANGE_KIND.RUNTIME
    );

    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: ['package.json'],
        openpathChangedFiles: [],
        packageJsonChangeKind: PACKAGE_JSON_CHANGE_KIND.RUNTIME,
      }),
      {
        gatewayChanged: true,
        migrationsChanged: true,
        openpathApiChanged: false,
        spaChanged: true,
        verifierChanged: true,
      }
    );
  });

  test('keeps ClassroomPath scripts changes out of OpenPath API signing', () => {
    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: ['scripts/deploy-staging-local.sh'],
        openpathChangedFiles: [],
      }),
      {
        gatewayChanged: false,
        migrationsChanged: true,
        openpathApiChanged: false,
        spaChanged: false,
        verifierChanged: true,
      }
    );
  });

  test('keeps production canary harness changes out of release image rebuilds', () => {
    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: [
          'scripts/create-production-windows-bootstrap-canary.mjs',
          'scripts/production-enrollment-download-canary.mjs',
          'scripts/write-production-client-canary-evidence.mjs',
          'tests/workflow-production-client-canary.test.ts',
        ],
        openpathChangedFiles: [],
      }),
      {
        gatewayChanged: false,
        migrationsChanged: false,
        openpathApiChanged: false,
        spaChanged: false,
        verifierChanged: false,
      }
    );
  });

  test('keeps release timing measurement changes out of image rebuilds', () => {
    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: [
          'scripts/measure-release-candidate-timings.mjs',
          'tests/release-candidate-timings.test.ts',
        ],
        openpathChangedFiles: [],
      }),
      {
        gatewayChanged: false,
        migrationsChanged: false,
        openpathApiChanged: false,
        spaChanged: false,
        verifierChanged: false,
      }
    );
  });

  test('keeps verifier runtime smoke files scoped to the verifier image', () => {
    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: [
          'tests/smoke.test.ts',
          'tests/release-gate.test.ts',
          'tests/release-gate-policy.ts',
          'tests/helpers/resolved-fetch.ts',
          'tests/helpers/release-gate-client.ts',
        ],
        openpathChangedFiles: [],
      }),
      {
        gatewayChanged: false,
        migrationsChanged: false,
        openpathApiChanged: false,
        spaChanged: false,
        verifierChanged: true,
      }
    );
  });
});
