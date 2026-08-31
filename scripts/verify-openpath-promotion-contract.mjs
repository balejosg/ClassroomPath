#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOpenPathPromotionContractBytes } from './lib/openpath-promotion-contract.mjs';

const DEFAULT_OPENPATH_APT_BASE_URL =
  'https://raw.githubusercontent.com/balejosg/OpenPath/gh-pages/apt';
const DEFAULT_OPENPATH_RELEASE_REPOSITORY = 'balejosg/OpenPath';

function parseDebianStanzas(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .filter((stanza) => stanza.trim())
    .map((stanza) => {
      const fields = {};
      for (const line of stanza.split('\n')) {
        const separator = line.indexOf(':');
        if (separator === -1) continue;
        fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      }
      return fields;
    });
}

function buildAptPackagesUrl({ baseUrl, aptSuite }) {
  return (
    String(baseUrl ?? '').replace(/\/+$/, '') + '/dists/' + aptSuite + '/main/binary-amd64/Packages'
  );
}

function buildAptArtifactUrl({ baseUrl, filename }) {
  if (!filename || filename.startsWith('/') || filename.includes('..')) {
    throw new Error('OpenPath Linux contract filename is unsafe');
  }
  return String(baseUrl ?? '').replace(/\/+$/, '') + '/' + filename;
}

function buildReleaseAssetUrl({ repository, releaseTag, assetName }) {
  const normalizedRepository = String(repository ?? '').trim();
  const normalizedTag = String(releaseTag ?? '').trim();
  const normalizedAsset = String(assetName ?? '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalizedRepository)) {
    throw new Error('OpenPath release repository is invalid');
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(normalizedTag)) {
    throw new Error('OpenPath release tag is unsafe');
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(normalizedAsset)) {
    throw new Error('OpenPath release asset name is unsafe');
  }
  return (
    'https://github.com/' +
    normalizedRepository +
    '/releases/download/' +
    normalizedTag +
    '/' +
    normalizedAsset
  );
}

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/** @param {any} options */
export function renderOpenPathLinuxAgentInstallProbeScript({
  aptBaseUrl = DEFAULT_OPENPATH_APT_BASE_URL,
  aptSuite,
  packageName,
  packageVersion,
} = {}) {
  const normalizedBaseUrl = String(aptBaseUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
  const normalizedSuite = String(aptSuite ?? '').trim();
  const normalizedPackageName = String(packageName ?? '').trim();
  const normalizedPackageVersion = String(packageVersion ?? '').trim();

  if (!normalizedBaseUrl) {
    throw new Error('OpenPath APT base URL is required');
  }
  if (!['stable', 'unstable'].includes(normalizedSuite)) {
    throw new Error('OpenPath APT suite must be stable or unstable');
  }
  if (!normalizedPackageName) {
    throw new Error('OpenPath Linux package name is required');
  }
  if (!normalizedPackageVersion) {
    throw new Error('OpenPath Linux package version is required');
  }

  const packagePin = `${normalizedPackageName}=${normalizedPackageVersion}`;
  const setupFlag = normalizedSuite === 'unstable' ? '--unstable' : '--stable';

  return `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export OPENPATH_APT_REPO_URL=${shellSingleQuote(normalizedBaseUrl)}
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl gnupg
curl -fsSL "\${OPENPATH_APT_REPO_URL}/apt-setup.sh" | bash -s -- ${setupFlag}
apt-get update -qq
apt-cache show ${shellSingleQuote(packagePin)} >/dev/null
apt-get install -y --no-install-recommends ${shellSingleQuote(packagePin)}
apt-get check
test "\$(dpkg-query -W -f='\${Version}' ${shellSingleQuote(normalizedPackageName)})" = ${shellSingleQuote(normalizedPackageVersion)}
`;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('OpenPath provenance download failed: HTTP ' + response.status + ' ' + url);
  }
  return response.text();
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('OpenPath provenance download failed: HTTP ' + response.status + ' ' + url);
  }
  return Buffer.from(await response.arrayBuffer());
}

function assertLinuxPackageTuple({ contractComponent, aptPackagesContent }) {
  const match = parseDebianStanzas(aptPackagesContent).find(
    (fields) =>
      fields.Package === contractComponent.packageName &&
      fields.Version === contractComponent.packageVersion &&
      fields.Filename === contractComponent.filename &&
      fields.SHA256 === contractComponent.sha256
  );
  if (!match) {
    throw new Error(
      'APT metadata does not contain the exact openpath-dnsmasq package tuple from the v2 contract'
    );
  }
  return match;
}

