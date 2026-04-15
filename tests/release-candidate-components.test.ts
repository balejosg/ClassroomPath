import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  classifyOpenPathChangedPaths,
  classifyReleaseCandidateComponents,
} from '../scripts/lib/release-candidate-components.mjs';

describe('release candidate component classification', () => {
  test('maps OpenPath linux-agent contract changes to openpath-api and verifier only', () => {
    assert.deepEqual(
      classifyOpenPathChangedPaths(['linux/scripts/runtime/openpath-self-update.sh']),
      {
        gatewayChanged: false,
        migrationsChanged: false,
        openpathApiChanged: true,
        spaChanged: false,
        verifierChanged: true,
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
    assert.deepEqual(classifyOpenPathChangedPaths(['docs/ADR.md']), {
      gatewayChanged: false,
      migrationsChanged: false,
      openpathApiChanged: false,
      spaChanged: false,
      verifierChanged: false,
    });
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

  test('still falls back to rebuilding every image family for ambiguous OpenPath paths', () => {
    assert.deepEqual(classifyOpenPathChangedPaths(['misc/custom-generator.ts']), {
      gatewayChanged: true,
      migrationsChanged: true,
      openpathApiChanged: true,
      spaChanged: true,
      verifierChanged: true,
    });
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

  test('keeps firefox asset workflow changes scoped to the OpenPath API family', () => {
    assert.deepEqual(
      classifyReleaseCandidateComponents({
        changedFiles: ['.github/workflows/firefox-release-assets.yml'],
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
});
