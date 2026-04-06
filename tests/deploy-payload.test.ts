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
      manifestBase64: 'bWFuaWZlc3Q=',
    });

    assert.equal(payload.version, 1);
    assert.equal(payload.targetEnvironment, 'production');
    assert.equal(payload.deployRef, 'refs/tags/v1.2.99');
    assert.equal(payload.deploySha, '0123456789abcdef0123456789abcdef01234567');
    assert.equal(payload.manifestBase64, 'bWFuaWZlc3Q=');
  });

  test('round-trips through base64 transport encoding', () => {
    const payload = buildDeployPayload({
      targetEnvironment: 'staging',
      deployRef: 'refs/heads/main',
      deploySha: '89abcdef0123456789abcdef0123456789abcdef',
      manifestBase64: 'bWFuaWZlc3Q=',
    });

    const encoded = encodeDeployPayloadBase64(payload);
    const decoded = decodeDeployPayloadBase64(encoded);

    assert.deepEqual(decoded, payload);
  });
});
