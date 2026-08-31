/**
 * Resolves the pinned OpenPath Linux agent version from the submodule git history for release notes and canary config.
 *
 * Invoked by: legacy explicit runtime-pin validators and compatibility tests.
 * Active promotion workflows consume `verify-openpath-promotion-contract.mjs` directly.
 * Usage: node scripts/resolve-openpath-linux-agent-version.mjs verify-runtime-pin ...
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOpenPathLinuxAgentInstallProbeScript as renderContractInstallProbeScript } from './verify-openpath-promotion-contract.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');
const DEFAULT_OPENPATH_DIR = resolve(projectRoot, 'upstream/openpath');
export const DEFAULT_PROMOTION_CONTRACTS_BASE_URL =
  'https://raw.githubusercontent.com/balejosg/openpath/gh-pages/promotion-contracts';
export const DEFAULT_OPENPATH_APT_BASE_URL =
  'https://raw.githubusercontent.com/balejosg/openpath/gh-pages/apt';

function printUsage() {
  console.error('Usage:');
  console.error(
    '  node scripts/resolve-openpath-linux-agent-version.mjs verify-runtime-pin [--linux-agent-version <version>] [--apt-suite <stable|unstable>] [--apt-base-url <url>]'
  );
  console.error(
    '  node scripts/resolve-openpath-linux-agent-version.mjs install-probe-script [--linux-agent-version <version>] [--apt-suite <stable|unstable>] [--apt-base-url <url>]'
  );
}

function parseVerifyRuntimePinCliArgs(argv) {
  const options = {
    linuxAgentVersion: process.env.OPENPATH_LINUX_AGENT_VERSION?.trim() ?? '',
    aptSuite: process.env.OPENPATH_LINUX_AGENT_APT_SUITE?.trim() ?? '',
    aptBaseUrl: DEFAULT_OPENPATH_APT_BASE_URL,
    openpathDir: DEFAULT_OPENPATH_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--linux-agent-version') {
      options.linuxAgentVersion = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }

    if (token === '--apt-suite') {
      options.aptSuite = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }

    if (token === '--apt-base-url') {
      options.aptBaseUrl = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }

    if (token === '--openpath-dir') {
      options.openpathDir = resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

/**
 * @typedef {{
 *   version: number;
 *   openpathSha: string;
 *   packageVersion: string;
 *   linuxAgentVersion: string;
 *   aptSuite: string;
 *   firefoxExtensionVersion: string;
 *   browserPolicySpecSha256: string;
 * }} OpenPathPromotionContract
 */

export function buildPromotionContractUrl({ baseUrl, openpathSha }) {
  const normalizedBaseUrl = String(baseUrl ?? '').replace(/\/+$/, '');
  const normalizedSha = String(openpathSha ?? '').trim();
  if (!normalizedBaseUrl) {
    throw new Error('Promotion contract base URL is required');
  }
  if (!normalizedSha) {
    throw new Error('OpenPath SHA is required');
  }
  return `${normalizedBaseUrl}/${normalizedSha}.json`;
}

export function buildAptPackagesUrl({ baseUrl, aptSuite }) {
  const normalizedBaseUrl = String(baseUrl ?? '').replace(/\/+$/, '');
  const normalizedAptSuite = String(aptSuite ?? '').trim();
  if (!normalizedBaseUrl) {
    throw new Error('OpenPath APT base URL is required');
  }
  if (!['stable', 'unstable'].includes(normalizedAptSuite)) {
    throw new Error('OpenPath APT suite must be stable or unstable');
  }
  return `${normalizedBaseUrl}/dists/${normalizedAptSuite}/main/binary-amd64/Packages`;
}

export function parseOpenPathPromotionContract(content) {
  const parsed = JSON.parse(String(content ?? ''));
  return /** @type {OpenPathPromotionContract} */ ({
    version: Number(parsed.version ?? 0),
    openpathSha: String(parsed.openpathSha ?? '').trim(),
    packageVersion: String(parsed.packageVersion ?? '').trim(),
    linuxAgentVersion: String(parsed.linuxAgentVersion ?? '').trim(),
    aptSuite: String(parsed.aptSuite ?? '').trim(),
    firefoxExtensionVersion: String(parsed.firefoxExtensionVersion ?? '').trim(),
    browserPolicySpecSha256: String(parsed.browserPolicySpecSha256 ?? '').trim(),
  });
}

