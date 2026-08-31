import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const DEFAULT_OPENPATH_PROMOTION_CONTRACTS_V2_BASE_URL =
  'https://raw.githubusercontent.com/balejosg/OpenPath/gh-pages/promotion-contracts/v2';

export const SUPPORTED_OPENPATH_PROMOTION_INTERFACES = Object.freeze({
  wrapperIntegration: 1,
  windowsOfflineInstaller: 1,
  readiness: 1,
});

const SHA40_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMPONENT_NAMES = Object.freeze(['linuxAgent', 'windowsOfflineInstaller', 'browserPolicy']);
const COMPONENT_FIELDS = Object.freeze({
  linuxAgent: Object.freeze([
    'sourceSha',
    'inputsSha256',
    'packageName',
    'packageVersion',
    'aptSuite',
    'filename',
    'sha256',
  ]),
  windowsOfflineInstaller: Object.freeze([
    'sourceSha',
    'inputsSha256',
    'version',
    'releaseTag',
    'templateAsset',
    'templateSha256',
    'payloadManifestAsset',
    'payloadManifestSha256',
  ]),
  browserPolicy: Object.freeze([
    'sourceSha',
    'inputsSha256',
    'firefoxExtensionVersion',
    'browserPolicySpecSha256',
  ]),
});

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(label + ' must be an object');
  }
}

function assertExactKeys(value, expectedKeys, label) {
  assertRecord(value, label);
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new Error(label + ' contains unknown property ' + key);
    }
  }
  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(label + '.' + key + ' is required');
    }
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(label + ' is required');
  }
  return value.trim();
}

function assertSha40(value, label) {
  if (typeof value !== 'string' || !SHA40_PATTERN.test(value)) {
    throw new Error(label + ' must be a 40-character lowercase SHA');
  }
  return value;
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(label + ' must be a 64-character lowercase SHA-256 hex string');
  }
  return value;
}

function canonicalizeComponent(componentName, component) {
  assertRecord(component, 'components.' + componentName);
  assertExactKeys(component, COMPONENT_FIELDS[componentName], 'components.' + componentName);

  const sourceSha = assertSha40(component.sourceSha, 'components.' + componentName + '.sourceSha');
  const inputsSha256 = assertSha256(
    component.inputsSha256,
    'components.' + componentName + '.inputsSha256'
  );

  if (componentName === 'linuxAgent') {
    const packageName = assertNonEmptyString(
      component.packageName,
      'components.linuxAgent.packageName'
    );
    if (packageName !== 'openpath-dnsmasq') {
      throw new Error('components.linuxAgent.packageName must be openpath-dnsmasq');
    }
    const packageVersion = assertNonEmptyString(
      component.packageVersion,
      'components.linuxAgent.packageVersion'
    );
    const aptSuite = assertNonEmptyString(component.aptSuite, 'components.linuxAgent.aptSuite');
    if (aptSuite !== 'stable' && aptSuite !== 'unstable') {
      throw new Error('Unsupported components.linuxAgent.aptSuite: ' + aptSuite);
    }
    const filename = assertNonEmptyString(component.filename, 'components.linuxAgent.filename');
    const sha256 = assertSha256(component.sha256, 'components.linuxAgent.sha256');
    return {
      sourceSha,
      inputsSha256,
      packageName,
      packageVersion,
      aptSuite,
      filename,
      sha256,
    };
  }

  if (componentName === 'windowsOfflineInstaller') {
    const version = assertNonEmptyString(
      component.version,
      'components.windowsOfflineInstaller.version'
    );
    const releaseTag = assertNonEmptyString(
      component.releaseTag,
      'components.windowsOfflineInstaller.releaseTag'
    );
    const releasePrefix = 'scripts-v' + version + '-';
    const shortSha = releaseTag.startsWith(releasePrefix)
      ? releaseTag.slice(releasePrefix.length)
      : '';
    if (
      !/^[0-9a-f]{7,40}$/.test(shortSha) ||
      !sourceSha.startsWith(shortSha) ||
      releaseTag !== releasePrefix + shortSha
    ) {
      throw new Error(
        'components.windowsOfflineInstaller.releaseTag must derive from sourceSha ' + sourceSha
      );
    }
    const templateAsset = assertNonEmptyString(
      component.templateAsset,
      'components.windowsOfflineInstaller.templateAsset'
    );
    if (templateAsset !== 'OpenPath-Windows-Setup-Template.exe') {
      throw new Error(
        'components.windowsOfflineInstaller.templateAsset must be OpenPath-Windows-Setup-Template.exe'
      );
    }
    const templateSha256 = assertSha256(
      component.templateSha256,
      'components.windowsOfflineInstaller.templateSha256'
    );
    const payloadManifestAsset = assertNonEmptyString(
      component.payloadManifestAsset,
      'components.windowsOfflineInstaller.payloadManifestAsset'
    );
    if (payloadManifestAsset !== 'payload-manifest.json') {
      throw new Error(
        'components.windowsOfflineInstaller.payloadManifestAsset must be payload-manifest.json'
      );
    }
    const payloadManifestSha256 = assertSha256(
      component.payloadManifestSha256,
      'components.windowsOfflineInstaller.payloadManifestSha256'
    );
    return {
      sourceSha,
      inputsSha256,
      version,
      releaseTag,
      templateAsset,
      templateSha256,
      payloadManifestAsset,
      payloadManifestSha256,
    };
  }

  return {
    sourceSha,
    inputsSha256,
    firefoxExtensionVersion: assertNonEmptyString(
      component.firefoxExtensionVersion,
      'components.browserPolicy.firefoxExtensionVersion'
    ),
    browserPolicySpecSha256: assertSha256(
      component.browserPolicySpecSha256,
      'components.browserPolicy.browserPolicySpecSha256'
    ),
  };
}

