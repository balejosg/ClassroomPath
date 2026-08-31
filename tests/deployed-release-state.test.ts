import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  parseDeployedReleaseState,
  serializeDeployedReleaseStateOutputs,
} from '../scripts/lib/deployed-release-state.mjs';

const RELEASE_ID = '1'.repeat(64);
const OPENPATH_SHA = '2'.repeat(40);
const CONTRACT_SHA = '3'.repeat(64);
const IMAGE = 'ghcr.io/balejosg/classroompath-verifier@sha256:' + '4'.repeat(64);

function runtimeEnv(overrides: Record<string, string> = {}) {
  const base = [
    `RELEASE_ID=${RELEASE_ID}`,
    'RC_RUN_ID=123456789',
    'IMAGE_SOURCE=release-candidate',
    `APP_SHA=${'5'.repeat(40)}`,
    `OPENPATH_SHA=${OPENPATH_SHA}`,
    `OPENPATH_CONTRACT_SHA256=${CONTRACT_SHA}`,
    `CLASSROOMPATH_GATEWAY_IMAGE=${IMAGE}`,
    `CLASSROOMPATH_MIGRATIONS_IMAGE=${IMAGE}`,
    `OPENPATH_FIREFOX_ASSETS_IMAGE=${IMAGE}`,
    `OPENPATH_API_IMAGE=${IMAGE}`,
    `CLASSROOMPATH_SPA_IMAGE=${IMAGE}`,
    `CLASSROOMPATH_VERIFIER_IMAGE=${IMAGE}`,
  ];
  const values = new Map(
    base.map((line) => line.split('=', 1)[0]).map((key, index) => [key, base[index]])
  );
  for (const [key, value] of Object.entries(overrides)) {
    values.set(key, `${key}=${value}`);
  }
  return `${[...values.values()].join('\n')}\n`;
}

describe('deployed Release Bundle v2 state', () => {
  test('accepts the exact current pointer and immutable runtime projection', () => {
    const parsed = parseDeployedReleaseState({
      runtimeText: runtimeEnv(),
      pointerReleaseId: RELEASE_ID,
    });

    assert.deepEqual(parsed, {
      releaseId: RELEASE_ID,
      rcRunId: '123456789',
      verifierImage: IMAGE,
      openpathSha: OPENPATH_SHA,
      openpathContractSha256: CONTRACT_SHA,
      appSha: '5'.repeat(40),
    });
    assert.match(
      serializeDeployedReleaseStateOutputs(parsed),
      new RegExp(`release_id=${RELEASE_ID}`)
    );
  });

  test('fails closed when the pointer and runtime identity differ', () => {
    assert.throws(
      () =>
        parseDeployedReleaseState({
          runtimeText: runtimeEnv(),
          pointerReleaseId: '6'.repeat(64),
        }),
      /pointer releaseId does not match runtime RELEASE_ID/
    );
  });

  test('fails closed for source-build or mutable verifier references', () => {
    assert.throws(
      () =>
        parseDeployedReleaseState({
          runtimeText: runtimeEnv({
            IMAGE_SOURCE: 'source-build',
          }),
          pointerReleaseId: RELEASE_ID,
        }),
      /IMAGE_SOURCE must be release-candidate/
    );

    assert.throws(
      () =>
        parseDeployedReleaseState({
          runtimeText: runtimeEnv({
            CLASSROOMPATH_VERIFIER_IMAGE: 'ghcr.io/example/verifier:latest',
          }),
          pointerReleaseId: RELEASE_ID,
        }),
      /CLASSROOMPATH_VERIFIER_IMAGE must be an OCI digest/
    );

    assert.throws(
      () =>
        parseDeployedReleaseState({
          runtimeText: runtimeEnv({ RC_RUN_ID: 'not-a-run' }),
          pointerReleaseId: RELEASE_ID,
        }),
      /RC_RUN_ID must be a numeric GitHub run id/
    );
  });
});
