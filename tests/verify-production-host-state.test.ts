import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateProductionHostState,
  main,
  verifyProductionHostState,
} from '../scripts/verify-production-host-state.mjs';

const APP_SHA = 'a'.repeat(40);
const OPENPATH_SHA = 'b'.repeat(40);

function currentImages(overrides: Record<string, string> = {}) {
  const values = {
    APP_SHA,
    OPENPATH_SHA,
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT: OPENPATH_SHA,
    ...overrides,
  };
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function phase(overrides: Record<string, string> = {}) {
  const values = { DEPLOYMENT_PHASE: 'COMMITTED', ROLLBACK_ATTEMPTED: '0', ...overrides };
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

const expected = { appSha: APP_SHA, openpathSha: OPENPATH_SHA };

describe('verify-production-host-state', () => {
  it('accepts a committed host that matches the tag identity', () => {
    const result = evaluateProductionHostState({
      currentImagesText: currentImages(),
      deploymentPhaseText: phase(),
      expected,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
  });

  it('fails when APP_SHA differs (host was rolled back to an older release)', () => {
    const result = evaluateProductionHostState({
      currentImagesText: currentImages({ APP_SHA: 'c'.repeat(40) }),
      deploymentPhaseText: phase(),
      expected,
    });
    assert.equal(result.ok, false);
    assert.match(result.failures.join('\n'), /APP_SHA=c{40}/);
  });

  it('fails on OPENPATH_SHA, template commit, phase and rollback flag mismatches', () => {
    const result = evaluateProductionHostState({
      currentImagesText: currentImages({
        OPENPATH_SHA: 'd'.repeat(40),
        OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT: 'e'.repeat(40),
      }),
      deploymentPhaseText: phase({ DEPLOYMENT_PHASE: 'ROLLED_BACK', ROLLBACK_ATTEMPTED: '1' }),
      expected,
    });
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 5 - 1);
    assert.match(result.failures.join('\n'), /DEPLOYMENT_PHASE=ROLLED_BACK/);
    assert.match(result.failures.join('\n'), /ROLLBACK_ATTEMPTED=1/);
  });

  it('reads both state files from the host release-state directory via the injected reader', async () => {
    const reads: string[] = [];
    const result = await verifyProductionHostState({
      deployRoot: '/srv/example/',
      expected,
      readRemoteFile: async (path: string) => {
        reads.push(path);
        return path.endsWith('current-images.env') ? currentImages() : phase();
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(reads, [
      '/srv/example/release-state/current-images.env',
      '/srv/example/release-state/deployment-phase.env',
    ]);
  });

  it('main rejects with a rollback hint when the host does not match', async () => {
    await assert.rejects(
      main(
        ['--tag', 'v9.9.9', '--app-sha', APP_SHA, '--openpath-sha', OPENPATH_SHA],
        { CLASSROOMPATH_DEPLOY_ROOT: '/srv/example' },
        {
          readRemoteFile: async (path: string) =>
            path.endsWith('current-images.env')
              ? currentImages({ APP_SHA: 'c'.repeat(40) })
              : phase({ ROLLBACK_ATTEMPTED: '1' }),
        }
      ),
      /may have been rolled back/
    );
  });
});