export function resolveOpenPathLinuxAgentVersion({ openpathSha, promotionContract }) {
  const normalizedSha = String(openpathSha ?? '').trim();
  if (!normalizedSha) {
    throw new Error('Pinned OpenPath SHA is required');
  }

  if (promotionContract.version !== 1) {
    throw new Error(
      `Unsupported OpenPath promotion contract version: ${promotionContract.version}`
    );
  }

  if (promotionContract.openpathSha !== normalizedSha) {
    throw new Error(
      `Published OpenPath promotion contract does not match the pinned OpenPath SHA (${normalizedSha}).`
    );
  }

  if (!promotionContract.packageVersion) {
    throw new Error('OpenPath promotion contract packageVersion is required');
  }

  if (!promotionContract.linuxAgentVersion) {
    throw new Error('OpenPath promotion contract linuxAgentVersion is required');
  }

  if (!['stable', 'unstable'].includes(promotionContract.aptSuite)) {
    throw new Error('OpenPath promotion contract aptSuite must be stable or unstable');
  }

  return {
    openpathVersion: promotionContract.packageVersion,
    version: promotionContract.linuxAgentVersion,
    aptSuite: promotionContract.aptSuite,
  };
}

export function parseOpenPathDnsmasqAptVersions(content) {
  return String(content ?? '')
    .split(/\n\s*\n/)
    .map((entry) => {
      const fields = Object.fromEntries(
        entry
          .split('\n')
          .map((line) => line.match(/^([^:]+):\s*(.*)$/))
          .filter(Boolean)
          .map((match) => [match[1], match[2].trim()])
      );
      return fields.Package === 'openpath-dnsmasq'
        ? String(fields.Version ?? '').replace(/-[^-]+$/, '')
        : '';
    })
    .filter(Boolean);
}

export function assertOpenPathLinuxAgentVersionAdvertised({
  aptPackagesContent,
  linuxAgentVersion,
  aptSuite,
}) {
  const versions = parseOpenPathDnsmasqAptVersions(aptPackagesContent);
  if (!versions.includes(linuxAgentVersion)) {
    throw new Error(
      `OpenPath linuxAgentVersion ${linuxAgentVersion} is not advertised by the ${aptSuite} APT metadata. Advertised versions: ${versions.join(', ') || 'none'}.`
    );
  }
}

export async function assertOpenPathLinuxAgentRuntimePinAdvertised({
  aptBaseUrl = DEFAULT_OPENPATH_APT_BASE_URL,
  aptSuite,
  linuxAgentVersion,
  downloadText = downloadPromotionContract,
}) {
  const normalizedVersion = String(linuxAgentVersion ?? '').trim();
  const normalizedSuite = String(aptSuite ?? '').trim();

  if (!normalizedVersion) {
    throw new Error('OPENPATH_LINUX_AGENT_VERSION is required');
  }

  if (!['stable', 'unstable'].includes(normalizedSuite)) {
    throw new Error('OPENPATH_LINUX_AGENT_APT_SUITE must be stable or unstable');
  }

  const aptPackagesUrl = buildAptPackagesUrl({
    baseUrl: aptBaseUrl,
    aptSuite: normalizedSuite,
  });

  assertOpenPathLinuxAgentVersionAdvertised({
    aptPackagesContent: await downloadText(aptPackagesUrl),
    linuxAgentVersion: normalizedVersion,
    aptSuite: normalizedSuite,
  });
}

const FIREFOX_POLICY_DEB_PATH = 'usr/local/lib/openpath/lib/firefox-policy.sh';

/**
 * Reads the Firefox managed-extension gecko id the served XPI is built with, from the pinned
 * OpenPath submodule manifest. This is the single source of truth for "which id the fleet's
 * Firefox will be told to install".
 */
