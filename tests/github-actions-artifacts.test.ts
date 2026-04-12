import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { waitForArtifactResolution } from '../scripts/lib/github-actions-artifacts.mjs';

describe('github-actions-artifacts helper', () => {
  test('retries pending attempts until the artifact resolver succeeds', () => {
    let attempts = 0;

    const result = waitForArtifactResolution({
      timeoutSeconds: 1,
      intervalSeconds: 0,
      attempt() {
        attempts += 1;
        if (attempts < 3) {
          return { status: 'pending', context: { attempts } };
        }

        return { status: 'resolved', value: { artifactName: 'release-candidate-images-sha' } };
      },
      formatTimeoutError() {
        return 'should not time out';
      },
    });

    assert.equal(attempts, 3);
    assert.deepEqual(result, { artifactName: 'release-candidate-images-sha' });
  });

  test('formats timeout errors with the latest pending context', () => {
    assert.throws(
      () =>
        waitForArtifactResolution({
          timeoutSeconds: 0,
          intervalSeconds: 0,
          attempt() {
            return {
              status: 'pending',
              context: { lastState: 'pending', latestRunId: 12345 },
            };
          },
          formatTimeoutError(context) {
            return `timeout:lastState=${context.lastState};latestRunId=${context.latestRunId}`;
          },
        }),
      /timeout:lastState=pending;latestRunId=12345/
    );
  });

  test('requires both the attempt callback and timeout formatter', () => {
    assert.throws(() => waitForArtifactResolution({ formatTimeoutError() {} }), /attempt callback/);
    assert.throws(() => waitForArtifactResolution({ attempt() {} }), /timeout formatter/);
  });
});
