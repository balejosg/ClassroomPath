#!/usr/bin/env node
// @ts-check

import { readFileSync, writeFileSync } from 'node:fs';

import { validateWindowsOfflineInstallerTemplatePin } from '../resolve-windows-offline-installer-template-pin.mjs';

/**
 * @typedef {{
 *   repository: string;
 *   run_id: string;
 *   app_sha: string;
 *   gateway_image: string;
 *   migrations_image: string;
 *   openpath_firefox_assets_image: string;
 *   openpath_api_image: string;
 *   openpath_version: string;
 *   linux_agent_version: string;
 *   linux_agent_apt_suite: string;
 *   spa_image: string;
 *   verifier_image: string;
 *   windows_offline_installer_template_version?: string;
 *   windows_offline_installer_template_commit?: string;
 *   windows_offline_installer_template_release_tag?: string;
 *   windows_offline_installer_template_sha256?: string;
 * }} CanonicalReleaseManifest
 */

const CANONICAL_RELEASE_MANIFEST_KEYS = /** @type {const} */ ([
  'repository',
  'run_id',
  'app_sha',
  'gateway_image',
  'migrations_image',
  'openpath_firefox_assets_image',
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

function readOfflineInstallerPin(assignments) {
  const values = {
    windows_offline_installer_template_version:
      assignments.windows_offline_installer_template_version ?? '',
    windows_offline_installer_template_commit:
      assignments.windows_offline_installer_template_commit ?? '',
    windows_offline_installer_template_release_tag:
      assignments.windows_offline_installer_template_release_tag ?? '',
    windows_offline_installer_template_sha256:
      assignments.windows_offline_installer_template_sha256 ?? '',
  };
  const present = Object.values(values).filter(Boolean).length;
  if (present === 0) return {};
  if (present !== Object.keys(values).length) {
    throw new Error('Release manifest must contain the complete Windows offline installer pin');
  }

  validateWindowsOfflineInstallerTemplatePin(
    {
      version: values.windows_offline_installer_template_version,
      commit: values.windows_offline_installer_template_commit,
      releaseTag: values.windows_offline_installer_template_release_tag,
      sha256: values.windows_offline_installer_template_sha256,
    },
    { context: 'Release manifest Windows offline installer pin' }
  );

  return values;
}

function readCanonicalOfflineInstallerPin(manifest) {
  const pin = {
    version:
      manifest.windows_offline_installer_template_version ??
      manifest.windowsOfflineInstallerTemplateVersion,
    commit:
      manifest.windows_offline_installer_template_commit ??
      manifest.windowsOfflineInstallerTemplateCommit,
    releaseTag:
      manifest.windows_offline_installer_template_release_tag ??
      manifest.windowsOfflineInstallerTemplateReleaseTag,
    sha256:
      manifest.windows_offline_installer_template_sha256 ??
      manifest.windowsOfflineInstallerTemplateSha256,
  };
  const present = Object.values(pin).filter(Boolean).length;
  if (present === 0) return {};

  const validated = validateWindowsOfflineInstallerTemplatePin(pin, {
    context: 'Release manifest Windows offline installer pin',
  });
  return {
    windows_offline_installer_template_version: validated.version,
    windows_offline_installer_template_commit: validated.commit,
    windows_offline_installer_template_release_tag: validated.releaseTag,
    windows_offline_installer_template_sha256: validated.sha256,
  };
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

  const offlineInstallerPin = readOfflineInstallerPin(assignments);

  return /** @type {CanonicalReleaseManifest} */ ({
    repository: assignments.repository,
    run_id: assignments.run_id,
    app_sha: assignments.app_sha,
    gateway_image: assignments.gateway_image,
    migrations_image: assignments.migrations_image,
    openpath_firefox_assets_image: assignments.openpath_firefox_assets_image,
    openpath_api_image: assignments.openpath_api_image,
    openpath_version: assignments.openpath_version,
    linux_agent_version: assignments.linux_agent_version,
    linux_agent_apt_suite: assignments.linux_agent_apt_suite,
    spa_image: assignments.spa_image,
    verifier_image: assignments.verifier_image,
    ...offlineInstallerPin,
  });
}

/**
 * @param {string} text
 * @param {{ sha?: string }} [options]
 * @returns {{
 *   appSha: string;
 *   gatewayImage: string;
 *   migrationsImage: string;
 *   openpathFirefoxAssetsImage: string;
 *   openpathApiImage: string;
 *   openpathVersion: string;
 *   linuxAgentVersion: string;
 *   linuxAgentAptSuite: string;
 *   spaImage: string;
 *   verifierImage: string;
 *   windowsOfflineInstallerTemplateVersion?: string;
 *   windowsOfflineInstallerTemplateCommit?: string;
 *   windowsOfflineInstallerTemplateReleaseTag?: string;
 *   windowsOfflineInstallerTemplateSha256?: string;
 * }}
 */
export function parseArtifactReleaseManifestText(text, options = {}) {
  const assignments = parseManifestAssignments(text);
  const offlineInstallerPin = readOfflineInstallerPin(assignments);
  const manifest = {
    appSha: assignments.APP_SHA,
    gatewayImage: assignments.CLASSROOMPATH_GATEWAY_IMAGE,
    migrationsImage: assignments.CLASSROOMPATH_MIGRATIONS_IMAGE,
    openpathFirefoxAssetsImage: assignments.OPENPATH_FIREFOX_ASSETS_IMAGE,
    openpathApiImage: assignments.OPENPATH_API_IMAGE,
    openpathVersion: assignments.OPENPATH_VERSION ?? assignments.OPENPATH_LINUX_AGENT_VERSION ?? '',
    linuxAgentVersion: assignments.OPENPATH_LINUX_AGENT_VERSION ?? '',
    linuxAgentAptSuite: assignments.OPENPATH_LINUX_AGENT_APT_SUITE ?? '',
    spaImage: assignments.CLASSROOMPATH_SPA_IMAGE,
    verifierImage: assignments.CLASSROOMPATH_VERIFIER_IMAGE,
    ...(offlineInstallerPin.windows_offline_installer_template_version
      ? {
          windowsOfflineInstallerTemplateVersion:
            offlineInstallerPin.windows_offline_installer_template_version,
          windowsOfflineInstallerTemplateCommit:
            offlineInstallerPin.windows_offline_installer_template_commit,
          windowsOfflineInstallerTemplateReleaseTag:
            offlineInstallerPin.windows_offline_installer_template_release_tag,
          windowsOfflineInstallerTemplateSha256:
            offlineInstallerPin.windows_offline_installer_template_sha256,
        }
      : {}),
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

  const offlineInstallerPin = readCanonicalOfflineInstallerPin(manifest);

  return {
    repository,
    run_id: String(runId),
    app_sha: manifest.appSha,
    gateway_image: manifest.gatewayImage,
    migrations_image: manifest.migrationsImage,
    openpath_firefox_assets_image: manifest.openpathFirefoxAssetsImage,
    openpath_api_image: manifest.openpathApiImage,
    openpath_version: manifest.openpathVersion,
    linux_agent_version: manifest.linuxAgentVersion,
    linux_agent_apt_suite: manifest.linuxAgentAptSuite,
    spa_image: manifest.spaImage,
    verifier_image: manifest.verifierImage,
    ...offlineInstallerPin,
  };
}

/**
 * Builds the artifact manifest for the manifest-only release-candidate path.
 * The image references and previous Windows tuple are copied from the previous
 * candidate; only the ClassroomPath SHA and explicitly resolved OpenPath
 * metadata are supplied by the new run.
 *
 * @param {{
 *   appSha: string;
 *   previousManifest: Record<string, string>;
 *   openpathVersion: string;
 *   linuxAgentVersion: string;
 *   linuxAgentAptSuite: string;
 * }} params
 * @returns {Record<string, string>}
 */
export function buildManifestOnlyReleaseCandidateArtifact({
  appSha,
  previousManifest,
  openpathVersion,
  linuxAgentVersion,
  linuxAgentAptSuite,
}) {
  const requiredValues = {
    APP_SHA: appSha,
    CLASSROOMPATH_GATEWAY_IMAGE: previousManifest?.gateway_image,
    CLASSROOMPATH_MIGRATIONS_IMAGE: previousManifest?.migrations_image,
    OPENPATH_FIREFOX_ASSETS_IMAGE: previousManifest?.openpath_firefox_assets_image,
    OPENPATH_API_IMAGE: previousManifest?.openpath_api_image,
    OPENPATH_VERSION: openpathVersion,
    OPENPATH_LINUX_AGENT_VERSION: linuxAgentVersion,
    OPENPATH_LINUX_AGENT_APT_SUITE: linuxAgentAptSuite,
    CLASSROOMPATH_SPA_IMAGE: previousManifest?.spa_image,
    CLASSROOMPATH_VERIFIER_IMAGE: previousManifest?.verifier_image,
  };
  for (const [key, value] of Object.entries(requiredValues)) {
    if (!String(value ?? '').trim()) {
      throw new Error(`Manifest-only release candidate is missing required value: ${key}`);
    }
  }

  const windowsPin = validateWindowsOfflineInstallerTemplatePin(
    {
      version: previousManifest?.windows_offline_installer_template_version,
      commit: previousManifest?.windows_offline_installer_template_commit,
      releaseTag: previousManifest?.windows_offline_installer_template_release_tag,
      sha256: previousManifest?.windows_offline_installer_template_sha256,
    },
    { context: 'Previous Windows offline installer pin' }
  );

  return {
    APP_SHA: String(appSha).trim(),
    CLASSROOMPATH_GATEWAY_IMAGE: previousManifest.gateway_image,
    CLASSROOMPATH_MIGRATIONS_IMAGE: previousManifest.migrations_image,
    OPENPATH_FIREFOX_ASSETS_IMAGE: previousManifest.openpath_firefox_assets_image,
    OPENPATH_API_IMAGE: previousManifest.openpath_api_image,
    OPENPATH_VERSION: String(openpathVersion).trim(),
    OPENPATH_LINUX_AGENT_VERSION: String(linuxAgentVersion).trim(),
    OPENPATH_LINUX_AGENT_APT_SUITE: String(linuxAgentAptSuite).trim(),
    windows_offline_installer_template_version: windowsPin.version,
    windows_offline_installer_template_commit: windowsPin.commit,
    windows_offline_installer_template_release_tag: windowsPin.releaseTag,
    windows_offline_installer_template_sha256: windowsPin.sha256,
    CLASSROOMPATH_SPA_IMAGE: previousManifest.spa_image,
    CLASSROOMPATH_VERIFIER_IMAGE: previousManifest.verifier_image,
  };
}

/**
 * @param {CanonicalReleaseManifest} manifest
 * @returns {string}
 */
export function serializeReleaseManifest(manifest) {
  /** @type {string[]} */
  const keys = [...CANONICAL_RELEASE_MANIFEST_KEYS];
  const offlineInstallerPin = readCanonicalOfflineInstallerPin(manifest);
  if (Object.keys(offlineInstallerPin).length > 0) {
    keys.push(
      'windows_offline_installer_template_version',
      'windows_offline_installer_template_commit',
      'windows_offline_installer_template_release_tag',
      'windows_offline_installer_template_sha256'
    );
  }
  return `${keys.map((key) => `${key}=${offlineInstallerPin[key] ?? manifest[key]}`).join('\n')}\n`;
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

function serializeArtifactReleaseManifest(manifest) {
  return `${Object.entries(manifest)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

function runManifestOnlyCli() {
  const artifact = buildManifestOnlyReleaseCandidateArtifact({
    appSha: process.env.APP_SHA,
    previousManifest: {
      gateway_image: process.env.PREVIOUS_CLASSROOMPATH_GATEWAY_IMAGE,
      migrations_image: process.env.PREVIOUS_CLASSROOMPATH_MIGRATIONS_IMAGE,
      openpath_firefox_assets_image: process.env.PREVIOUS_OPENPATH_FIREFOX_ASSETS_IMAGE,
      openpath_api_image: process.env.PREVIOUS_OPENPATH_API_IMAGE,
      spa_image: process.env.PREVIOUS_CLASSROOMPATH_SPA_IMAGE,
      verifier_image: process.env.PREVIOUS_CLASSROOMPATH_VERIFIER_IMAGE,
      windows_offline_installer_template_version:
        process.env.PREVIOUS_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_VERSION,
      windows_offline_installer_template_commit:
        process.env.PREVIOUS_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_COMMIT,
      windows_offline_installer_template_release_tag:
        process.env.PREVIOUS_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG,
      windows_offline_installer_template_sha256:
        process.env.PREVIOUS_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_SHA256,
    },
    openpathVersion: process.env.OPENPATH_VERSION,
    linuxAgentVersion: process.env.OPENPATH_LINUX_AGENT_VERSION,
    linuxAgentAptSuite: process.env.OPENPATH_LINUX_AGENT_APT_SUITE,
  });
  process.stdout.write(serializeArtifactReleaseManifest(artifact));
}

function runCli() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'manifest-only') {
    runManifestOnlyCli();
    return;
  }

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
