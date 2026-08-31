#!/usr/bin/env node
// @ts-check

import { readFileSync, writeFileSync } from 'node:fs';

import {
  selectWindowsOfflineInstallerTemplatePin,
  validateWindowsOfflineInstallerTemplatePin,
} from '../resolve-windows-offline-installer-template-pin.mjs';
import {
  buildReleaseBundleArtifacts,
  projectOpenPathContractToLegacyRuntime,
} from './release-bundle.mjs';

/**
 * @typedef {{
 *   version?: string;
 *   commit?: string;
 *   releaseTag?: string;
 *   sha256?: string;
 * }} WindowsOfflineInstallerTemplatePinInput
 */

/**
 * @typedef {{
 *   version: string;
 *   commit: string;
 *   releaseTag: string;
 *   sha256: string;
 * }} WindowsOfflineInstallerTemplatePin
 */

/**
 * @typedef {{
 *   windows_offline_installer_template_version?: string;
 *   windows_offline_installer_template_commit?: string;
 *   windows_offline_installer_template_release_tag?: string;
 *   windows_offline_installer_template_sha256?: string;
 * }} ReleaseManifestOfflineInstallerPin
 */

/**
 * @typedef {ReleaseManifestOfflineInstallerPin & {
 *   windowsOfflineInstallerTemplateVersion?: string;
 *   windowsOfflineInstallerTemplateCommit?: string;
 *   windowsOfflineInstallerTemplateReleaseTag?: string;
 *   windowsOfflineInstallerTemplateSha256?: string;
 * }} ReleaseManifestPinFields
 */

/**
 * @typedef {{
 *   gateway_image?: string;
 *   migrations_image?: string;
 *   openpath_firefox_assets_image?: string;
 *   openpath_api_image?: string;
 *   spa_image?: string;
 *   verifier_image?: string;
 *   windows_offline_installer_template_version?: string;
 *   windows_offline_installer_template_commit?: string;
 *   windows_offline_installer_template_release_tag?: string;
 *   windows_offline_installer_template_sha256?: string;
 * }} PreviousReleaseCandidateManifest
 */

/**
 * @typedef {{
 *   APP_SHA: string;
 *   CLASSROOMPATH_GATEWAY_IMAGE: string;
 *   CLASSROOMPATH_MIGRATIONS_IMAGE: string;
 *   OPENPATH_FIREFOX_ASSETS_IMAGE: string;
 *   OPENPATH_API_IMAGE: string;
 *   OPENPATH_VERSION: string;
 *   OPENPATH_LINUX_AGENT_VERSION: string;
 *   OPENPATH_LINUX_AGENT_APT_SUITE: string;
 *   windows_offline_installer_template_version: string;
 *   windows_offline_installer_template_commit: string;
 *   windows_offline_installer_template_release_tag: string;
 *   windows_offline_installer_template_sha256: string;
 *   CLASSROOMPATH_SPA_IMAGE: string;
 *   CLASSROOMPATH_VERIFIER_IMAGE: string;
 * }} ReleaseCandidateArtifactManifest
 */

/**
 * @typedef {{
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
 * }} ParsedReleaseCandidateManifest
 */

/**
 * @typedef {{
 *   appSha?: string;
 *   previousManifest?: PreviousReleaseCandidateManifest;
 *   openpathVersion?: string;
 *   linuxAgentVersion?: string;
 *   linuxAgentAptSuite?: string;
 *   newWindowsPin?: WindowsOfflineInstallerTemplatePinInput;
 * }} ManifestOnlyReleaseCandidateOptions
 */

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
 *   release_id?: string;
 *   openpath_sha?: string;
 *   openpath_contract_sha256?: string;
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

const RELEASE_MANIFEST_V2_IDENTITY_KEYS = /** @type {const} */ ([
  'release_id',
  'openpath_sha',
  'openpath_contract_sha256',
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

function readOptionalReleaseIdentity(assignments) {
  const values = {
    release_id: assignments.release_id ?? '',
    openpath_sha: assignments.openpath_sha ?? '',
    openpath_contract_sha256: assignments.openpath_contract_sha256 ?? '',
  };
  const present = Object.values(values).filter(Boolean).length;
  if (present === 0) return {};
  if (present !== Object.keys(values).length) {
    throw new Error(
      'Release manifest v2 identity must contain release_id, openpath_sha, and openpath_contract_sha256'
    );
  }
  if (!/^[0-9a-f]{64}$/.test(values.release_id)) {
    throw new Error('Release manifest release_id is invalid');
  }
  if (!/^[0-9a-f]{40}$/.test(values.openpath_sha)) {
    throw new Error('Release manifest openpath_sha is invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(values.openpath_contract_sha256)) {
    throw new Error('Release manifest openpath_contract_sha256 is invalid');
  }
  return values;
}

/**
 * @param {Record<string, string>} assignments
 * @returns {ReleaseManifestOfflineInstallerPin}
 */
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

/**
 * @param {ReleaseManifestPinFields} manifest
 * @returns {ReleaseManifestOfflineInstallerPin}
 */
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
  const releaseIdentity = readOptionalReleaseIdentity(assignments);

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
    ...releaseIdentity,
    ...offlineInstallerPin,
  });
}

