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
    });

    assert.deepEqual(intent, {
      version: 3,
      targetEnvironment: 'production',
      deployRef: 'refs/tags/v1.2.99',
      deploySha: '0123456789abcdef0123456789abcdef01234567',
      imageSource: 'release-candidate',
      deploymentMode: 'promotion-eligible',
      manifestBase64: 'bWFuaWZlc3Q=',
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
});
