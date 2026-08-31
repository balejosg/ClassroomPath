/**
 * Immutable Release Bundle v2 state on deployment hosts.
 *
 * Each release is self-contained under releases/<releaseId>. The current and
 * previous files contain only release IDs; runtime.env is a generated
 * projection and never a second release authority.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  projectReleaseBundleToRuntimeEnv,
  verifyReleaseBundleArtifacts,
} from './release-bundle.mjs';
import { parseReleaseStateText, shellQuote } from './release-state-contract.mjs';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RUN_ID_PATTERN = /^[0-9]+$/;

function normalizeStateRoot(stateRoot) {
  const rawRoot = String(stateRoot ?? '').trim();
  if (!rawRoot) {
    throw new Error('stateRoot is required and must not be filesystem root');
  }
  const root = resolve(rawRoot);
  if (root === resolve('/')) {
    throw new Error('stateRoot is required and must not be filesystem root');
  }
  return root;
}

function assertPointerName(pointer) {
  const normalized = String(pointer ?? '').trim();
  if (normalized !== 'current' && normalized !== 'previous') {
    throw new Error('release state pointer must be current or previous');
  }
  return normalized;
}

function assertReleaseId(value) {
  const normalized = String(value ?? '').trim();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new Error('releaseId must be a 64-character lowercase SHA-256 hex string');
  }
  return normalized;
}

function normalizeRcRunId(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!RUN_ID_PATTERN.test(normalized)) {
    throw new Error('rcRunId must be a numeric GitHub run id');
  }
  return normalized;
}

function writeAtomic(path, bytes) {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const temporaryPath =
    absolutePath + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2);
  writeFileSync(temporaryPath, bytes);
  renameSync(temporaryPath, absolutePath);
  return absolutePath;
}

function writeImmutable(path, bytes) {
  const absolutePath = resolve(path);
  try {
    const existing = readFileSync(absolutePath);
    if (!existing.equals(Buffer.from(bytes))) {
      throw new Error('existing immutable release artifact differs: ' + absolutePath);
    }
    return absolutePath;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return writeAtomic(absolutePath, bytes);
  }
}

export function buildReleaseStatePaths(stateRoot, releaseId) {
  const root = normalizeStateRoot(stateRoot);
  const id = assertReleaseId(releaseId);
  const releaseDir = resolve(root, 'releases', id);
  return {
    stateRoot: root,
    releasesDir: resolve(root, 'releases'),
    releaseId: id,
    releaseDir,
    bundlePath: resolve(releaseDir, 'classroompath-release-bundle.json'),
    contractPath: resolve(releaseDir, 'openpath-promotion-contract.json'),
    runtimePath: resolve(releaseDir, 'runtime.env'),
    currentPointerPath: resolve(root, 'current'),
    previousPointerPath: resolve(root, 'previous'),
  };
}

function readPointer(path) {
  try {
    return assertReleaseId(readFileSync(path, 'utf8').trim());
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function readReleaseIdPointer(path) {
  return readPointer(resolve(path));
}

export function readReleaseStatePointer({ stateRoot, pointer = 'current' } = {}) {
  const root = normalizeStateRoot(stateRoot);
  const name = assertPointerName(pointer);
  return readPointer(resolve(root, name));
}

function serializeRuntimeEnv(runtime) {
  return (
    Object.entries(runtime)
      .map(([key, value]) => key + '=' + shellQuote(value))
      .join('\n') + '\n'
  );
}

function verifyRuntimeBytes({ bundle, contract, contractSha256, releaseId, runtimeBytes } = {}) {
  const assignments = parseReleaseStateText(Buffer.from(runtimeBytes).toString('utf8'));
  const rcRunId = assignments.RC_RUN_ID ? normalizeRcRunId(assignments.RC_RUN_ID) : '';
  const expectedRuntime = projectReleaseBundleToRuntimeEnv({
    bundle,
    contract,
    contractSha256,
    releaseId,
  });
  const expectedBytes = Buffer.from(
    serializeRuntimeEnv({
      ...expectedRuntime,
      ...(rcRunId ? { RC_RUN_ID: rcRunId } : {}),
    }),
    'utf8'
  );
  if (!expectedBytes.equals(Buffer.from(runtimeBytes))) {
    throw new Error('stored Release Bundle v2 runtime projection differs from its bundle');
  }
  return rcRunId;
}

export function persistReleaseStateRelease({ stateRoot, verified, rcRunId } = {}) {
  if (!verified?.bundleBytes || !verified?.contractBytes) {
    throw new Error('verified Release Bundle bytes are required');
  }
  const checked = verifyReleaseBundleArtifacts({
    bundleBytes: verified.bundleBytes,
    contractBytes: verified.contractBytes,
    expectedReleaseId: verified.releaseId,
  });
  const paths = buildReleaseStatePaths(stateRoot, checked.releaseId);
  mkdirSync(paths.releaseDir, { recursive: true });
  writeImmutable(paths.bundlePath, checked.bundleBytes);
  writeImmutable(paths.contractPath, checked.contractBytes);
  const normalizedRcRunId = normalizeRcRunId(rcRunId);
  const runtime = {
    ...projectReleaseBundleToRuntimeEnv({
      bundle: checked.bundle,
      contract: checked.contract,
      contractSha256: checked.contractSha256,
      releaseId: checked.releaseId,
    }),
    ...(normalizedRcRunId ? { RC_RUN_ID: normalizedRcRunId } : {}),
  };
  writeImmutable(paths.runtimePath, Buffer.from(serializeRuntimeEnv(runtime), 'utf8'));
  return { ...checked, paths, runtime };
}

export function readReleaseStateRelease({ stateRoot, releaseId } = {}) {
  const paths = buildReleaseStatePaths(stateRoot, releaseId);
  const checked = verifyReleaseBundleArtifacts({
    bundleBytes: readFileSync(paths.bundlePath),
    contractBytes: readFileSync(paths.contractPath),
    expectedReleaseId: paths.releaseId,
  });
  const runtimeBytes = readFileSync(paths.runtimePath);
  verifyRuntimeBytes({
    bundle: checked.bundle,
    contract: checked.contract,
    contractSha256: checked.contractSha256,
    releaseId: checked.releaseId,
    runtimeBytes,
  });
  return {
    ...checked,
    paths,
    runtimeBytes,
  };
}

export function activateReleaseState({ stateRoot, releaseId, readinessCheck } = {}) {
  const target = readReleaseStateRelease({ stateRoot, releaseId });
  const paths = target.paths;
  mkdirSync(paths.stateRoot, { recursive: true });
  const currentReleaseId = readPointer(paths.currentPointerPath);
  const previousReleaseId = readPointer(paths.previousPointerPath);
  if (!currentReleaseId && previousReleaseId) {
    throw new Error('Release state has a previous pointer without a current pointer');
  }
  if (currentReleaseId === target.releaseId) {
    if (typeof readinessCheck === 'function' && readinessCheck(target) === false) {
      throw new Error('Release Bundle v2 readiness check failed');
    }
    return { ...target, currentReleaseId: target.releaseId, previousReleaseId };
  }
  let currentRelease = null;
  if (currentReleaseId) {
    currentRelease = readReleaseStateRelease({ stateRoot, releaseId: currentReleaseId });
  }
  if (typeof readinessCheck === 'function') {
    const ready = readinessCheck(target, currentRelease);
    if (ready === false) throw new Error('Release Bundle v2 readiness check failed');
  }
  if (currentReleaseId) {
    writeAtomic(paths.previousPointerPath, Buffer.from(currentReleaseId + '\n', 'utf8'));
  }
  writeAtomic(paths.currentPointerPath, Buffer.from(target.releaseId + '\n', 'utf8'));
  return {
    ...target,
    currentReleaseId: target.releaseId,
    previousReleaseId: currentReleaseId ?? null,
  };
}

export function readActiveReleaseState({ stateRoot } = {}) {
  const root = normalizeStateRoot(stateRoot);
  const currentReleaseId = readReleaseStatePointer({ stateRoot: root, pointer: 'current' });
  if (!currentReleaseId) throw new Error('Release state current pointer is missing');
  const paths = buildReleaseStatePaths(root, currentReleaseId);
  const previousReleaseId = readPointer(paths.previousPointerPath);
  return {
    ...readReleaseStateRelease({ stateRoot: root, releaseId: currentReleaseId }),
    currentReleaseId,
    previousReleaseId,
  };
}

export function readReleaseStateAtPointer({ stateRoot, pointer = 'current' } = {}) {
  const root = normalizeStateRoot(stateRoot);
  const name = assertPointerName(pointer);
  const releaseId = readReleaseStatePointer({ stateRoot: root, pointer: name });
  if (!releaseId) {
    throw new Error('Release state ' + name + ' pointer is missing');
  }
  return {
    ...readReleaseStateRelease({ stateRoot: root, releaseId }),
    pointer: name,
  };
}

/**
 * Captures the currently active immutable release as the rollback target
 * before a new release mutates the runtime. The operation is idempotent and
 * verifies the complete current release before publishing the pointer.
 */
