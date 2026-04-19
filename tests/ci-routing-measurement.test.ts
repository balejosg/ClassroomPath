import assert from 'node:assert';
import { test } from 'node:test';

import { buildCiRoutingMeasurement } from '../scripts/measure-ci-routing.mjs';

test('buildCiRoutingMeasurement records representative ClassroomPath CI routing samples', () => {
  const measurements = buildCiRoutingMeasurement([
    {
      name: 'openpath-gitlink-only',
      files: ['upstream/openpath'],
    },
    {
      name: 'release-detector-logic',
      files: [
        'scripts/lib/release-candidate-components.mjs',
        'tests/workflow-release-candidate.test.ts',
      ],
    },
    {
      name: 'production-deploy-script',
      files: ['scripts/deploy-production-remote.sh'],
    },
    {
      name: 'spa-product-surface',
      files: ['react-spa/src/ClassroomPathShell.tsx'],
    },
  ]);

  assert.deepEqual(
    measurements.map((measurement) => ({
      name: measurement.name,
      lanes: measurement.lanes,
      owner: measurement.outputs.domain_owners,
    })),
    [
      {
        name: 'openpath-gitlink-only',
        lanes: ['product-validation'],
        owner: 'release-engineering',
      },
      {
        name: 'release-detector-logic',
        lanes: ['release-automation'],
        owner: 'release-engineering',
      },
      {
        name: 'production-deploy-script',
        lanes: ['ops-regression'],
        owner: 'release-engineering',
      },
      {
        name: 'spa-product-surface',
        lanes: ['product-validation'],
        owner: 'application',
      },
    ]
  );
});
