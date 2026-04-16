import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitOutput as runGitOutput } from './lib/git-process.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const scriptDir = dirname(currentFilePath);
const projectRoot = resolve(scriptDir, '..');
const DEFAULT_OPENPATH_DIR = resolve(projectRoot, 'upstream/openpath');
export const DEFAULT_PROMOTION_CONTRACTS_BASE_URL =
  'https://raw.githubusercontent.com/balejosg/openpath/gh-pages/promotion-contracts';

function printUsage() {
  console.error('Usage:');
  console.error(
    '  node scripts/resolve-openpath-linux-agent-version.mjs [--openpath-dir <path>] [--promotion-contracts-base-url <url>]'
  );
}

function parseCliArgs(argv) {
  const options = {
    openpathDir: DEFAULT_OPENPATH_DIR,
    promotionContractsBaseUrl: DEFAULT_PROMOTION_CONTRACTS_BASE_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--openpath-dir') {
      options.openpathDir = resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token === '--promotion-contracts-base-url') {
      options.promotionContractsBaseUrl = String(argv[index + 1] ?? '').trim();
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

  return {
    openpathVersion: promotionContract.packageVersion,
    version: promotionContract.linuxAgentVersion,
  };
}

export function isMissingPromotionContractError(error) {
  return Number(error?.status ?? 0) === 404;
}

export async function resolveOpenPathLinuxAgentVersionFromContracts({
  pinnedOpenpathSha,
  candidateOpenpathShas,
  promotionContractsBaseUrl,
  downloadText = downloadPromotionContract,
}) {
  const normalizedPinnedSha = String(pinnedOpenpathSha ?? '').trim();
  if (!normalizedPinnedSha) {
    throw new Error('Pinned OpenPath SHA is required');
  }

  const candidates = [
    ...new Set(
      [normalizedPinnedSha, ...(candidateOpenpathShas ?? [])]
        .map((candidate) => String(candidate ?? '').trim())
        .filter(Boolean)
    ),
  ];

  for (const candidateSha of candidates) {
    const url = buildPromotionContractUrl({
      baseUrl: promotionContractsBaseUrl,
      openpathSha: candidateSha,
    });

    try {
      const promotionContract = parseOpenPathPromotionContract(await downloadText(url));
      const result = resolveOpenPathLinuxAgentVersion({
        openpathSha: candidateSha,
        promotionContract,
      });

      return {
        openpathSha: normalizedPinnedSha,
        promotionContractSha: candidateSha,
        openpathVersion: result.openpathVersion,
        version: result.version,
      };
    } catch (error) {
      if (isMissingPromotionContractError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `No OpenPath promotion contract found for pinned SHA ${normalizedPinnedSha} or its first-parent ancestors.`
  );
}

function gitOutput(openpathDir, args) {
  return runGitOutput(['-C', openpathDir, ...args], { cwd: projectRoot });
}

function resolveOpenPathSha(openpathDir) {
  return gitOutput(openpathDir, ['rev-parse', 'HEAD']);
}

function resolveOpenPathCandidateShas(openpathDir) {
  return gitOutput(openpathDir, ['rev-list', '--first-parent', '--max-count=50', 'HEAD'])
    .split('\n')
    .map((sha) => sha.trim())
    .filter(Boolean);
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

function writeOutputs(outputMap) {
  for (const [key, value] of Object.entries(outputMap)) {
    process.stdout.write(`${key}=${value}\n`);
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const openpathSha = resolveOpenPathSha(options.openpathDir);
  const result = await resolveOpenPathLinuxAgentVersionFromContracts({
    pinnedOpenpathSha: openpathSha,
    candidateOpenpathShas: resolveOpenPathCandidateShas(options.openpathDir),
    promotionContractsBaseUrl: options.promotionContractsBaseUrl,
  });

  writeOutputs({
    openpath_sha: openpathSha,
    openpath_promotion_contract_sha: result.promotionContractSha,
    openpath_version: result.openpathVersion,
    version: result.version,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === currentFilePath) {
  main().catch((error) => {
    printUsage();
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
