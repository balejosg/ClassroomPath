#!/usr/bin/env node
// @ts-check

import { execFile as nodeExecFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(nodeExecFile);

export const LEGACY_ARTIFACT_VOLUME_KEY = 'windows-offline-installer-artifacts';
export const CANONICAL_ARTIFACT_VOLUME_KEY = 'windows_offline_installer_artifacts';
export const LEGACY_RETIREMENT_CONFIRMATION_FLAG =
  '--confirm-windows-offline-installer-legacy-retirement';
export const LEGACY_RETIREMENT_CONFIRMATION_ENV =
  'CLASSROOMPATH_WINDOWS_OFFLINE_LEGACY_RETIREMENT_CONFIRMED';

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_VOLUME_LABEL = 'com.docker.compose.volume';
const COMPOSE_CONFIG_HASH_LABEL = 'com.docker.compose.config-hash';
const COMPOSE_VERSION_LABEL = 'com.docker.compose.version';
const KNOWN_COMPOSE_VOLUME_LABELS = new Set([
  COMPOSE_PROJECT_LABEL,
  COMPOSE_VOLUME_LABEL,
  COMPOSE_CONFIG_HASH_LABEL,
  COMPOSE_VERSION_LABEL,
]);
const SAFE_PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/u;

/** @typedef {{status: number, stdout: string, stderr: string}} DockerCommandResult */
/** @typedef {(args: string[]) => Promise<DockerCommandResult>} DockerRunner */

/**
 * Runs Docker without a shell and normalizes non-zero exits into a result so
 * the caller can distinguish a missing volume from a failed daemon operation.
 * @param {string[]} args
 * @returns {Promise<DockerCommandResult>}
 */
async function runDockerCommand(args) {
  try {
    const result = await execFile('docker', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 });
    return {
      status: 0,
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  } catch (error) {
    const details = /** @type {{code?: number, stdout?: string, stderr?: string}} */ (error);
    return {
      status: typeof details.code === 'number' ? details.code : 1,
      stdout: String(details.stdout ?? ''),
      stderr: String(details.stderr ?? ''),
    };
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function requireProjectName(value) {
  const projectName = String(value ?? '').trim();
  if (!projectName || !SAFE_PROJECT_NAME.test(projectName)) {
    throw new Error('an explicit valid Compose project name is required');
  }
  return projectName;
}

/**
 * @param {string} stdout
 * @returns {string[]}
 */
function parseVolumeNames(stdout) {
  return stdout
    .split(/\r?\n/u)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * @param {string} stdout
 * @param {string} expectedName
 * @param {string} expectedProjectName
 */
function parseAndValidateVolumeInspection(stdout, expectedName, expectedProjectName) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('legacy installer volume inspection is not valid JSON');
  }

  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('legacy installer volume identity is ambiguous');
  }

  const volume = parsed[0];
  const labels = volume?.Labels;
  const unexpectedLabels =
    labels && typeof labels === 'object' && !Array.isArray(labels)
      ? Object.keys(labels).filter((label) => !KNOWN_COMPOSE_VOLUME_LABELS.has(label))
      : [];
  const optionalComposeLabelsAreValid =
    labels && typeof labels === 'object' && !Array.isArray(labels)
      ? [COMPOSE_CONFIG_HASH_LABEL, COMPOSE_VERSION_LABEL].every(
          (label) =>
            !(label in labels) || (typeof labels[label] === 'string' && labels[label].length > 0)
        )
      : false;
  if (
    !volume ||
    typeof volume !== 'object' ||
    volume.Name !== expectedName ||
    volume.Driver !== 'local' ||
    !labels ||
    typeof labels !== 'object' ||
    Array.isArray(labels) ||
    labels[COMPOSE_PROJECT_LABEL] !== expectedProjectName ||
    labels[COMPOSE_VOLUME_LABEL] !== LEGACY_ARTIFACT_VOLUME_KEY ||
    unexpectedLabels.length > 0 ||
    !optionalComposeLabelsAreValid
  ) {
    throw new Error('legacy installer volume identity or labels are unexpected');
  }

  return volume;
}

/**
 * @param {{
 *   projectName?: string,
 *   confirmed?: boolean,
 *   runDocker?: DockerRunner,
 * }} options
 * @returns {Promise<{status: 'removed'|'absent', volumeName: string}>}
 */
export async function retireLegacyWindowsOfflineInstallerStorage({
  projectName,
  confirmed = false,
  runDocker = runDockerCommand,
} = {}) {
  if (!confirmed) {
    throw new Error(
      `explicit legacy-retirement confirmation is required: ${LEGACY_RETIREMENT_CONFIRMATION_FLAG}`
    );
  }

  const normalizedProjectName = requireProjectName(projectName);
  const legacyVolumeName = `${normalizedProjectName}_${LEGACY_ARTIFACT_VOLUME_KEY}`;
  const canonicalVolumeName = `${normalizedProjectName}_${CANONICAL_ARTIFACT_VOLUME_KEY}`;

  if (legacyVolumeName === canonicalVolumeName) {
    throw new Error('legacy and canonical installer volume identities must differ');
  }

  const listed = await runDocker([
    'volume',
    'ls',
    '--filter',
    `label=${COMPOSE_PROJECT_LABEL}=${normalizedProjectName}`,
    '--filter',
    `label=${COMPOSE_VOLUME_LABEL}=${LEGACY_ARTIFACT_VOLUME_KEY}`,
    '--format',
    '{{.Name}}',
  ]);
  if (listed.status !== 0) {
    throw new Error('could not resolve legacy installer volume through Docker labels');
  }

  const candidateNames = parseVolumeNames(listed.stdout);
  if (candidateNames.includes(canonicalVolumeName)) {
    throw new Error('canonical OpenPath installer volume appeared in the legacy candidate set');
  }
  if (
    candidateNames.length > 1 ||
    (candidateNames.length === 1 && candidateNames[0] !== legacyVolumeName)
  ) {
    throw new Error('legacy installer volume identity is ambiguous or unexpected');
  }

  const inspected = await runDocker(['volume', 'inspect', legacyVolumeName]);
  if (inspected.status !== 0) {
    if (candidateNames.length > 0) {
      throw new Error('legacy installer volume disappeared during identity verification');
    }
    return { status: 'absent', volumeName: legacyVolumeName };
  }

  if (candidateNames.length !== 1 || candidateNames[0] !== legacyVolumeName) {
    throw new Error('legacy installer volume labels do not match the exact candidate name');
  }

  parseAndValidateVolumeInspection(inspected.stdout, legacyVolumeName, normalizedProjectName);

  const removed = await runDocker(['volume', 'rm', legacyVolumeName]);
  if (removed.status !== 0) {
    throw new Error('legacy installer volume could not be retired; it may still be in use');
  }

  return { status: 'removed', volumeName: legacyVolumeName };
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
function parseCliArgs(argv, env) {
  let cliProjectName;
  let confirmed = env[LEGACY_RETIREMENT_CONFIRMATION_ENV] === '1';

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === LEGACY_RETIREMENT_CONFIRMATION_FLAG) {
      confirmed = true;
      continue;
    }
    if (argument === '--project-name') {
      cliProjectName = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  const environmentProjectName = env.COMPOSE_PROJECT_NAME?.trim();
  if (cliProjectName && environmentProjectName && cliProjectName !== environmentProjectName) {
    throw new Error('CLI project name and COMPOSE_PROJECT_NAME must match');
  }

  return {
    projectName: cliProjectName ?? environmentProjectName,
    confirmed,
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2), process.env);
  const result = await retireLegacyWindowsOfflineInstallerStorage(options);
  process.stdout.write(`legacy installer storage ${result.status}: ${result.volumeName}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'legacy retirement failed'}\n`
    );
    process.exitCode = 1;
  });
}
