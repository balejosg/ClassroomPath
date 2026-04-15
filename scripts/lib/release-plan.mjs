#!/usr/bin/env node
// @ts-check

import { readFileSync } from 'node:fs';
import { parseCanonicalReleaseManifestText } from './release-manifest.mjs';
import { deriveStagingDeploymentMode } from './promotion-eligibility.mjs';

/**
 * @typedef {{
 *   repository: string;
 *   run_id: string;
 *   app_sha: string;
 *   gateway_image: string;
 *   migrations_image: string;
 *   openpath_api_image: string;
 *   openpath_version: string;
 *   linux_agent_version: string;
 *   spa_image: string;
 *   verifier_image: string;
 * }} ReleaseManifest
 */

/**
 * @typedef {{
 *   runSmoke: true;
 *   runReleaseGate: boolean;
 *   persistEvidence: boolean;
 *   requireLiveWindowsFirefoxEvidence: boolean;
 * }} VerificationRequirements
 */

/**
 * @typedef {{
 *   repository: string;
 *   runId: string;
 *   appSha: string;
 *   gatewayImage: string;
 *   migrationsImage: string;
 *   openpathApiImage: string;
 *   openpathVersion: string;
 *   linuxAgentVersion: string;
 *   spaImage: string;
 *   verifierImage: string;
 * }} ReleaseCandidatePlan
 */

/**
 * @typedef {{
 *   imageSource: 'release-candidate' | 'source-build';
 *   deploymentMode: 'promotion-eligible' | 'debug';
 *   useReleaseCandidate: boolean;
 *   targetSha: string;
 *   releaseCandidate: ReleaseCandidatePlan | null;
 *   verification: VerificationRequirements;
 * }} StagingReleasePlan
 */

const RELEASE_CANDIDATE_REQUIRED_KEYS = /** @type {const} */ ([
  'repository',
  'run_id',
  'app_sha',
  'gateway_image',
  'migrations_image',
  'openpath_api_image',
  'openpath_version',
  'linux_agent_version',
  'spa_image',
  'verifier_image',
]);

/**
 * @param {string} text
 * @returns {ReleaseManifest}
 */
export function parseReleaseManifestText(text) {
  return /** @type {ReleaseManifest} */ (parseCanonicalReleaseManifestText(text));
}

/**
 * @param {{
 *   imageMode: 'release-candidate' | 'source-build';
 *   remoteSha: string;
 *   manifest: ReleaseManifest | null;
 * }} params
 * @returns {StagingReleasePlan}
 */
export function buildStagingReleasePlan({ imageMode, remoteSha, manifest }) {
  if (imageMode !== 'release-candidate' && imageMode !== 'source-build') {
    throw new Error(`Unsupported staging image mode: ${imageMode}`);
  }

  if (imageMode === 'release-candidate') {
    if (!manifest) {
      throw new Error('release-candidate staging plan requires a manifest');
    }

    return {
      imageSource: 'release-candidate',
      deploymentMode: deriveStagingDeploymentMode('release-candidate'),
      useReleaseCandidate: true,
      targetSha: manifest.app_sha,
      releaseCandidate: {
        repository: manifest.repository,
        runId: manifest.run_id,
        appSha: manifest.app_sha,
        gatewayImage: manifest.gateway_image,
        migrationsImage: manifest.migrations_image,
        openpathApiImage: manifest.openpath_api_image,
        openpathVersion: manifest.openpath_version,
        linuxAgentVersion: manifest.linux_agent_version,
        spaImage: manifest.spa_image,
        verifierImage: manifest.verifier_image,
      },
      verification: {
        runSmoke: true,
        runReleaseGate: true,
        persistEvidence: true,
        requireLiveWindowsFirefoxEvidence: true,
      },
    };
  }

  return {
    imageSource: 'source-build',
    deploymentMode: deriveStagingDeploymentMode('source-build'),
    useReleaseCandidate: false,
    targetSha: remoteSha,
    releaseCandidate: null,
    verification: {
      runSmoke: true,
      runReleaseGate: false,
      persistEvidence: false,
      requireLiveWindowsFirefoxEvidence: false,
    },
  };
}

/**
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@%+=,-]*$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {StagingReleasePlan} plan
 * @param {{ manifestBase64?: string }} [options]
 * @returns {string}
 */
export function formatStagingReleasePlanEnv(plan, options = {}) {
  const manifestBase64 = options.manifestBase64 ?? '';
  const envEntries = {
    STAGING_IMAGE_SOURCE: plan.imageSource,
    STAGING_DEPLOYMENT_MODE: plan.deploymentMode,
    STAGING_USE_RELEASE_CANDIDATE: plan.useReleaseCandidate ? '1' : '0',
    STAGING_RELEASE_SHA: plan.releaseCandidate?.appSha ?? '',
    STAGING_RELEASE_RUN_ID: plan.releaseCandidate?.runId ?? '',
    STAGING_RELEASE_REPOSITORY: plan.releaseCandidate?.repository ?? '',
    STAGING_RELEASE_MANIFEST_B64: manifestBase64,
    STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE: plan.verification
      .requireLiveWindowsFirefoxEvidence
      ? '1'
      : '0',
  };

  return `${Object.entries(envEntries)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join('\n')}\n`;
}

/**
 * @param {string[]} args
 * @returns {{ imageMode: 'release-candidate' | 'source-build'; remoteSha: string; manifestFile?: string }}
 */
function parseCliArgs(args) {
  /** @type {{ imageMode?: 'release-candidate' | 'source-build'; remoteSha?: string; manifestFile?: string }} */
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    switch (arg) {
      case '--image-mode':
        if (value !== 'release-candidate' && value !== 'source-build') {
          throw new Error(`Unsupported --image-mode value: ${value ?? ''}`);
        }
        parsed.imageMode = value;
        index += 1;
        break;
      case '--remote-sha':
        parsed.remoteSha = value ?? '';
        index += 1;
        break;
      case '--manifest-file':
        parsed.manifestFile = value ?? '';
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!parsed.imageMode) {
    throw new Error('--image-mode is required');
  }

  if (!parsed.remoteSha) {
    throw new Error('--remote-sha is required');
  }

  return /** @type {{ imageMode: 'release-candidate' | 'source-build'; remoteSha: string; manifestFile?: string }} */ (
    parsed
  );
}

function runCli() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'render-staging-env') {
    return;
  }

  const { imageMode, remoteSha, manifestFile } = parseCliArgs(args);
  const manifestText = manifestFile ? readFileSync(manifestFile, 'utf8') : '';
  const manifest = manifestText ? parseReleaseManifestText(manifestText) : null;
  const plan = buildStagingReleasePlan({ imageMode, remoteSha, manifest });
  const manifestBase64 = manifestText ? Buffer.from(manifestText, 'utf8').toString('base64') : '';

  process.stdout.write(formatStagingReleasePlanEnv(plan, { manifestBase64 }));
}

runCli();