export function readManifestGeckoId(manifestJsonText) {
  const parsed = JSON.parse(String(manifestJsonText ?? ''));
  const id = parsed?.browser_specific_settings?.gecko?.id ?? parsed?.applications?.gecko?.id ?? '';
  const normalized = String(id).trim();
  if (!normalized) {
    throw new Error('upstream/openpath/firefox-extension/manifest.json has no gecko id');
  }
  return normalized;
}

/**
 * Extracts the env-default managed-extension id baked into a shipped `firefox-policy.sh`, i.e. the
 * `<id>` in `FIREFOX_MANAGED_EXTENSION_ID="${FIREFOX_MANAGED_EXTENSION_ID:-<id>}"`. This is the id
 * the installed Linux agent will use as the Firefox policy key.
 */
export function parseFirefoxPolicyManagedExtensionId(policyScriptText) {
  const match = String(policyScriptText ?? '').match(
    /FIREFOX_MANAGED_EXTENSION_ID="\$\{FIREFOX_MANAGED_EXTENSION_ID:-([^}"]+)\}"/
  );
  if (!match) {
    throw new Error(
      'Could not find a FIREFOX_MANAGED_EXTENSION_ID default in the agent firefox-policy.sh'
    );
  }
  return match[1].trim();
}

/** Finds the `Filename:` of the `openpath-dnsmasq` stanza whose version matches `linuxAgentVersion`. */
export function findOpenPathDnsmasqDebFilename(aptPackagesContent, linuxAgentVersion) {
  const target = String(linuxAgentVersion ?? '').trim();
  const filename = String(aptPackagesContent ?? '')
    .split(/\n\s*\n/)
    .map((stanza) => {
      const fields = Object.fromEntries(
        stanza
          .split('\n')
          .map((line) => line.match(/^([^:]+):\s*(.*)$/))
          .filter(Boolean)
          .map((match) => [match[1].trim(), match[2].trim()])
      );
      if (fields.Package !== 'openpath-dnsmasq') {
        return null;
      }
      const strippedVersion = String(fields.Version ?? '').replace(/-[^-]+$/, '');
      return strippedVersion === target ? String(fields.Filename ?? '').trim() : null;
    })
    .find(Boolean);
  if (!filename) {
    throw new Error(
      `APT metadata has no openpath-dnsmasq Filename for version ${target}; cannot verify its extension id.`
    );
  }
  return filename;
}

/** Throws (fail-closed) when the blessed agent .deb id does not match the served XPI / manifest id. */
export function assertLinuxAgentExtensionIdMatchesManifest({
  linuxAgentVersion,
  agentExtensionId,
  manifestGeckoId,
}) {
  if (agentExtensionId !== manifestGeckoId) {
    throw new Error(
      `Blessed OpenPath Linux agent (openpath-dnsmasq=${linuxAgentVersion}) ships managed-extension ` +
        `id '${agentExtensionId}', but the pinned OpenPath firefox-extension manifest declares ` +
        `'${manifestGeckoId}'. The fleet self-updates to this agent version via the deployment ` +
        `manifest; a mismatched id means Firefox refuses the served signed XPI and every box loops ` +
        `forever on firefox_registration_missing (the max12 failure). Pin ` +
        `OPENPATH_LINUX_AGENT_VERSION to a build whose .deb id matches the shipped extension.`
    );
  }
}

