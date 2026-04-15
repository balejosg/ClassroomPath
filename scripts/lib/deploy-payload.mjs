#!/usr/bin/env node
// @ts-check

import {
  buildDeployIntent,
  decodeDeployIntentBase64,
  encodeDeployIntentBase64,
} from './deploy-intent.mjs';

/**
 * @typedef {{
 *   version: 2;
 *   targetEnvironment: 'staging' | 'production';
 *   deployRef: string;
 *   deploySha: string;
 *   imageSource: 'release-candidate' | 'source-build';
 *   supportsPromotionEvidence: boolean;
 *   manifestBase64: string;
 * }} DeployPayload
 */

/**
 * @param {{
 *   targetEnvironment: 'staging' | 'production';
 *   deployRef: string;
 *   deploySha: string;
 *   imageSource: 'release-candidate' | 'source-build';
 *   supportsPromotionEvidence: boolean;
 *   manifestBase64?: string;
 * }} params
 * @returns {DeployPayload}
 */
export function buildDeployPayload(params) {
  return buildDeployIntent(params);
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
    `image_source=${payload.imageSource}`,
    `supports_promotion_evidence=${payload.supportsPromotionEvidence ? '1' : '0'}`,
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

  if (entries.version !== '2') {
    throw new Error(`Unsupported deploy payload version: ${entries.version ?? 'unset'}`);
  }

  return buildDeployPayload({
    targetEnvironment: /** @type {'staging' | 'production'} */ (entries.target_environment),
    deployRef: entries.deploy_ref ?? '',
    deploySha: entries.deploy_sha ?? '',
    imageSource: /** @type {'release-candidate' | 'source-build'} */ (entries.image_source),
    supportsPromotionEvidence: entries.supports_promotion_evidence === '1',
    manifestBase64: entries.manifest_base64 ?? '',
  });
}

/**
 * @param {DeployPayload} payload
 * @returns {string}
 */
export function encodeDeployPayloadBase64(payload) {
  return encodeDeployIntentBase64(payload);
}

/**
 * @param {string} payloadBase64
 * @returns {DeployPayload}
 */
export function decodeDeployPayloadBase64(payloadBase64) {
  return decodeDeployIntentBase64(payloadBase64);
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
      case '--image-source':
        parsed.imageSource = value;
        index += 1;
        break;
      case '--supports-promotion-evidence':
        parsed.supportsPromotionEvidence = value;
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
    imageSource: /** @type {'release-candidate' | 'source-build'} */ (
      parsed.imageSource ?? 'release-candidate'
    ),
    supportsPromotionEvidence: String(parsed.supportsPromotionEvidence ?? '1') === '1',
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
