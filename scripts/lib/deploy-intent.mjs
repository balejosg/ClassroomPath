#!/usr/bin/env node
// @ts-check

/**
 * @typedef {{
 *   version: 2;
 *   targetEnvironment: 'staging' | 'production';
 *   deployRef: string;
 *   deploySha: string;
 *   imageSource: 'release-candidate' | 'source-build';
 *   supportsPromotionEvidence: boolean;
 *   manifestBase64: string;
 * }} DeployIntent
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
 * @returns {DeployIntent}
 */
export function buildDeployIntent({
  targetEnvironment,
  deployRef,
  deploySha,
  imageSource,
  supportsPromotionEvidence,
  manifestBase64,
}) {
  if (targetEnvironment !== 'staging' && targetEnvironment !== 'production') {
    throw new Error(`Unsupported target environment: ${targetEnvironment}`);
  }

  if (imageSource !== 'release-candidate' && imageSource !== 'source-build') {
    throw new Error(`Unsupported imageSource: ${imageSource}`);
  }

  if (!deploySha) {
    throw new Error('deploySha is required');
  }

  return {
    version: 2,
    targetEnvironment,
    deployRef,
    deploySha,
    imageSource,
    supportsPromotionEvidence: Boolean(supportsPromotionEvidence),
    manifestBase64: manifestBase64 ?? '',
  };
}

function serializeDeployIntent(intent) {
  return [
    `version=${intent.version}`,
    `target_environment=${intent.targetEnvironment}`,
    `deploy_ref=${intent.deployRef}`,
    `deploy_sha=${intent.deploySha}`,
    `image_source=${intent.imageSource}`,
    `supports_promotion_evidence=${intent.supportsPromotionEvidence ? '1' : '0'}`,
    `manifest_base64=${intent.manifestBase64}`,
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

  if (entries.version !== '2') {
    throw new Error(`Unsupported deploy intent version: ${entries.version ?? 'unset'}`);
  }

  return buildDeployIntent({
    targetEnvironment: /** @type {'staging' | 'production'} */ (entries.target_environment),
    deployRef: entries.deploy_ref ?? '',
    deploySha: entries.deploy_sha ?? '',
    imageSource: /** @type {'release-candidate' | 'source-build'} */ (entries.image_source),
    supportsPromotionEvidence: entries.supports_promotion_evidence === '1',
    manifestBase64: entries.manifest_base64 ?? '',
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