function extractManagedExtensionIdFromDeb(debBuffer) {
  const workDir = mkdtempSync(join(tmpdir(), 'classroompath-agent-deb-'));
  try {
    const debPath = join(workDir, 'openpath-dnsmasq.deb');
    const extractDir = join(workDir, 'extracted');
    writeFileSync(debPath, debBuffer);
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

async function downloadBufferDefault(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status} ${response.statusText})`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Fail-closed guard for the actual fleet delivery channel: downloads the exact `.deb` the blessed
 * `OPENPATH_LINUX_AGENT_VERSION` resolves to, extracts the Firefox managed-extension id it bakes in,
 * and asserts it equals the pinned OpenPath submodule's gecko id (== the served signed XPI id).
 * IO is injectable so the parse/compare logic is unit-tested without network or dpkg.
 */
export async function assertOpenPathLinuxAgentExtensionIdConsistent({
  aptBaseUrl = DEFAULT_OPENPATH_APT_BASE_URL,
  aptSuite,
  linuxAgentVersion,
  manifestGeckoId,
  downloadText = downloadPromotionContract,
  downloadBuffer = downloadBufferDefault,
  extractId = extractManagedExtensionIdFromDeb,
}) {
  const normalizedVersion = String(linuxAgentVersion ?? '').trim();
  const normalizedSuite = String(aptSuite ?? '').trim();
  const normalizedGeckoId = String(manifestGeckoId ?? '').trim();
  const normalizedBaseUrl = String(aptBaseUrl ?? '').replace(/\/+$/, '');

  if (!normalizedVersion) {
    throw new Error('OPENPATH_LINUX_AGENT_VERSION is required');
  }
  if (!['stable', 'unstable'].includes(normalizedSuite)) {
    throw new Error('OPENPATH_LINUX_AGENT_APT_SUITE must be stable or unstable');
  }
  if (!normalizedGeckoId) {
    throw new Error('manifestGeckoId is required');
  }

  const aptPackagesUrl = buildAptPackagesUrl({
    baseUrl: normalizedBaseUrl,
    aptSuite: normalizedSuite,
  });
  const filename = findOpenPathDnsmasqDebFilename(
    await downloadText(aptPackagesUrl),
    normalizedVersion
  );
  const debBuffer = await downloadBuffer(`${normalizedBaseUrl}/${filename}`);
  // extractId may be sync (dpkg-deb default) or an async mock; normalize via Promise.resolve.
  const agentExtensionId = await Promise.resolve(extractId(debBuffer));

  assertLinuxAgentExtensionIdMatchesManifest({
    linuxAgentVersion: normalizedVersion,
    agentExtensionId,
    manifestGeckoId: normalizedGeckoId,
  });

  return agentExtensionId;
}

export function renderOpenPathLinuxAgentInstallProbeScript({
  aptBaseUrl = DEFAULT_OPENPATH_APT_BASE_URL,
  aptSuite,
  linuxAgentVersion,
}) {
  const normalizedVersion = String(linuxAgentVersion ?? '').trim();
  const normalizedSuite = String(aptSuite ?? '').trim();
  const normalizedBaseUrl = String(aptBaseUrl ?? '')
    .trim()
    .replace(/\/+$/, '');

  if (!normalizedVersion) {
    throw new Error('OPENPATH_LINUX_AGENT_VERSION is required');
  }

  if (!['stable', 'unstable'].includes(normalizedSuite)) {
    throw new Error('OPENPATH_LINUX_AGENT_APT_SUITE must be stable or unstable');
  }

  if (!normalizedBaseUrl) {
    throw new Error('OpenPath APT base URL is required');
  }

  const packageVersion = normalizedVersion.endsWith('-1')
    ? normalizedVersion
    : `${normalizedVersion}-1`;

  return renderContractInstallProbeScript({
    aptBaseUrl: normalizedBaseUrl,
    aptSuite: normalizedSuite,
    packageName: 'openpath-dnsmasq',
    packageVersion,
  });
}

export async function resolveOpenPathLinuxAgentVersionFromContracts({
  pinnedOpenpathSha,
  promotionContractsBaseUrl,
  aptBaseUrl = DEFAULT_OPENPATH_APT_BASE_URL,
  downloadText = downloadPromotionContract,
}) {
  const normalizedPinnedSha = String(pinnedOpenpathSha ?? '').trim();
  if (!normalizedPinnedSha) {
    throw new Error('Pinned OpenPath SHA is required');
  }
  const url = buildPromotionContractUrl({
    baseUrl: promotionContractsBaseUrl,
    openpathSha: normalizedPinnedSha,
  });
  const promotionContract = parseOpenPathPromotionContract(await downloadText(url));
  const result = resolveOpenPathLinuxAgentVersion({
    openpathSha: normalizedPinnedSha,
    promotionContract,
  });
  const aptPackagesUrl = buildAptPackagesUrl({
    baseUrl: aptBaseUrl,
    aptSuite: result.aptSuite,
  });
  assertOpenPathLinuxAgentVersionAdvertised({
    aptPackagesContent: await downloadText(aptPackagesUrl),
    linuxAgentVersion: result.version,
    aptSuite: result.aptSuite,
  });

  return {
    openpathSha: normalizedPinnedSha,
    promotionContractSha: normalizedPinnedSha,
    openpathVersion: result.openpathVersion,
    version: result.version,
    aptSuite: result.aptSuite,
  };
}

async function downloadPromotionContract(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(
      `Failed to download OpenPath promotion contract from ${url} (${response.status} ${response.statusText})`
    );
    error.status = response.status;
    error.statusText = response.statusText;
    throw error;
  }

  return response.text();
}

async function main() {
  if (process.argv[2] === 'verify-runtime-pin') {
    const options = parseVerifyRuntimePinCliArgs(process.argv.slice(3));
    await assertOpenPathLinuxAgentRuntimePinAdvertised({
      aptBaseUrl: options.aptBaseUrl,
      aptSuite: options.aptSuite,
      linuxAgentVersion: options.linuxAgentVersion,
    });
    console.log(
      `OpenPath Linux agent ${options.linuxAgentVersion} is advertised by ${options.aptSuite} APT metadata`
    );

    // Fail closed if the blessed agent version's baked Firefox id != the id the served signed XPI
    // is built with (the pinned submodule's gecko id). This is the guard that would have blocked
    // pinning the pre-rename 0.0.20260507111458 build while serving the new-id extension (max12).
    //
    // The authoritative comparand is the OpenPath submodule's firefox-extension manifest. Some
    // callers (e.g. the deploy build job) run this APT-pin check WITHOUT the submodule checked out;
    // there we emit a loud warning and skip rather than crash, because the strict, fail-closed run
    // happens in verify:promotion-ready (which has the submodule and sets the require flag below).
    const manifestPath = join(options.openpathDir, 'firefox-extension/manifest.json');
    let manifestText = '';
    try {
      manifestText = readFileSync(manifestPath, 'utf8');
    } catch {
      if (process.env.OPENPATH_REQUIRE_AGENT_EXTENSION_ID_CHECK === '1') {
        throw new Error(
          `Firefox extension-id consistency check requires the OpenPath submodule manifest at ${manifestPath}, but it is not present. Check out submodules before promotion.`
        );
      }
      console.warn(
        `::warning::Skipped Firefox extension-id consistency check: OpenPath submodule manifest not found at ${manifestPath}. The authoritative fail-closed check runs in verify:promotion-ready (submodule present).`
      );
      return;
    }

    const manifestGeckoId = readManifestGeckoId(manifestText);
    const agentExtensionId = await assertOpenPathLinuxAgentExtensionIdConsistent({
      aptBaseUrl: options.aptBaseUrl,
      aptSuite: options.aptSuite,
      linuxAgentVersion: options.linuxAgentVersion,
      manifestGeckoId,
    });
    console.log(
      `OpenPath Linux agent ${options.linuxAgentVersion} ships managed-extension id '${agentExtensionId}', matching the pinned firefox-extension manifest`
    );
    return;
  }

  if (process.argv[2] === 'install-probe-script') {
    const options = parseVerifyRuntimePinCliArgs(process.argv.slice(3));
    process.stdout.write(
      renderOpenPathLinuxAgentInstallProbeScript({
        aptBaseUrl: options.aptBaseUrl,
        aptSuite: options.aptSuite,
        linuxAgentVersion: options.linuxAgentVersion,
      })
    );
    return;
  }

  throw new Error(
    'Legacy OpenPath version selection is retired; use verify-openpath-promotion-contract.mjs with the exact v2 contract'
  );
}

if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  main().catch((error) => {
    printUsage();
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