/** @param {any} options */
export async function verifyOpenPathPromotionContract({
  contractBytes,
  expectedOpenpathSha,
  aptBaseUrl = DEFAULT_OPENPATH_APT_BASE_URL,
  downloadText = fetchText,
  downloadBytes = fetchBytes,
  downloadReleaseAssetBytes = downloadBytes,
  releaseRepository = DEFAULT_OPENPATH_RELEASE_REPOSITORY,
  aptPackagesContent,
  linuxArtifactBytes,
} = {}) {
  const parsed = parseOpenPathPromotionContractBytes(contractBytes, { expectedOpenpathSha });
  const linuxAgent = parsed.contract.components.linuxAgent;
  const aptPackagesUrl = buildAptPackagesUrl({
    baseUrl: aptBaseUrl,
    aptSuite: linuxAgent.aptSuite,
  });
  const packagesText = aptPackagesContent ?? (await downloadText(aptPackagesUrl));
  assertLinuxPackageTuple({
    contractComponent: linuxAgent,
    aptPackagesContent: packagesText,
  });

  const artifactUrl = buildAptArtifactUrl({
    baseUrl: aptBaseUrl,
    filename: linuxAgent.filename,
  });
  const exactArtifactBytes = linuxArtifactBytes ?? (await downloadBytes(artifactUrl));
  const artifactSha256 = createHash('sha256').update(exactArtifactBytes).digest('hex');
  if (artifactSha256 !== linuxAgent.sha256) {
    throw new Error(
      'OpenPath Linux package bytes does not match the contract SHA-256: expected=' +
        linuxAgent.sha256 +
        ' actual=' +
        artifactSha256
    );
  }

  const windows = parsed.contract.components.windowsOfflineInstaller;
  const templateUrl = buildReleaseAssetUrl({
    repository: releaseRepository,
    releaseTag: windows.releaseTag,
    assetName: windows.templateAsset,
  });
  const payloadManifestUrl = buildReleaseAssetUrl({
    repository: releaseRepository,
    releaseTag: windows.releaseTag,
    assetName: windows.payloadManifestAsset,
  });
  const templateBytes = await downloadReleaseAssetBytes(templateUrl);
  const templateSha256 = createHash('sha256').update(templateBytes).digest('hex');
  if (templateSha256 !== windows.templateSha256) {
    throw new Error(
      'OpenPath Windows template bytes do not match the contract SHA-256: expected=' +
        windows.templateSha256 +
        ' actual=' +
        templateSha256
    );
  }
  const payloadManifestBytes = await downloadReleaseAssetBytes(payloadManifestUrl);
  const payloadManifestSha256 = createHash('sha256').update(payloadManifestBytes).digest('hex');
  if (payloadManifestSha256 !== windows.payloadManifestSha256) {
    throw new Error(
      'OpenPath Windows payload manifest bytes do not match the contract SHA-256: expected=' +
        windows.payloadManifestSha256 +
        ' actual=' +
        payloadManifestSha256
    );
  }

  return {
    ...parsed,
    openpathSha: parsed.contract.openpathSha,
    linuxAgent,
    windowsOfflineInstaller: parsed.contract.components.windowsOfflineInstaller,
    browserPolicy: parsed.contract.components.browserPolicy,
    aptPackagesUrl,
    artifactUrl,
    templateUrl,
    payloadManifestUrl,
  };
}

function parseArgs(argv) {
  const options = {
    contractFile: '',
    openpathSha: process.env.OPENPATH_SHA?.trim() ?? '',
    aptBaseUrl: process.env.OPENPATH_APT_BASE_URL?.trim() || DEFAULT_OPENPATH_APT_BASE_URL,
    releaseRepository:
      process.env.OPENPATH_RELEASE_REPOSITORY?.trim() || DEFAULT_OPENPATH_RELEASE_REPOSITORY,
    json: false,
    installProbeScript: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--contract-file') {
      options.contractFile = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--openpath-sha') {
      options.openpathSha = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--apt-base-url') {
      options.aptBaseUrl = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--release-repository') {
      options.releaseRepository = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--install-probe-script') {
      options.installProbeScript = true;
      continue;
    }
    throw new Error('Unknown argument: ' + token);
  }
  return options;
}

export async function runOpenPathPromotionContractVerifier(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.contractFile) {
    throw new Error('--contract-file is required');
  }
  const result = await verifyOpenPathPromotionContract({
    contractBytes: readFileSync(resolve(options.contractFile)),
    expectedOpenpathSha: options.openpathSha || undefined,
    aptBaseUrl: options.aptBaseUrl,
    releaseRepository: options.releaseRepository,
  });
  if (options.installProbeScript) {
    process.stdout.write(
      renderOpenPathLinuxAgentInstallProbeScript({
        aptBaseUrl: options.aptBaseUrl,
        aptSuite: result.linuxAgent.aptSuite,
        packageName: result.linuxAgent.packageName,
        packageVersion: result.linuxAgent.packageVersion,
      })
    );
    return result;
  }
  const output = {
    openpath_sha: result.openpathSha,
    contract_sha256: result.contractSha256,
    openpath_version: result.contract.openpathVersion,
    linux_agent_version: result.linuxAgent.packageVersion,
    linux_agent_apt_suite: result.linuxAgent.aptSuite,
    windows_offline_installer_template_version: result.windowsOfflineInstaller.version,
    windows_offline_installer_template_commit: result.windowsOfflineInstaller.sourceSha,
    windows_offline_installer_template_release_tag: result.windowsOfflineInstaller.releaseTag,
    windows_offline_installer_template_sha256: result.windowsOfflineInstaller.templateSha256,
  };
  process.stdout.write(
    (options.json
      ? JSON.stringify(output)
      : Object.entries(output)
          .map(([k, v]) => k + '=' + v)
          .join('\n')) + '\n'
  );
  return result;
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFilePath)) {
  runOpenPathPromotionContractVerifier().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
