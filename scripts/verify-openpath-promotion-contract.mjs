#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseOpenPathPromotionContractBytes } from './lib/openpath-promotion-contract.mjs';

const DEFAULT_OPENPATH_APT_BASE_URL =
  'https://raw.githubusercontent.com/balejosg/OpenPath/gh-pages/apt';
const DEFAULT_OPENPATH_RELEASE_REPOSITORY = 'balejosg/OpenPath';
const DEFAULT_OPENPATH_FIREFOX_MANIFEST_FILE = 'upstream/openpath/firefox-extension/manifest.json';
const FIREFOX_POLICY_DEB_PATH = 'usr/local/lib/openpath/lib/firefox-policy.sh';

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

function readManifestGeckoId(manifestBytes) {
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  const extensionId =
    manifest?.browser_specific_settings?.gecko?.id ?? manifest?.applications?.gecko?.id ?? '';
  const normalizedExtensionId = String(extensionId).trim();
  if (!normalizedExtensionId) {
    throw new Error('OpenPath Firefox manifest has no Gecko extension ID');
  }
  return normalizedExtensionId;
}

export function parseFirefoxPolicyManagedExtensionId(policyScriptText) {
  const match = String(policyScriptText ?? '').match(
    /FIREFOX_MANAGED_EXTENSION_ID="\$\{FIREFOX_MANAGED_EXTENSION_ID:-([^}"]+)\}"/
  );
  if (!match) {
    throw new Error(
      'OpenPath Linux package firefox-policy.sh has no FIREFOX_MANAGED_EXTENSION_ID default'
    );
  }
  return match[1].trim();
}

