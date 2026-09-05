/**
 * Pure representation of the minimum production host contract.
 *
 * The remote enforcement path is production-host-contract.sh because the
 * production host is not required to have Node.js. This module keeps the
 * contract and its local/CI-equivalent assertions easy to test.
 */

export const PRODUCTION_HOST_CONTRACT_VERSION = 1;

export const PRODUCTION_HOST_REQUIRED_COMMANDS = Object.freeze([
  'bash',
  'git',
  'docker',
  'curl',
  'awk',
  'sed',
  'grep',
  'install',
  'mktemp',
  'mv',
  'cp',
  'chmod',
  'df',
  'id',
  'tr',
  'base64',
  'basename',
  'cat',
  'cmp',
  'date',
  'dirname',
  'env',
  'head',
  'ln',
  'mkdir',
  'rm',
  'sh',
  'sleep',
  'tail',
  'gzip',
  'timeout',
  'touch',
  'tar',
  'sha256sum',
  'uname',
  'mkfifo',
]);

export const PRODUCTION_HOST_FORBIDDEN_RUNTIME_COMMANDS = Object.freeze(['node', 'npm']);

function booleanValue(value) {
  return value === true;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function validateProductionHostContract(input = {}) {
  const commands = input.commands ?? {};
  const runtimeCommands = input.runtimeCommands ?? {};
  const docker = input.docker ?? {};
  const deployRoot = input.deployRoot ?? {};
  const diskUsagePercent = finiteNumber(input.diskUsagePercent, 0);
  const diskThresholdPercent = finiteNumber(input.diskThresholdPercent, 80);
  const errors = [];

  for (const command of PRODUCTION_HOST_REQUIRED_COMMANDS) {
    if (!booleanValue(commands[command])) {
      errors.push(`missing-command:${command}`);
    }
  }
  if (!booleanValue(docker.daemonReachable)) errors.push('docker-daemon-unreachable');
  if (!booleanValue(docker.composeAvailable)) errors.push('docker-compose-unavailable');
  if (!booleanValue(deployRoot.exists)) errors.push('deploy-root-missing');
  if (!booleanValue(deployRoot.writable)) errors.push('deploy-root-not-writable');
  if (diskUsagePercent > diskThresholdPercent) errors.push('disk-threshold-exceeded');
  if (!booleanValue(input.networkReachable)) errors.push('required-network-unreachable');

  return {
    contractVersion: PRODUCTION_HOST_CONTRACT_VERSION,
    ok: errors.length === 0,
    mutationAllowed: errors.length === 0,
    nodeRequired: false,
    npmRequired: false,
    requiredCommands: [...PRODUCTION_HOST_REQUIRED_COMMANDS],
    runtimeCommands: Object.fromEntries(
      PRODUCTION_HOST_FORBIDDEN_RUNTIME_COMMANDS.map((command) => [
        command,
        booleanValue(runtimeCommands[command]),
      ])
    ),
    errors,
  };
}