function canonicalizeInterfaces(interfaces) {
  assertExactKeys(interfaces, Object.keys(SUPPORTED_OPENPATH_PROMOTION_INTERFACES), 'interfaces');
  for (const [name, expectedVersion] of Object.entries(SUPPORTED_OPENPATH_PROMOTION_INTERFACES)) {
    if (interfaces[name] !== expectedVersion) {
      throw new Error('interfaces.' + name + ' must be ' + expectedVersion);
    }
  }
  return { ...SUPPORTED_OPENPATH_PROMOTION_INTERFACES };
}

function canonicalizeContract(contract) {
  assertExactKeys(
    contract,
    ['schemaVersion', 'openpathSha', 'openpathVersion', 'interfaces', 'components'],
    'v2 contract'
  );
  if (contract.schemaVersion !== 2) {
    throw new Error('v2 contract.schemaVersion must be 2');
  }

  const openpathSha = assertSha40(contract.openpathSha, 'openpathSha');
  const openpathVersion = assertNonEmptyString(contract.openpathVersion, 'openpathVersion');
  const interfaces = canonicalizeInterfaces(contract.interfaces);
  assertExactKeys(contract.components, COMPONENT_NAMES, 'components');

  return {
    schemaVersion: 2,
    openpathSha,
    openpathVersion,
    interfaces,
    components: {
      linuxAgent: canonicalizeComponent('linuxAgent', contract.components.linuxAgent),
      windowsOfflineInstaller: canonicalizeComponent(
        'windowsOfflineInstaller',
        contract.components.windowsOfflineInstaller
      ),
      browserPolicy: canonicalizeComponent('browserPolicy', contract.components.browserPolicy),
    },
  };
}

export function validateOpenPathPromotionContractV2(contract, { expectedOpenpathSha } = {}) {
  const canonicalContract = canonicalizeContract(contract);
  if (expectedOpenpathSha !== undefined) {
    const requestedSha = assertSha40(expectedOpenpathSha, 'expectedOpenpathSha');
    if (canonicalContract.openpathSha !== requestedSha) {
      throw new Error(
        'contract.openpathSha ' +
          canonicalContract.openpathSha +
          ' does not match the exact OpenPath SHA ' +
          requestedSha
      );
    }
  }
  return canonicalContract;
}

export const validateOpenPathPromotionContract = validateOpenPathPromotionContractV2;

