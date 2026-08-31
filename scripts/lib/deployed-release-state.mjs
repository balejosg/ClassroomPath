/**
 * Parses the immutable runtime projection addressed by a deployed Release
 * Bundle v2 `current` pointer.
 *
 * The parser deliberately does not source shell data. It validates the
 * pointer/runtime identity and every image reference before exposing values to
 * a smoke-test workflow.
 */

const SHA40_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RUN_ID_PATTERN = /^[0-9]+$/;
const OCI_DIGEST_PATTERN = /^[^@\s]+@sha256:[0-9a-f]{64}$/;

const REQUIRED_IMAGE_KEYS = Object.freeze([
  'CLASSROOMPATH_GATEWAY_IMAGE',
  'CLASSROOMPATH_MIGRATIONS_IMAGE',
  'OPENPATH_FIREFOX_ASSETS_IMAGE',
  'OPENPATH_API_IMAGE',
  'CLASSROOMPATH_SPA_IMAGE',
  'CLASSROOMPATH_VERIFIER_IMAGE',
]);

function requiredValue(assignments, key) {
  const value = String(assignments[key] ?? '').trim();
  if (!value) {
    throw new Error(`${key} is missing from deployed Release Bundle v2 runtime state`);
  }
  return value;
}

function assertSha40(value, label) {
  if (!SHA40_PATTERN.test(value)) {
    throw new Error(`${label} must be a 40-character lowercase SHA`);
  }
  return value;
}

function assertSha256(value, label) {
  if (!SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a 64-character lowercase SHA-256 hex string`);
  }
  return value;
}

function assertRunId(value, label) {
  if (!RUN_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a numeric GitHub run id`);
  }
  return value;
}

function assertOciDigest(value, label) {
  if (!OCI_DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} must be an OCI digest`);
  }
  return value;
}

export function parseRuntimeEnvironmentText(runtimeText) {
  const assignments = {};
  for (const [index, line] of String(runtimeText ?? '')
    .split(/\r?\n/)
    .entries()) {
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(`invalid runtime state line ${index + 1}`);
    }
    const key = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`invalid runtime state key ${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(assignments, key)) {
      throw new Error(`duplicate runtime state key ${key}`);
    }
    assignments[key] = line.slice(separator + 1);
  }
  return assignments;
}

export function parseDeployedReleaseState({ runtimeText, pointerReleaseId } = {}) {
  const assignments = parseRuntimeEnvironmentText(runtimeText);
  const pointer = assertSha256(String(pointerReleaseId ?? '').trim(), 'pointer releaseId');
  const releaseId = assertSha256(requiredValue(assignments, 'RELEASE_ID'), 'RELEASE_ID');
  if (pointer !== releaseId) {
    throw new Error('pointer releaseId does not match runtime RELEASE_ID');
  }

  const imageSource = requiredValue(assignments, 'IMAGE_SOURCE');
  if (imageSource !== 'release-candidate') {
    throw new Error('IMAGE_SOURCE must be release-candidate');
  }

  const appSha = assertSha40(requiredValue(assignments, 'APP_SHA'), 'APP_SHA');
  const rcRunId = assertRunId(requiredValue(assignments, 'RC_RUN_ID'), 'RC_RUN_ID');
  const openpathSha = assertSha40(requiredValue(assignments, 'OPENPATH_SHA'), 'OPENPATH_SHA');
  const openpathContractSha256 = assertSha256(
    requiredValue(assignments, 'OPENPATH_CONTRACT_SHA256'),
    'OPENPATH_CONTRACT_SHA256'
  );

  for (const key of REQUIRED_IMAGE_KEYS) {
    assertOciDigest(requiredValue(assignments, key), key);
  }

  return {
    releaseId,
    rcRunId,
    verifierImage: requiredValue(assignments, 'CLASSROOMPATH_VERIFIER_IMAGE'),
    openpathSha,
    openpathContractSha256,
    appSha,
  };
}

export function serializeDeployedReleaseStateOutputs(state) {
  return [
    `release_id=${state.releaseId}`,
    `rc_run_id=${state.rcRunId}`,
    `verifier_image=${state.verifierImage}`,
    `openpath_sha=${state.openpathSha}`,
    `openpath_contract_sha256=${state.openpathContractSha256}`,
    `app_sha=${state.appSha}`,
    '',
  ].join('\n');
}
