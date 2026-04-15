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
});