export function extractOpenPathFirefoxManagedExtensionId(debBytes) {
  const workDir = mkdtempSync(join(tmpdir(), 'classroompath-openpath-deb-'));
  try {
    const debPath = join(workDir, 'openpath-dnsmasq.deb');
    const extractDir = join(workDir, 'extracted');
    writeFileSync(debPath, debBytes);
    execFileSync('dpkg-deb', ['-x', debPath, extractDir], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    return parseFirefoxPolicyManagedExtensionId(
      readFileSync(join(extractDir, FIREFOX_POLICY_DEB_PATH), 'utf8')
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function assertFirefoxExtensionIdConsistency({ agentExtensionId, manifestGeckoId }) {
  if (agentExtensionId !== manifestGeckoId) {
    throw new Error(
      `Firefox extension ID mismatch: exact OpenPath Linux package ships '${agentExtensionId}', ` +
        `but the pinned OpenPath Firefox manifest declares '${manifestGeckoId}'`
    );
  }
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

export function renderOpenPathExactDebSystemdInstallProbeScript({
  packageName,
  packageVersion,
  packageSha256,
  packageBytes,
} = {}) {
  const normalizedPackageName = String(packageName ?? '').trim();
  const normalizedPackageVersion = String(packageVersion ?? '').trim();
  const normalizedPackageSha256 = String(packageSha256 ?? '').trim();

  if (!normalizedPackageName) {
    throw new Error('OpenPath Linux package name is required');
  }
  if (!normalizedPackageVersion) {
    throw new Error('OpenPath Linux package version is required');
  }
  if (!/^[0-9a-f]{64}$/.test(normalizedPackageSha256)) {
    throw new Error('OpenPath Linux package SHA-256 is required');
  }
  if (!Buffer.isBuffer(packageBytes) && !(packageBytes instanceof Uint8Array)) {
    throw new Error('OpenPath Linux package bytes are required');
  }

  const exactPackageBase64 = Buffer.from(packageBytes)
    .toString('base64')
    .match(/.{1,76}/g)
    ?.join('\n');
  if (!exactPackageBase64) {
    throw new Error('OpenPath Linux package bytes must not be empty');
  }

  const packageSha256Shell = shellSingleQuote(normalizedPackageSha256);
  const packageVersionShell = shellSingleQuote(normalizedPackageVersion);

  return `#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="\${OPENPATH_EXACT_DEB_PROBE_IMAGE_TAG:-classroompath-openpath-deb-probe:latest}"
CONTAINER_NAME="\${OPENPATH_EXACT_DEB_PROBE_CONTAINER_NAME:-classroompath-openpath-deb-probe-\$\$}"
PROBE_DIR="\$(mktemp -d -t classroompath-openpath-deb-probe.XXXXXXXX)"
PACKAGE_PATH="\$PROBE_DIR/openpath-package.deb"

cleanup() {
  docker rm -f "\$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "\$PROBE_DIR"
}
trap cleanup EXIT

cat > "\$PROBE_DIR/openpath-package.deb.b64" <<'OPENPATH_EXACT_DEB_BASE64'
${exactPackageBase64}
OPENPATH_EXACT_DEB_BASE64
base64 --decode "\$PROBE_DIR/openpath-package.deb.b64" > "\$PACKAGE_PATH"
actual_sha256="\$(sha256sum "\$PACKAGE_PATH" | awk '{print \$1}')"
if [ "\$actual_sha256" != ${packageSha256Shell} ]; then
  echo "Exact OpenPath package probe bytes changed before Docker build: expected=${normalizedPackageSha256} actual=\$actual_sha256" >&2
  exit 1
fi

cat > "\$PROBE_DIR/Dockerfile" <<'OPENPATH_EXACT_DEB_DOCKERFILE'
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV container=docker

RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends systemd systemd-sysv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN rm -f /lib/systemd/system/multi-user.target.wants/* \
    /etc/systemd/system/*.wants/* \
    /lib/systemd/system/local-fs.target.wants/* \
    /lib/systemd/system/sockets.target.wants/*udev* \
    /lib/systemd/system/sockets.target.wants/*initctl* \
    /lib/systemd/system/sysinit.target.wants/systemd-tmpfiles-setup* \
    /lib/systemd/system/systemd-update-utmp*

COPY openpath-package.deb /tmp/openpath-package.deb

STOPSIGNAL SIGRTMIN+3
VOLUME ["/sys/fs/cgroup"]
CMD ["/lib/systemd/systemd"]
OPENPATH_EXACT_DEB_DOCKERFILE

docker build --tag "\$IMAGE_TAG" "\$PROBE_DIR"
docker rm -f "\$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run --detach --name "\$CONTAINER_NAME" \
  --privileged \
  --cgroupns=host \
  --volume /sys/fs/cgroup:/sys/fs/cgroup:rw \
  "\$IMAGE_TAG" >/dev/null

wait_for_systemd() {
  local state
  for _ in \$(seq 1 60); do
    state="\$(docker exec "\$CONTAINER_NAME" systemctl is-system-running 2>/dev/null || true)"
    case "\$state" in
      running|degraded)
        return 0
        ;;
    esac
    sleep 1
  done

  docker exec "\$CONTAINER_NAME" systemctl --no-pager --failed || true
  docker exec "\$CONTAINER_NAME" journalctl --no-pager -n 200 || true
  echo 'Timed out waiting for systemd in the exact OpenPath package probe' >&2
  return 1
}

wait_for_systemd
docker exec "\$CONTAINER_NAME" bash -s -- <<'OPENPATH_EXACT_DEB_CHECK'
  set -euo pipefail
  test "\$(sha256sum /tmp/openpath-package.deb | cut -d " " -f1)" = ${packageSha256Shell}
  apt-get update -qq
  apt-get install -y --no-install-recommends /tmp/openpath-package.deb
  apt-get check
  test "\$(dpkg-query -W -f='\${Version}' ${shellSingleQuote(normalizedPackageName)})" = ${packageVersionShell}
  test -z "\$(dpkg --audit)"
  systemctl is-active --quiet dnsmasq
  systemctl is-enabled openpath-dnsmasq.timer >/dev/null
OPENPATH_EXACT_DEB_CHECK

echo "Exact OpenPath Linux package ${normalizedPackageName}=${normalizedPackageVersion} installed and passed systemd checks"
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
  openpathManifestBytes,
  extractFirefoxManagedExtensionId = extractOpenPathFirefoxManagedExtensionId,
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

  const firefoxManifestGeckoId = readManifestGeckoId(
    openpathManifestBytes ?? readFileSync(resolve(DEFAULT_OPENPATH_FIREFOX_MANIFEST_FILE), 'utf8')
  );
  const linuxAgentFirefoxExtensionId = await Promise.resolve(
    extractFirefoxManagedExtensionId(exactArtifactBytes)
  );
  assertFirefoxExtensionIdConsistency({
    agentExtensionId: linuxAgentFirefoxExtensionId,
    manifestGeckoId: firefoxManifestGeckoId,
  });

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
    linuxArtifactBytes: exactArtifactBytes,
    linuxAgentFirefoxExtensionId,
    firefoxManifestGeckoId,
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
    openpathManifestFile:
      process.env.OPENPATH_FIREFOX_MANIFEST_FILE?.trim() || DEFAULT_OPENPATH_FIREFOX_MANIFEST_FILE,
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
    if (token === '--openpath-manifest-file') {
      options.openpathManifestFile = String(argv[index + 1] ?? '').trim();
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
    openpathManifestBytes: readFileSync(resolve(options.openpathManifestFile)),
  });
  if (options.installProbeScript) {
    process.stdout.write(
      renderOpenPathExactDebSystemdInstallProbeScript({
        packageName: result.linuxAgent.packageName,
        packageVersion: result.linuxAgent.packageVersion,
        packageSha256: result.linuxAgent.sha256,
        packageBytes: result.linuxArtifactBytes,
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