/**
 * @param {string} text
 * @param {{ sha?: string }} [options]
 * @returns {ParsedReleaseCandidateManifest}
 */
export function parseArtifactReleaseManifestText(text, options = {}) {
  const assignments = parseManifestAssignments(text);
  const offlineInstallerPin = readOfflineInstallerPin(assignments);
  const releaseIdentity = readOptionalReleaseIdentity(assignments);
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
    ...(releaseIdentity.release_id
      ? {
          releaseId: releaseIdentity.release_id,
          openpathSha: releaseIdentity.openpath_sha,
          openpathContractSha256: releaseIdentity.openpath_contract_sha256,
        }
      : {}),
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
 *   manifest: ParsedReleaseCandidateManifest;
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
    ...(manifest.releaseId
      ? {
          release_id: manifest.releaseId,
          openpath_sha: manifest.openpathSha,
          openpath_contract_sha256: manifest.openpathContractSha256,
        }
      : {}),
    ...offlineInstallerPin,
  };
}

/**
 * Builds the legacy manifest projection from one verified v2 bundle and its
 * exact OpenPath contract bytes. The bundle remains the authority.
 *
 * @param {{
 *   repository: string;
 *   runId: string;
 *   bundle: object;
 *   contractBytes: Buffer | Uint8Array;
 * }} params
 * @returns {CanonicalReleaseManifest}
 */
export function buildCanonicalReleaseManifestFromBundle({
  repository,
  runId,
  bundle,
  contractBytes,
}) {
  if (!repository) {
    throw new Error('repository is required to build the canonical release manifest');
  }
  if (!runId) {
    throw new Error('runId is required to build the canonical release manifest');
  }
  const artifact = buildReleaseBundleArtifacts({ bundle, contractBytes });
  const projection = projectOpenPathContractToLegacyRuntime({
    contract: artifact.contract,
    contractSha256: artifact.contractSha256,
  });
  return {
    repository,
    run_id: String(runId),
    app_sha: artifact.bundle.classroomPathSha,
    gateway_image: artifact.bundle.images.gateway,
    migrations_image: artifact.bundle.images.migrations,
    openpath_firefox_assets_image: artifact.bundle.images.openpathFirefoxAssets,
    openpath_api_image: artifact.bundle.images.openpathApi,
    openpath_version: projection.OPENPATH_VERSION,
    linux_agent_version: projection.OPENPATH_LINUX_AGENT_VERSION,
    linux_agent_apt_suite: projection.OPENPATH_LINUX_AGENT_APT_SUITE,
    spa_image: artifact.bundle.images.spa,
    verifier_image: artifact.bundle.images.verifier,
    release_id: artifact.releaseId,
    openpath_sha: artifact.bundle.openPath.sourceSha,
    openpath_contract_sha256: artifact.contractSha256,
    windows_offline_installer_template_version:
      projection.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION,
    windows_offline_installer_template_commit: projection.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT,
    windows_offline_installer_template_release_tag:
      projection.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG,
    windows_offline_installer_template_sha256: projection.OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256,
  };
}

/**
 * Builds the artifact manifest for the manifest-only release-candidate path.
 * The image references and previous Windows tuple are copied from the previous
 * candidate; the Windows tuple is selected from the new pin when present and
 * otherwise from the previous candidate.
 *
 * @param {ManifestOnlyReleaseCandidateOptions} params
 * @returns {ReleaseCandidateArtifactManifest}
 */
