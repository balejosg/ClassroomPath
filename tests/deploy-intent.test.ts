import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildDeployIntent,
  decodeDeployIntentBase64,
  encodeDeployIntentBase64,
} from '../scripts/lib/deploy-intent.mjs';

describe('deploy intent', () => {
  test('builds a versioned release-candidate production intent', () => {
    const intent = buildDeployIntent({
      targetEnvironment: 'production',
      deployRef: 'refs/tags/v1.2.99',
      deploySha: '0123456789abcdef0123456789abcdef01234567',
      imageSource: 'release-candidate',
      deploymentMode: 'promotion-eligible',
      manifestBase64: 'bWFuaWZlc3Q=',
      releaseId: 'a'.repeat(64),
      releaseBundleBase64: 'YnVuZGxl',
      openpathContractBase64: 'Y29udHJhY3Q=',
      rcRunId: '123456789',
    });

    assert.deepEqual(intent, {
      version: 3,
      targetEnvironment: 'production',
      deployRef: 'refs/tags/v1.2.99',
      deploySha: '0123456789abcdef0123456789abcdef01234567',
      imageSource: 'release-candidate',
      deploymentMode: 'promotion-eligible',
      manifestBase64: 'bWFuaWZlc3Q=',
      releaseId: 'a'.repeat(64),
      releaseBundleBase64: 'YnVuZGxl',
      openpathContractBase64: 'Y29udHJhY3Q=',
      rcRunId: '123456789',
    });
  });

  test('round-trips a source-build staging intent through base64 transport', () => {
    const intent = buildDeployIntent({
      targetEnvironment: 'staging',
      deployRef: 'refs/heads/main',
      deploySha: '89abcdef0123456789abcdef0123456789abcdef',
      imageSource: 'source-build',
      deploymentMode: 'debug',
      manifestBase64: '',
    });

    assert.deepEqual(decodeDeployIntentBase64(encodeDeployIntentBase64(intent)), intent);
  });

  test('carries one exact Release Bundle and contract with a promotion intent', () => {
    const intent = buildDeployIntent({
      targetEnvironment: 'production',
      deployRef: 'refs/tags/v1.2.100',
      deploySha: '1123456789abcdef0123456789abcdef01234567',
      imageSource: 'release-candidate',
      deploymentMode: 'promotion-eligible',
      manifestBase64: 'bWFuaWZlc3Q=',
      rcRunId: '123456789',
      releaseId: 'a'.repeat(64),
      releaseBundleBase64: 'YnVuZGxl',
      openpathContractBase64: 'Y29udHJhY3Q=',
    });

    assert.equal(intent.releaseId, 'a'.repeat(64));
    assert.equal(
      decodeDeployIntentBase64(encodeDeployIntentBase64(intent)).releaseBundleBase64,
      'YnVuZGxl'
    );
    assert.equal(
      decodeDeployIntentBase64(encodeDeployIntentBase64(intent)).openpathContractBase64,
      'Y29udHJhY3Q='
    );
  });

  test('carries the exact Release Candidate workflow run with a promotion intent', () => {
    const intent = buildDeployIntent({
      targetEnvironment: 'production',
      deployRef: 'refs/tags/v1.2.100',
      deploySha: '1123456789abcdef0123456789abcdef01234567',
      imageSource: 'release-candidate',
      deploymentMode: 'promotion-eligible',
      releaseId: 'a'.repeat(64),
      releaseBundleBase64: 'YnVuZGxl',
      openpathContractBase64: 'Y29udHJhY3Q=',
      rcRunId: '123456789',
    });

    assert.equal(decodeDeployIntentBase64(encodeDeployIntentBase64(intent)).rcRunId, '123456789');
  });

  test('rejects a partial immutable bundle transport', () => {
    assert.throws(
      () =>
        buildDeployIntent({
          targetEnvironment: 'production',
          deployRef: 'refs/tags/v1.2.100',
          deploySha: '1123456789abcdef0123456789abcdef01234567',
          imageSource: 'release-candidate',
          deploymentMode: 'promotion-eligible',
          releaseId: 'a'.repeat(64),
        }),
      /releaseId, releaseBundleBase64, and openpathContractBase64 must be provided together/
    );
  });
});
