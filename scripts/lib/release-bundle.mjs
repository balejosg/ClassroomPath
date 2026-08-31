import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  parseOpenPathPromotionContractBytes,
  validateOpenPathPromotionContractV2,
} from './openpath-promotion-contract.mjs';

export const RELEASE_BUNDLE_SCHEMA_VERSION = 2;
export const RELEASE_BUNDLE_IMAGE_NAMES = Object.freeze([
  'gateway',
  'migrations',
  'openpathFirefoxAssets',
  'openpathApi',
  'spa',
  'verifier',
]);
export const OPENPATH_DERIVED_RELEASE_BUNDLE_IMAGE_NAMES = Object.freeze([
  'openpathFirefoxAssets',
  'openpathApi',
]);

const SHA40_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const OCI_DIGEST_PATTERN = /^[^@\s]+@sha256:[0-9a-f]{64}$/;

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object');
  }
}

function assertExactKeys(value, expectedKeys, label) {
  assertRecord(value, label);
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(label + ' contains unknown property ' + key);
    }
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(label + '.' + key + ' is required');
    }
  }
}

function assertSha40(value, label) {
  if (typeof value !== 'string' || !SHA40_PATTERN.test(value)) {
    throw new Error(label + ' must be a 40-character lowercase SHA');
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(label + ' must be a 64-character lowercase SHA-256 hex string');
  }
  return value;
}

function assertOciDigest(value, label) {
  if (typeof value !== 'string' || !OCI_DIGEST_PATTERN.test(value)) {
    throw new Error(label + ' must be an OCI repository@sha256 digest reference');
  }
  return value;
}

function normalizeImages(images) {
  assertExactKeys(images, RELEASE_BUNDLE_IMAGE_NAMES, 'images');
  return Object.fromEntries(
    RELEASE_BUNDLE_IMAGE_NAMES.map((name) => [
      name,
      assertOciDigest(images[name], 'images.' + name),
    ])
  );
}

export function validateReleaseBundle(bundle) {
  assertExactKeys(bundle, ['schemaVersion', 'classroomPathSha', 'openPath', 'images'], 'bundle');
  if (bundle.schemaVersion !== RELEASE_BUNDLE_SCHEMA_VERSION) {
    throw new Error('bundle.schemaVersion must be 2');
  }
  assertExactKeys(bundle.openPath, ['sourceSha', 'contractSha256'], 'openPath');
  return {
    schemaVersion: RELEASE_BUNDLE_SCHEMA_VERSION,
    classroomPathSha: assertSha40(bundle.classroomPathSha, 'classroomPathSha'),
    openPath: {
      sourceSha: assertSha40(bundle.openPath.sourceSha, 'openPath.sourceSha'),
      contractSha256: assertSha256(bundle.openPath.contractSha256, 'openPath.contractSha256'),
    },
    images: normalizeImages(bundle.images),
  };
}

export function buildReleaseBundle({ classroomPathSha, openPath, images } = {}) {
  return validateReleaseBundle({
    schemaVersion: RELEASE_BUNDLE_SCHEMA_VERSION,
    classroomPathSha,
    openPath,
    images,
  });
}

export function serializeReleaseBundle(bundle) {
  return JSON.stringify(validateReleaseBundle(bundle), null, 2) + '\n';
}

export function calculateReleaseId(bundleOrBytes) {
  const bytes =
    Buffer.isBuffer(bundleOrBytes) || bundleOrBytes instanceof Uint8Array
      ? Buffer.from(bundleOrBytes)
      : Buffer.from(
          typeof bundleOrBytes === 'string' ? bundleOrBytes : serializeReleaseBundle(bundleOrBytes),
          'utf8'
        );
  return createHash('sha256').update(bytes).digest('hex');
}

export const computeReleaseId = calculateReleaseId;

function requireBytes(bytes, label) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error(label + ' must be a byte array');
  }
  return Buffer.from(bytes);
}

export function buildReleaseBundleArtifacts({ bundle, contractBytes } = {}) {
  const validatedBundle = validateReleaseBundle(bundle);
  const exactContractBytes = requireBytes(contractBytes, 'contractBytes');
  const parsedContract = parseOpenPathPromotionContractBytes(exactContractBytes, {
    expectedOpenpathSha: validatedBundle.openPath.sourceSha,
  });
  if (parsedContract.contractSha256 !== validatedBundle.openPath.contractSha256) {
    throw new Error(
      'bundle openPath.contractSha256 does not match the exact OpenPath contract bytes'
    );
  }
  const bundleBytes = Buffer.from(serializeReleaseBundle(validatedBundle), 'utf8');
  return {
    bundle: validatedBundle,
    bundleBytes,
    contract: parsedContract.contract,
    contractBytes: exactContractBytes,
    contractSha256: parsedContract.contractSha256,
    releaseId: calculateReleaseId(bundleBytes),
  };
}

export const buildReleaseBundleArtifact = buildReleaseBundleArtifacts;