export function capturePreviousReleaseState({ stateRoot } = {}) {
  const root = normalizeStateRoot(stateRoot);
  const currentReleaseId = readReleaseStatePointer({ stateRoot: root, pointer: 'current' });
  if (!currentReleaseId) {
    const previousReleaseId = readReleaseStatePointer({ stateRoot: root, pointer: 'previous' });
    if (previousReleaseId) {
      throw new Error('Release state has a previous pointer without a current pointer');
    }
    return null;
  }

  const currentRelease = readReleaseStateRelease({ stateRoot: root, releaseId: currentReleaseId });
  const paths = currentRelease.paths;
  const previousReleaseId = readReleaseStatePointer({ stateRoot: root, pointer: 'previous' });
  if (previousReleaseId !== currentRelease.releaseId) {
    writeAtomic(paths.previousPointerPath, Buffer.from(currentRelease.releaseId + '\n', 'utf8'));
  }
  return {
    ...currentRelease,
    previousReleaseId: currentRelease.releaseId,
  };
}

function parseCliArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error('Unknown argument: ' + token);
    const key = token.slice(2).replaceAll('-', '');
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(token + ' requires a value');
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function requiredOption(options, key) {
  const value = String(options[key] ?? '').trim();
  if (!value) throw new Error('--' + key + ' is required');
  return value;
}

