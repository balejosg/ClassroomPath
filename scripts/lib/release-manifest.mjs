#!/usr/bin/env node
// @ts-check

import { readFileSync, writeFileSync } from 'node:fs';

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
 *   linux_agent_apt_suite: string;
 *   spa_image: string;
 *   verifier_image: string;
 * }} CanonicalReleaseManifest
 */

const CANONICAL_RELEASE_MANIFEST_KEYS = /** @type {const} */ ([
  'repository',
  'run_id',
  'app_sha',
  'gateway_image',
  'migrations_image',
  'openpath_api_image',
  'openpath_version',
  'linux_agent_version',
  'linux_agent_apt_suite',
  'spa_image',
  'verifier_image',
]);

function parseManifestAssignments(content) {
  /** @type {Record<string, string>} */
  const assignments = {};

  for (const rawLine of String(content ?? '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    assignments[key] = value;
  }

  return assignments;
}

function requireManifestKeys(assignments, keys, prefix) {
  for (const key of keys) {
    if (!assignments[key]) {
      throw new Error(`${prefix} missing required key: ${key}`);
    }
  }
}

/**
 * @param {string} text
 * @param {{ sha?: string }} [options]
 * @returns {CanonicalReleaseManifest}
 */
export function parseCanonicalReleaseManifestText(text, options = {}) {
  const assignments = parseManifestAssignments(text);
  requireManifestKeys(assignments, CANONICAL_RELEASE_MANIFEST_KEYS, 'Release manifest');

  if (options.sha && assignments.app_sha !== options.sha) {
    throw new Error(
      `Release manifest app_sha ${assignments.app_sha} does not match target SHA ${options.sha}`
    );
  }

  return /** @type {CanonicalReleaseManifest} */ ({
    repository: assignments.repository,
    run_id: assignments.run_id,
    app_sha: assignments.app_sha,
    gateway_image: assignments.gateway_image,
    migrations_image: assignments.migrations_image,
    openpath_api_image: assignments.openpath_api_image,
    openpath_version: assignments.openpath_version,
    linux_agent_version: assignments.linux_agent_version,
    linux_agent_apt_suite: assignments.linux_agent_apt_suite,
    spa_image: assignments.spa_image,
    verifier_image: assignments.verifier_image,
  });
}

/**
 * @param {string} text
 * @param {{ sha?: string }} [options]
 * @returns {{
 *   appSha: string;
 *   gatewayImage: string;
 *   migrationsImage: string;
 *   openpathApiImage: string;
 *   openpathVersion: string;
 *   linuxAgentVersion: string;
 *   linuxAgentAptSuite: string;
 *   spaImage: string;
 *   verifierImage: string;
 * }}
 */
export function parseArtifactReleaseManifestText(text, options = {}) {
  const assignments = parseManifestAssignments(text);
  const manifest = {
    appSha: assignments.APP_SHA,
    gatewayImage: assignments.CLASSROOMPATH_GATEWAY_IMAGE,
    migrationsImage: assignments.CLASSROOMPATH_MIGRATIONS_IMAGE,
    openpathApiImage: assignments.OPENPATH_API_IMAGE,
    openpathVersion: assignments.OPENPATH_VERSION ?? assignments.OPENPATH_LINUX_AGENT_VERSION ?? '',
    linuxAgentVersion: assignments.OPENPATH_LINUX_AGENT_VERSION ?? '',
    linuxAgentAptSuite: assignments.OPENPATH_LINUX_AGENT_APT_SUITE ?? '',
    spaImage: assignments.CLASSROOMPATH_SPA_IMAGE,
    verifierImage: assignments.CLASSROOMPATH_VERIFIER_IMAGE,
  };

  for (const [key, value] of Object.entries(manifest)) {
    if (!value) {
      throw new Error(`Release candidate artifact manifest is missing required value: ${key}`);
    }
  }

  if (options.sha && manifest.appSha !== options.sha) {
    throw new Error(
      `Release candidate manifest APP_SHA ${manifest.appSha} does not match target SHA ${options.sha}`
    );
  }

  return manifest;
}

/**
 * @param {{
 *   repository: string;
 *   runId: string;
 *   manifest: ReturnType<typeof parseArtifactReleaseManifestText>;
 * }} params
 * @returns {CanonicalReleaseManifest}
 */
export function buildCanonicalReleaseManifest({ repository, runId, manifest }) {
  if (!repository) {
    throw new Error('repository is required to build the canonical release manifest');
  }

  if (!runId) {
    throw new Error('runId is required to build the canonical release manifest');
  }

  return {
    repository,
    run_id: String(runId),
    app_sha: manifest.appSha,
    gateway_image: manifest.gatewayImage,
    migrations_image: manifest.migrationsImage,
    openpath_api_image: manifest.openpathApiImage,
    openpath_version: manifest.openpathVersion,
    linux_agent_version: manifest.linuxAgentVersion,
    linux_agent_apt_suite: manifest.linuxAgentAptSuite,
    spa_image: manifest.spaImage,
    verifier_image: manifest.verifierImage,
  };
}

/**
 * @param {CanonicalReleaseManifest} manifest
 * @returns {string}
 */
export function serializeReleaseManifest(manifest) {
  return `${CANONICAL_RELEASE_MANIFEST_KEYS.map((key) => `${key}=${manifest[key]}`).join('\n')}\n`;
}

/**
 * @param {string} text
 * @param {{ repository?: string; runId?: string; sha?: string }} [options]
 * @returns {CanonicalReleaseManifest}
 */
export function normalizeReleaseManifestText(text, options = {}) {
  const assignments = parseManifestAssignments(text);
  const looksCanonical = CANONICAL_RELEASE_MANIFEST_KEYS.some((key) => key in assignments);

  if (looksCanonical) {
    return parseCanonicalReleaseManifestText(text, { sha: options.sha });
  }

  return buildCanonicalReleaseManifest({
    repository: options.repository ?? '',
    runId: options.runId ?? '',
    manifest: parseArtifactReleaseManifestText(text, { sha: options.sha }),
  });
}

function parseCliArgs(args) {
  /** @type {Record<string, string>} */
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1] ?? '';

    switch (arg) {
      case '--file':
      case '--output-file':
      case '--repository':
      case '--run-id':
      case '--sha':
        parsed[arg.slice(2)] = value;
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
  if (command !== 'normalize') {
    return;
  }

  const parsed = parseCliArgs(args);
  if (!parsed.file) {
    throw new Error('--file is required');
  }

  const normalized = normalizeReleaseManifestText(readFileSync(parsed.file, 'utf8'), {
    repository: parsed.repository,
    runId: parsed['run-id'],
    sha: parsed.sha,
  });
  const serialized = serializeReleaseManifest(normalized);

  if (parsed['output-file']) {
    writeFileSync(parsed['output-file'], serialized, 'utf8');
    return;
  }

  process.stdout.write(serialized);
}

runCli();
