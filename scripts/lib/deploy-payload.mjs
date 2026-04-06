#!/usr/bin/env node
// @ts-check

/**
 * @typedef {{
 *   version: 1;
 *   targetEnvironment: 'staging' | 'production';
 *   deployRef: string;
 *   deploySha: string;
 *   manifestBase64: string;
 * }} DeployPayload
 */

/**
 * @param {{
 *   targetEnvironment: 'staging' | 'production';
 *   deployRef: string;
 *   deploySha: string;
 *   manifestBase64: string;
 * }} params
 * @returns {DeployPayload}
 */
export function buildDeployPayload({ targetEnvironment, deployRef, deploySha, manifestBase64 }) {
  if (targetEnvironment !== 'staging' && targetEnvironment !== 'production') {
    throw new Error(`Unsupported target environment: ${targetEnvironment}`);
  }

  if (!deploySha) {
    throw new Error('deploySha is required');
  }

  if (!manifestBase64) {
    throw new Error('manifestBase64 is required');
  }

  return {
    version: 1,
    targetEnvironment,
    deployRef,
    deploySha,
    manifestBase64,
  };
}

/**
 * @param {DeployPayload} payload
 * @returns {string}
 */
function serializeDeployPayload(payload) {
  return [
    `version=${payload.version}`,
    `target_environment=${payload.targetEnvironment}`,
    `deploy_ref=${payload.deployRef}`,
    `deploy_sha=${payload.deploySha}`,
    `manifest_base64=${payload.manifestBase64}`,
    '',
  ].join('\n');
}

/**
 * @param {string} text
 * @returns {DeployPayload}
 */
function parseDeployPayloadText(text) {
  /** @type {Record<string, string>} */
  const entries = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }

  if (entries.version !== '1') {
    throw new Error(`Unsupported deploy payload version: ${entries.version ?? 'unset'}`);
  }

  return buildDeployPayload({
    targetEnvironment: /** @type {'staging' | 'production'} */ (entries.target_environment),
    deployRef: entries.deploy_ref ?? '',
    deploySha: entries.deploy_sha ?? '',
    manifestBase64: entries.manifest_base64 ?? '',
  });
}

/**
 * @param {DeployPayload} payload
 * @returns {string}
 */
export function encodeDeployPayloadBase64(payload) {
  return Buffer.from(serializeDeployPayload(payload), 'utf8').toString('base64');
}

/**
 * @param {string} payloadBase64
 * @returns {DeployPayload}
 */
export function decodeDeployPayloadBase64(payloadBase64) {
  if (!payloadBase64) {
    throw new Error('Deploy payload is empty');
  }

  return parseDeployPayloadText(Buffer.from(payloadBase64, 'base64').toString('utf8'));
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]*$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function parseCliArgs(args) {
  /** @type {Record<string, string>} */
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1] ?? '';

    switch (arg) {
      case '--target-environment':
        parsed.targetEnvironment = value;
        index += 1;
        break;
      case '--deploy-ref':
        parsed.deployRef = value;
        index += 1;
        break;
      case '--deploy-sha':
        parsed.deploySha = value;
        index += 1;
        break;
      case '--manifest-base64':
        parsed.manifestBase64 = value;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function runCli() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    return;
  }

  const parsed = parseCliArgs(args);
  const payload = buildDeployPayload({
    targetEnvironment: /** @type {'staging' | 'production'} */ (parsed.targetEnvironment),
    deployRef: parsed.deployRef ?? '',
    deploySha: parsed.deploySha ?? '',
    manifestBase64: parsed.manifestBase64 ?? '',
  });
  const payloadBase64 = encodeDeployPayloadBase64(payload);

  if (command === 'render-github-output') {
    process.stdout.write(`payload_base64=${payloadBase64}\n`);
    return;
  }

  if (command === 'render-env') {
    process.stdout.write(`DEPLOY_PAYLOAD_B64=${shellQuote(payloadBase64)}\n`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

runCli();