export function runReleaseBundleStateCli(argv = process.argv.slice(2)) {
  const { command, options } = parseCliArgs(argv);
  const stateRoot = requiredOption(options, 'stateroot');

  if (command === 'persist') {
    const bundleBytes = readFileSync(requiredOption(options, 'bundlefile'));
    const contractBytes = readFileSync(requiredOption(options, 'contractfile'));
    const verified = verifyReleaseBundleArtifacts({
      bundleBytes,
      contractBytes,
      expectedReleaseId: options.releaseid,
    });
    const persisted = persistReleaseStateRelease({
      stateRoot,
      verified,
      rcRunId: options.rcrunid,
    });
    process.stdout.write(JSON.stringify({ releaseId: persisted.releaseId }) + '\n');
    return persisted;
  }

  if (command === 'activate') {
    const activated = activateReleaseState({
      stateRoot,
      releaseId: requiredOption(options, 'releaseid'),
    });
    process.stdout.write(
      JSON.stringify({
        releaseId: activated.currentReleaseId,
        previousReleaseId: activated.previousReleaseId,
      }) + '\n'
    );
    return activated;
  }

  if (command === 'capture-previous') {
    const captured = capturePreviousReleaseState({ stateRoot });
    process.stdout.write(
      JSON.stringify({
        releaseId: captured?.releaseId ?? null,
        previousReleaseId: captured?.previousReleaseId ?? null,
      }) + '\n'
    );
    return captured;
  }

  if (command === 'activate-previous') {
    const active = readActiveReleaseState({ stateRoot });
    if (!active.previousReleaseId) {
      throw new Error('Release state previous pointer is missing');
    }
    const activated = activateReleaseState({
      stateRoot,
      releaseId: active.previousReleaseId,
    });
    process.stdout.write(
      JSON.stringify({
        releaseId: activated.currentReleaseId,
        previousReleaseId: activated.previousReleaseId,
      }) + '\n'
    );
    return activated;
  }

  if (command === 'read') {
    const pointer = options.pointer ?? 'current';
    const release = readReleaseStateAtPointer({ stateRoot, pointer });
    if (options.outputenv) {
      writeAtomic(options.outputenv, release.runtimeBytes);
    }
    const result = {
      pointer: release.pointer,
      releaseId: release.releaseId,
      classroomPathSha: release.bundle.classroomPathSha,
      openpathSha: release.bundle.openPath.sourceSha,
      contractSha256: release.contractSha256,
      bundlePath: release.paths.bundlePath,
      contractPath: release.paths.contractPath,
      runtimePath: release.paths.runtimePath,
    };
    process.stdout.write(JSON.stringify(result) + '\n');
    return result;
  }

  throw new Error('Unknown release bundle state command: ' + command);
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFilePath)) {
  try {
    runReleaseBundleStateCli();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