export function buildManifestOnlyReleaseCandidateArtifact({
  appSha,
  previousManifest = {},
  openpathVersion,
  linuxAgentVersion,
  linuxAgentAptSuite,
  newWindowsPin = {},
}) {
  /**
   * @param {unknown} value
   * @param {string} key
   * @returns {string}
   */
  const requiredValue = (value, key) => {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      throw new Error(`Manifest-only release candidate is missing required value: ${key}`);
    }
    return normalized;
  };
  const previousWindowsPin = {
    version: previousManifest.windows_offline_installer_template_version,
    commit: previousManifest.windows_offline_installer_template_commit,
    releaseTag: previousManifest.windows_offline_installer_template_release_tag,
    sha256: previousManifest.windows_offline_installer_template_sha256,
  };
  /** @type {WindowsOfflineInstallerTemplatePin} */
  const windowsPin = selectWindowsOfflineInstallerTemplatePin({
    newPin: newWindowsPin,
    previousPin: previousWindowsPin,
  });

  const artifact = {
    APP_SHA: requiredValue(appSha, 'APP_SHA'),
    CLASSROOMPATH_GATEWAY_IMAGE: requiredValue(
      previousManifest.gateway_image,
      'CLASSROOMPATH_GATEWAY_IMAGE'
    ),
    CLASSROOMPATH_MIGRATIONS_IMAGE: requiredValue(
      previousManifest.migrations_image,
      'CLASSROOMPATH_MIGRATIONS_IMAGE'
    ),
    OPENPATH_FIREFOX_ASSETS_IMAGE: requiredValue(
      previousManifest.openpath_firefox_assets_image,
      'OPENPATH_FIREFOX_ASSETS_IMAGE'
    ),
    OPENPATH_API_IMAGE: requiredValue(previousManifest.openpath_api_image, 'OPENPATH_API_IMAGE'),
    OPENPATH_VERSION: requiredValue(openpathVersion, 'OPENPATH_VERSION'),
    OPENPATH_LINUX_AGENT_VERSION: requiredValue(linuxAgentVersion, 'OPENPATH_LINUX_AGENT_VERSION'),
    OPENPATH_LINUX_AGENT_APT_SUITE: requiredValue(
      linuxAgentAptSuite,
      'OPENPATH_LINUX_AGENT_APT_SUITE'
    ),
    windows_offline_installer_template_version: windowsPin.version,
    windows_offline_installer_template_commit: windowsPin.commit,
    windows_offline_installer_template_release_tag: windowsPin.releaseTag,
    windows_offline_installer_template_sha256: windowsPin.sha256,
    CLASSROOMPATH_SPA_IMAGE: requiredValue(previousManifest.spa_image, 'CLASSROOMPATH_SPA_IMAGE'),
    CLASSROOMPATH_VERIFIER_IMAGE: requiredValue(
      previousManifest.verifier_image,
      'CLASSROOMPATH_VERIFIER_IMAGE'
    ),
  };
  return artifact;
}

/**
 * @param {CanonicalReleaseManifest} manifest
 * @returns {string}
 */
export function serializeReleaseManifest(manifest) {
  /** @type {string[]} */
  const keys = [...CANONICAL_RELEASE_MANIFEST_KEYS];
  if (RELEASE_MANIFEST_V2_IDENTITY_KEYS.every((key) => manifest[key])) {
    keys.push(...RELEASE_MANIFEST_V2_IDENTITY_KEYS);
  }
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

/**
 * @param {ReleaseCandidateArtifactManifest} manifest
 * @returns {string}
 */
function serializeArtifactReleaseManifest(manifest) {
  return `${Object.entries(manifest)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

/**
 * @param {string} name
 * @returns {string | undefined}
 */
function readOptionalEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function runManifestOnlyCli() {
  const artifact = buildManifestOnlyReleaseCandidateArtifact({
    appSha: readOptionalEnvironmentValue('APP_SHA'),
    previousManifest: {
      gateway_image: readOptionalEnvironmentValue('PREVIOUS_CLASSROOMPATH_GATEWAY_IMAGE'),
      migrations_image: readOptionalEnvironmentValue('PREVIOUS_CLASSROOMPATH_MIGRATIONS_IMAGE'),
      openpath_firefox_assets_image: readOptionalEnvironmentValue(
        'PREVIOUS_OPENPATH_FIREFOX_ASSETS_IMAGE'
      ),
      openpath_api_image: readOptionalEnvironmentValue('PREVIOUS_OPENPATH_API_IMAGE'),
      spa_image: readOptionalEnvironmentValue('PREVIOUS_CLASSROOMPATH_SPA_IMAGE'),
      verifier_image: readOptionalEnvironmentValue('PREVIOUS_CLASSROOMPATH_VERIFIER_IMAGE'),
      windows_offline_installer_template_version: readOptionalEnvironmentValue(
        'PREVIOUS_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_VERSION'
      ),
      windows_offline_installer_template_commit: readOptionalEnvironmentValue(
        'PREVIOUS_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_COMMIT'
      ),
      windows_offline_installer_template_release_tag: readOptionalEnvironmentValue(
        'PREVIOUS_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG'
      ),
      windows_offline_installer_template_sha256: readOptionalEnvironmentValue(
        'PREVIOUS_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_SHA256'
      ),
    },
    openpathVersion: readOptionalEnvironmentValue('OPENPATH_VERSION'),
    linuxAgentVersion: readOptionalEnvironmentValue('OPENPATH_LINUX_AGENT_VERSION'),
    linuxAgentAptSuite: readOptionalEnvironmentValue('OPENPATH_LINUX_AGENT_APT_SUITE'),
    newWindowsPin: {
      version: readOptionalEnvironmentValue('NEW_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_VERSION'),
      commit: readOptionalEnvironmentValue('NEW_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_COMMIT'),
      releaseTag: readOptionalEnvironmentValue(
        'NEW_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG'
      ),
      sha256: readOptionalEnvironmentValue('NEW_WINDOWS_OFFLINE_INSTALLER_TEMPLATE_SHA256'),
    },
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
