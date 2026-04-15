import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildDeployPayload,
  decodeDeployPayloadBase64,
  encodeDeployPayloadBase64,
} from '../scripts/lib/deploy-payload.mjs';

describe('deploy payload', () => {
  test('builds a versioned production deploy payload around the manifest contract', () => {
    const payload = buildDeployPayload({
      targetEnvironment: 'production',
      deployRef: 'refs/tags/v1.2.99',
      deploySha: '0123456789abcdef0123456789abcdef01234567',
      imageSource: 'release-candidate',
      supportsPromotionEvidence: true,
      manifestBase64: 'bWFuaWZlc3Q=',
    });

    assert.equal(payload.version, 2);
    assert.equal(payload.targetEnvironment, 'production');
    assert.equal(payload.deployRef, 'refs/tags/v1.2.99');
    assert.equal(payload.deploySha, '0123456789abcdef0123456789abcdef01234567');
    assert.equal(payload.imageSource, 'release-candidate');
    assert.equal(payload.supportsPromotionEvidence, true);
    assert.equal(payload.manifestBase64, 'bWFuaWZlc3Q=');
  });

  test('round-trips through base64 transport encoding', () => {
    const payload = buildDeployPayload({
      targetEnvironment: 'staging',
      deployRef: 'refs/heads/main',
      deploySha: '89abcdef0123456789abcdef0123456789abcdef',
      imageSource: 'release-candidate',
      supportsPromotionEvidence: true,
      manifestBase64: 'bWFuaWZlc3Q=',
    });

    const encoded = encodeDeployPayloadBase64(payload);
    const decoded = decodeDeployPayloadBase64(encoded);

    assert.deepEqual(decoded, payload);
  });

  test('allows source-build staging payloads without a release manifest', () => {
    const payload = buildDeployPayload({
      targetEnvironment: 'staging',
      deployRef: 'refs/heads/main',
      deploySha: '89abcdef0123456789abcdef0123456789abcdef',
      imageSource: 'source-build',
      supportsPromotionEvidence: false,
    });

    assert.equal(payload.imageSource, 'source-build');
    assert.equal(payload.supportsPromotionEvidence, false);
    assert.equal(payload.manifestBase64, '');
    assert.deepEqual(decodeDeployPayloadBase64(encodeDeployPayloadBase64(payload)), payload);
  });
});
