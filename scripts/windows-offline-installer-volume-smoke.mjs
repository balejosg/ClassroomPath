#!/usr/bin/env node
// @ts-check

import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dockerfilePath = resolve(projectRoot, 'docker/Dockerfile.api');
const dockerContext = resolve(projectRoot, 'upstream/openpath');
const templatesTarget = '/app/var/windows-offline-installer/templates';
const artifactsTarget = '/app/var/windows-offline-installer/artifacts';

/**
 * @param {string[]} args
 * @returns {Promise<void>}
 */
function runDocker(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    child.once('error', () => {
      reject(new Error('Docker command could not start'));
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`Docker command failed: ${args[0] ?? 'unknown'} (${code ?? 'unknown'})`));
      }
    });
  });
}

/**
 * @param {string} image
 * @param {string} templatesVolume
 * @param {string} artifactsVolume
 * @returns {Promise<void>}
 */
async function runRuntimeChecks(image, templatesVolume, artifactsVolume) {
  const provisionerProbe = [
    'set -eu',
    'test "$(id -u)" -ne 0',
    `test "$(stat -c '%a' '${templatesTarget}')" = 755`,
    `test "$(stat -c '%u:%g' '${templatesTarget}')" = "$(id -u):$(id -g)"`,
    `mkdir -p '${templatesTarget}/generations/generation-probe'`,
    `printf 'template-probe\\n' > '${templatesTarget}/generations/generation-probe/template.txt'`,
  ].join('\n');

  await runDocker([
    'run',
    '--rm',
    '--user',
    'node',
    '--mount',
    `type=volume,source=${templatesVolume},target=${templatesTarget}`,
    image,
    'sh',
    '-eu',
    '-c',
    provisionerProbe,
  ]);

  const apiProbe = [
    'set -eu',
    'test "$(id -u)" -ne 0',
    `test "$(stat -c '%a' '${templatesTarget}')" = 755`,
    `test "$(stat -c '%a' '${artifactsTarget}')" = 700`,
    `test "$(stat -c '%u:%g' '${artifactsTarget}')" = "$(id -u):$(id -g)"`,
    `test -s '${templatesTarget}/generations/generation-probe/template.txt'`,
    `if touch '${templatesTarget}/must-not-write' 2>/dev/null; then exit 1; fi`,
    `printf 'artifact-probe\\n' > '${artifactsTarget}/probe.exe'`,
    `test -s '${artifactsTarget}/probe.exe'`,
  ].join('\n');

  await runDocker([
    'run',
    '--rm',
    '--user',
    'node',
    '--mount',
    `type=volume,source=${templatesVolume},target=${templatesTarget},readonly`,
    '--mount',
    `type=volume,source=${artifactsVolume},target=${artifactsTarget}`,
    image,
    'sh',
    '-eu',
    '-c',
    apiProbe,
  ]);

  const unprivilegedArtifactProbe = [
    'set -eu',
    `if test -r '${artifactsTarget}/probe.exe'; then exit 1; fi`,
    `if touch '${artifactsTarget}/must-not-write' 2>/dev/null; then exit 1; fi`,
  ].join('\n');

  await runDocker([
    'run',
    '--rm',
    '--user',
    '65532:65532',
    '--mount',
    `type=volume,source=${artifactsVolume},target=${artifactsTarget}`,
    image,
    'sh',
    '-eu',
    '-c',
    unprivilegedArtifactProbe,
  ]);
}

/**
 * Build the actual ClassroomPath API image and exercise fresh named volumes
 * with the same non-root user and mount modes used by Compose.
 *
 * The generated names are unique and every cleanup operation names only one
 * of these resources. This probe is intentionally separate from deployment.
 * @returns {Promise<{imageName: string, templatesVolume: string, artifactsVolume: string}>}
 */
export async function runWindowsOfflineInstallerVolumeSmoke() {
  await runDocker(['info', '--format', '{{.ServerVersion}}']);

  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const imageName = `classroompath-p158-volume-probe-${suffix}`;
  const templatesVolume = `classroompath-p158-templates-${suffix}`;
  const artifactsVolume = `classroompath-p158-artifacts-${suffix}`;
  let imageCreated = false;
  let templatesVolumeCreated = false;
  let artifactsVolumeCreated = false;
  let primaryFailure = false;

  try {
    await runDocker(['build', '--file', dockerfilePath, '--tag', imageName, dockerContext]);
    imageCreated = true;
    await runDocker(['volume', 'create', templatesVolume]);
    templatesVolumeCreated = true;
    await runDocker(['volume', 'create', artifactsVolume]);
    artifactsVolumeCreated = true;
    await runRuntimeChecks(imageName, templatesVolume, artifactsVolume);

    return { imageName, templatesVolume, artifactsVolume };
  } catch (error) {
    primaryFailure = true;
    throw error;
  } finally {
    const cleanupFailures = [];
    if (templatesVolumeCreated) {
      await runDocker(['volume', 'rm', templatesVolume]).catch(() => {
        cleanupFailures.push('templates volume');
      });
    }
    if (artifactsVolumeCreated) {
      await runDocker(['volume', 'rm', artifactsVolume]).catch(() => {
        cleanupFailures.push('artifacts volume');
      });
    }
    if (imageCreated) {
      await runDocker(['image', 'rm', imageName]).catch(() => {
        cleanupFailures.push('probe image');
      });
    }
    if (cleanupFailures.length > 0) {
      throw new Error(
        primaryFailure
          ? 'fresh named-volume smoke failed and its scoped cleanup also failed'
          : `fresh named-volume smoke cleanup failed: ${cleanupFailures.join(', ')}`
      );
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runWindowsOfflineInstallerVolumeSmoke()
    .then(({ imageName, templatesVolume, artifactsVolume }) => {
      process.stdout.write(
        `fresh named-volume installer smoke passed: non-root provisioner template write, non-root API artifact write, read-only template mount, private artifact mount; resources=${imageName},${templatesVolume},${artifactsVolume}\n`
      );
    })
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'fresh named-volume smoke failed'}\n`
      );
      process.exitCode = 1;
    });
}
