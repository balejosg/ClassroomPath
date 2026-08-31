#!/usr/bin/env node
// @ts-check

import {
  buildDeployIntent,
  decodeDeployIntentBase64,
  encodeDeployIntentBase64,
} from './deploy-intent.mjs';

/**
 * @typedef {{
 *   version: 3;
 *   targetEnvironment: 'staging' | 'production';
 *   deployRef: string;
 *   deploySha: string;
 *   imageSource: 'release-candidate' | 'source-build';
 *   deploymentMode: 'promotion-eligible' | 'debug';
 *   manifestBase64: string;
 *   releaseId?: string;
 *   releaseBundleBase64?: string;
 *   openpathContractBase64?: string;
 *   rcRunId?: string;
 * }} DeployPayload
 */

/**
 * @param {{
 *   targetEnvironment: 'staging' | 'production';
 *   deployRef: string;
 *   deploySha: string;
 *   imageSource: 'release-candidate' | 'source-build';
 *   deploymentMode: 'promotion-eligible' | 'debug';
 *   manifestBase64?: string;
 *   releaseId?: string;
 *   releaseBundleBase64?: string;
 *   openpathContractBase64?: string;
 *   rcRunId?: string;
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
      case '--deployment-mode':
        parsed.deploymentMode = value;
        index += 1;
        break;
      case '--manifest-base64':
        parsed.manifestBase64 = value;
        index += 1;
        break;
      case '--release-id':
        parsed.releaseId = value;
        index += 1;
        break;
      case '--release-bundle-base64':
        parsed.releaseBundleBase64 = value;
        index += 1;
        break;
      case '--openpath-contract-base64':
        parsed.openpathContractBase64 = value;
        index += 1;
        break;
      case '--rc-run-id':
        parsed.rcRunId = value;
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
    deploymentMode: /** @type {'promotion-eligible' | 'debug'} */ (
      parsed.deploymentMode ?? 'promotion-eligible'
    ),
    manifestBase64: parsed.manifestBase64 ?? '',
    releaseId: parsed.releaseId ?? '',
    releaseBundleBase64: parsed.releaseBundleBase64 ?? '',
    openpathContractBase64: parsed.openpathContractBase64 ?? '',
    rcRunId: parsed.rcRunId ?? '',
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