export function buildOpenPathPromotionContractUrl({
  baseUrl = DEFAULT_OPENPATH_PROMOTION_CONTRACTS_V2_BASE_URL,
  openpathSha,
}) {
  const requestedSha = assertSha40(openpathSha, 'openpathSha');
  const normalizedBaseUrl = String(baseUrl ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!normalizedBaseUrl) {
    throw new Error('promotion contract base URL is required');
  }
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(normalizedBaseUrl);
  } catch {
    throw new Error('promotion contract base URL is invalid: ' + normalizedBaseUrl);
  }
  if (parsedBaseUrl.protocol !== 'https:' && parsedBaseUrl.protocol !== 'http:') {
    throw new Error('promotion contract base URL must use HTTP(S)');
  }
  if (parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new Error('promotion contract base URL must not contain query or fragment');
  }
  return normalizedBaseUrl + '/' + requestedSha + '.json';
}

export function parseOpenPathPromotionContractBytes(bytes, { expectedOpenpathSha } = {}) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error('OpenPath promotion contract bytes must be a byte array');
  }
  const contractBytes = Buffer.from(bytes);
  let parsed;
  try {
    parsed = JSON.parse(contractBytes.toString('utf8'));
  } catch (error) {
    throw new Error('invalid OpenPath v2 promotion contract JSON: ' + error.message, {
      cause: error,
    });
  }
  const contract = validateOpenPathPromotionContractV2(parsed, { expectedOpenpathSha });
  return {
    contract,
    contractBytes,
    contractSha256: createHash('sha256').update(contractBytes).digest('hex'),
  };
}

async function readResponseBytes(response) {
  if (response && typeof response.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer());
  }
  if (response && typeof response.text === 'function') {
    return Buffer.from(await response.text(), 'utf8');
  }
  throw new Error('exact OpenPath v2 promotion contract response has no body reader');
}

export async function resolveOpenPathPromotionContract({
  openpathSha,
  baseUrl = DEFAULT_OPENPATH_PROMOTION_CONTRACTS_V2_BASE_URL,
  promotionContractsBaseUrl,
  fetchImpl = globalThis.fetch,
} = {}) {
  const requestedSha = assertSha40(openpathSha, 'openpathSha');
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is required to resolve the exact OpenPath contract');
  }
  const url = buildOpenPathPromotionContractUrl({
    baseUrl: promotionContractsBaseUrl ?? baseUrl,
    openpathSha: requestedSha,
  });

  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error('exact OpenPath v2 promotion contract download failed: ' + error.message, {
      cause: error,
    });
  }
  const status = Number(response?.status ?? 0);
  const ok = response?.ok === true || (response?.ok === undefined && status >= 200 && status < 300);
  if (!ok) {
    throw new Error('exact OpenPath v2 promotion contract download failed: HTTP ' + status);
  }

  let bytes;
  try {
    bytes = await readResponseBytes(response);
  } catch (error) {
    throw new Error('exact OpenPath v2 promotion contract download failed: ' + error.message, {
      cause: error,
    });
  }
  return {
    openpathSha: requestedSha,
    url,
    ...parseOpenPathPromotionContractBytes(bytes, { expectedOpenpathSha: requestedSha }),
  };
}

export function resolveOpenPathGitlinkSha({
  repoRoot = process.cwd(),
  execFileSyncImpl = execFileSync,
} = {}) {
  const output = execFileSyncImpl('git', ['rev-parse', 'HEAD:upstream/openpath'], {
    cwd: resolve(repoRoot),
    encoding: 'utf8',
  });
  if (typeof output !== 'string' && !Buffer.isBuffer(output)) {
    throw new Error('gitlink OpenPath SHA command returned non-text output');
  }
  const value = String(output).trim();
  return assertSha40(value, 'gitlink OpenPath SHA');
}

export function writeOpenPathPromotionContractArtifact({ outputPath, contractBytes }) {
  const resolvedOutputPath = String(outputPath ?? '').trim();
  if (!resolvedOutputPath) {
    throw new Error('outputPath is required');
  }
  if (!Buffer.isBuffer(contractBytes) && !(contractBytes instanceof Uint8Array)) {
    throw new Error('contractBytes must be a byte array');
  }
  const absoluteOutputPath = resolve(resolvedOutputPath);
  mkdirSync(dirname(absoluteOutputPath), { recursive: true });
  writeFileSync(absoluteOutputPath, Buffer.from(contractBytes));
  return absoluteOutputPath;
}

export function readOpenPathPromotionContractArtifact(path) {
  return readFileSync(resolve(path));
}