export function verifyReleaseBundleArtifacts({
  bundleBytes,
  contractBytes,
  expectedReleaseId,
  expectedClassroomPathSha,
  expectedOpenpathSha,
} = {}) {
  const exactBundleBytes = requireBytes(bundleBytes, 'bundleBytes');
  const exactContractBytes = requireBytes(contractBytes, 'contractBytes');
  let parsedBundle;
  try {
    parsedBundle = JSON.parse(exactBundleBytes.toString('utf8'));
  } catch (error) {
    throw new Error('invalid Release Bundle v2 JSON: ' + error.message, { cause: error });
  }
  const bundle = validateReleaseBundle(parsedBundle);
  const canonicalBytes = Buffer.from(serializeReleaseBundle(bundle), 'utf8');
  if (!canonicalBytes.equals(exactBundleBytes)) {
    throw new Error('Release Bundle v2 bytes are not canonical');
  }
  const releaseId = calculateReleaseId(exactBundleBytes);
  if (expectedReleaseId !== undefined && releaseId !== expectedReleaseId) {
    throw new Error(
      'Release Bundle v2 releaseId ' +
        releaseId +
        ' does not match expected releaseId ' +
        expectedReleaseId
    );
  }
  if (
    expectedClassroomPathSha !== undefined &&
    bundle.classroomPathSha !== expectedClassroomPathSha
  ) {
    throw new Error('Release Bundle v2 classroomPathSha does not match expected ClassroomPath SHA');
  }
  const parsedContract = parseOpenPathPromotionContractBytes(exactContractBytes, {
    expectedOpenpathSha: expectedOpenpathSha ?? bundle.openPath.sourceSha,
  });
  if (parsedContract.contractSha256 !== bundle.openPath.contractSha256) {
    throw new Error(
      'Release Bundle v2 contractSha256 does not match the exact OpenPath contract bytes'
    );
  }
  return {
    bundle,
    bundleBytes: exactBundleBytes,
    contract: parsedContract.contract,
    contractBytes: exactContractBytes,
    contractSha256: parsedContract.contractSha256,
    releaseId,
  };
}

export const verifyReleaseBundle = verifyReleaseBundleArtifacts;

function writeAtomic(path, bytes) {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const temporaryPath = absolutePath + '.tmp-' + process.pid + '-' + randomUUID();
  writeFileSync(temporaryPath, bytes);
  renameSync(temporaryPath, absolutePath);
  return absolutePath;
}

export function writeReleaseBundleArtifacts({
  outputDir,
  bundlePath,
  contractPath,
  bundle,
  contractBytes,
} = {}) {
  const artifact = buildReleaseBundleArtifacts({ bundle, contractBytes });
  const outputDirectory = outputDir ? resolve(outputDir) : '';
  const resolvedBundlePath =
    bundlePath ||
    (outputDirectory ? resolve(outputDirectory, 'classroompath-release-bundle.json') : '');
  const resolvedContractPath =
    contractPath ||
    (outputDirectory ? resolve(outputDirectory, 'openpath-promotion-contract.json') : '');
  if (!resolvedBundlePath || !resolvedContractPath) {
    throw new Error('outputDir or both bundlePath and contractPath are required');
  }
  const writtenBundlePath = writeAtomic(resolvedBundlePath, artifact.bundleBytes);
  const writtenContractPath = writeAtomic(resolvedContractPath, artifact.contractBytes);
  return {
    ...artifact,
    bundlePath: writtenBundlePath,
    contractPath: writtenContractPath,
  };
}

export function projectOpenPathContractToLegacyRuntime({ contract, contractSha256 = '' } = {}) {
  const validatedContract = validateOpenPathPromotionContractV2(contract);
  const linux = validatedContract.components.linuxAgent;
  const windows = validatedContract.components.windowsOfflineInstaller;
  const projection = {
    OPENPATH_SHA: validatedContract.openpathSha,
    OPENPATH_VERSION: validatedContract.openpathVersion,
    OPENPATH_LINUX_AGENT_VERSION: linux.packageVersion,
    OPENPATH_LINUX_AGENT_APT_SUITE: linux.aptSuite,
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION: windows.version,
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT: windows.sourceSha,
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG: windows.releaseTag,
    OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256: windows.templateSha256,
  };
  if (contractSha256) {
    projection.OPENPATH_CONTRACT_SHA256 = assertSha256(contractSha256, 'contractSha256');
  }
  return projection;
}

export function projectReleaseBundleToRuntimeEnv({
  bundle,
  contract,
  contractSha256,
  releaseId,
  imageSource = 'release-candidate',
} = {}) {
  const validatedBundle = validateReleaseBundle(bundle);
  const expectedReleaseId = calculateReleaseId(validatedBundle);
  if (releaseId !== undefined && releaseId !== expectedReleaseId) {
    throw new Error('release bundle runtime projection releaseId does not match bundle bytes');
  }
  const projection = projectOpenPathContractToLegacyRuntime({
    contract,
    contractSha256: contractSha256 ?? validatedBundle.openPath.contractSha256,
  });
  if (projection.OPENPATH_SHA !== validatedBundle.openPath.sourceSha) {
    throw new Error('release bundle runtime projection OpenPath SHA does not match bundle');
  }
  return {
    RELEASE_ID: expectedReleaseId,
    IMAGE_SOURCE: imageSource,
    APP_SHA: validatedBundle.classroomPathSha,
    OPENPATH_SHA: validatedBundle.openPath.sourceSha,
    OPENPATH_CONTRACT_SHA256: validatedBundle.openPath.contractSha256,
    CLASSROOMPATH_GATEWAY_IMAGE: validatedBundle.images.gateway,
    CLASSROOMPATH_MIGRATIONS_IMAGE: validatedBundle.images.migrations,
    OPENPATH_FIREFOX_ASSETS_IMAGE: validatedBundle.images.openpathFirefoxAssets,
    OPENPATH_API_IMAGE: validatedBundle.images.openpathApi,
    CLASSROOMPATH_SPA_IMAGE: validatedBundle.images.spa,
    CLASSROOMPATH_VERIFIER_IMAGE: validatedBundle.images.verifier,
    ...projection,
  };
}

export function shouldRebuildOpenPathDerivedImages({
  previousContractSha256,
  currentContractSha256,
} = {}) {
  const current = assertSha256(currentContractSha256, 'currentContractSha256');
  const previous = String(previousContractSha256 ?? '').trim();
  if (!previous) return true;
  assertSha256(previous, 'previousContractSha256');
  return previous !== current;
}
