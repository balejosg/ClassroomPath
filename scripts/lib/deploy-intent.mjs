#!/usr/bin/env node
// @ts-check

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
 * }} DeployIntent
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
 * @returns {DeployIntent}
 */
export function buildDeployIntent({
  targetEnvironment,
  deployRef,
  deploySha,
  imageSource,
  deploymentMode,
  manifestBase64,
  releaseId,
  releaseBundleBase64,
  openpathContractBase64,
  rcRunId,
}) {
  if (targetEnvironment !== 'staging' && targetEnvironment !== 'production') {
    throw new Error(`Unsupported target environment: ${targetEnvironment}`);
  }

  if (imageSource !== 'release-candidate' && imageSource !== 'source-build') {
    throw new Error(`Unsupported imageSource: ${imageSource}`);
  }

  if (deploymentMode !== 'promotion-eligible' && deploymentMode !== 'debug') {
    throw new Error(`Unsupported deploymentMode: ${deploymentMode}`);
  }

  if (!deploySha) {
    throw new Error('deploySha is required');
  }

  if (targetEnvironment === 'production' && deploymentMode !== 'promotion-eligible') {
    throw new Error('Production deploy intent must be promotion-eligible');
  }

  if (deploymentMode === 'promotion-eligible' && imageSource !== 'release-candidate') {
    throw new Error('promotion-eligible deploy intent requires release-candidate images');
  }

  const immutableBundleFields = [releaseId, releaseBundleBase64, openpathContractBase64].filter(
    (value) => String(value ?? '').trim() !== ''
  );
  if (immutableBundleFields.length !== 0 && immutableBundleFields.length !== 3) {
    throw new Error(
      'releaseId, releaseBundleBase64, and openpathContractBase64 must be provided together'
    );
  }
  if (deploymentMode === 'promotion-eligible' && immutableBundleFields.length !== 3) {
    throw new Error(
      'promotion-eligible deploy intent requires releaseId, releaseBundleBase64, and openpathContractBase64'
    );
  }
  if (releaseId && !/^[0-9a-f]{64}$/.test(releaseId)) {
    throw new Error('releaseId must be a 64-character lowercase SHA-256 hex string');
  }
  if (deploymentMode === 'promotion-eligible' && !/^[0-9]+$/.test(String(rcRunId ?? '').trim())) {
    throw new Error('promotion-eligible deploy intent requires a numeric rcRunId');
  }

  /** @type {DeployIntent} */
  const intent = {
    version: 3,
    targetEnvironment,
    deployRef,
    deploySha,
    imageSource,
    deploymentMode,
    manifestBase64: manifestBase64 ?? '',
  };

  if (immutableBundleFields.length === 3) {
    intent.releaseId = releaseId;
    intent.releaseBundleBase64 = releaseBundleBase64;
    intent.openpathContractBase64 = openpathContractBase64;
    intent.rcRunId = String(rcRunId).trim();
  }

  return intent;
}

function serializeDeployIntent(intent) {
  return [
    `version=${intent.version}`,
    `target_environment=${intent.targetEnvironment}`,
    `deploy_ref=${intent.deployRef}`,
    `deploy_sha=${intent.deploySha}`,
    `image_source=${intent.imageSource}`,
    `deployment_mode=${intent.deploymentMode}`,
    `manifest_base64=${intent.manifestBase64}`,
    `release_id=${intent.releaseId ?? ''}`,
    `release_bundle_base64=${intent.releaseBundleBase64 ?? ''}`,
    `openpath_contract_base64=${intent.openpathContractBase64 ?? ''}`,
    `rc_run_id=${intent.rcRunId ?? ''}`,
    '',
  ].join('\n');
}

function parseDeployIntentText(text) {
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

  if (entries.version !== '3') {
    throw new Error(`Unsupported deploy intent version: ${entries.version ?? 'unset'}`);
  }

  return buildDeployIntent({
    targetEnvironment: /** @type {'staging' | 'production'} */ (entries.target_environment),
    deployRef: entries.deploy_ref ?? '',
    deploySha: entries.deploy_sha ?? '',
    imageSource: /** @type {'release-candidate' | 'source-build'} */ (entries.image_source),
    deploymentMode: /** @type {'promotion-eligible' | 'debug'} */ (entries.deployment_mode),
    manifestBase64: entries.manifest_base64 ?? '',
    releaseId: entries.release_id ?? '',
    releaseBundleBase64: entries.release_bundle_base64 ?? '',
    openpathContractBase64: entries.openpath_contract_base64 ?? '',
    rcRunId: entries.rc_run_id ?? '',
  });
}

export function encodeDeployIntentBase64(intent) {
  return Buffer.from(serializeDeployIntent(intent), 'utf8').toString('base64');
}

export function decodeDeployIntentBase64(intentBase64) {
  if (!intentBase64) {
    throw new Error('Deploy intent is empty');
  }

  return parseDeployIntentText(Buffer.from(intentBase64, 'base64').toString('utf8'));
}
