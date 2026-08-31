#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_OPENPATH_PROMOTION_CONTRACTS_V2_BASE_URL,
  resolveOpenPathGitlinkSha,
  resolveOpenPathPromotionContract,
  writeOpenPathPromotionContractArtifact,
} from './lib/openpath-promotion-contract.mjs';

export * from './lib/openpath-promotion-contract.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(currentFilePath, '..', '..');

export function parseOpenPathPromotionContractCliArgs(argv = []) {
  const options = {
    openpathSha: process.env.OPENPATH_SHA?.trim() ?? '',
    repoRoot: process.env.CLASSROOMPATH_REPO_ROOT?.trim() || projectRoot,
    baseUrl:
      process.env.OPENPATH_PROMOTION_CONTRACTS_V2_BASE_URL?.trim() ||
      DEFAULT_OPENPATH_PROMOTION_CONTRACTS_V2_BASE_URL,
    contractOutput: process.env.OPENPATH_PROMOTION_CONTRACT_OUTPUT?.trim() ?? '',
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--openpath-sha') {
      options.openpathSha = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--repo-root') {
      options.repoRoot = resolve(String(argv[index + 1] ?? ''));
      index += 1;
      continue;
    }
    if (token === '--promotion-contracts-base-url' || token === '--base-url') {
      options.baseUrl = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--contract-output') {
      options.contractOutput = String(argv[index + 1] ?? '').trim();
      index += 1;
      continue;
    }
    if (token === '--json') {
      options.json = true;
      continue;
    }
    throw new Error('Unknown argument: ' + token);
  }

  return options;
}

export async function runOpenPathPromotionContractResolver(
  argv = process.argv.slice(2),
  dependencies = {}
) {
  const options = parseOpenPathPromotionContractCliArgs(argv);
  const openpathSha =
    options.openpathSha ||
    resolveOpenPathGitlinkSha({
      repoRoot: options.repoRoot,
      execFileSyncImpl: dependencies.execFileSyncImpl,
    });
  const result = await resolveOpenPathPromotionContract({
    openpathSha,
    baseUrl: options.baseUrl,
    fetchImpl: dependencies.fetchImpl,
  });
  const contractPath = options.contractOutput
    ? writeOpenPathPromotionContractArtifact({
        outputPath: options.contractOutput,
        contractBytes: result.contractBytes,
      })
    : '';
  const output = {
    openpathSha: result.openpathSha,
    contractSha256: result.contractSha256,
    contractUrl: result.url,
    contractPath,
    openpath_sha: result.openpathSha,
    contract_sha256: result.contractSha256,
    openpath_version: result.contract.openpathVersion,
    linux_agent_version: result.contract.components.linuxAgent.packageVersion,
    linux_agent_apt_suite: result.contract.components.linuxAgent.aptSuite,
    windows_offline_installer_template_version:
      result.contract.components.windowsOfflineInstaller.version,
    windows_offline_installer_template_commit:
      result.contract.components.windowsOfflineInstaller.sourceSha,
    windows_offline_installer_template_release_tag:
      result.contract.components.windowsOfflineInstaller.releaseTag,
    windows_offline_installer_template_sha256:
      result.contract.components.windowsOfflineInstaller.templateSha256,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(output) + '\n');
  } else {
    process.stdout.write(
      Object.entries(output)
        .map(([key, value]) => key + '=' + value)
        .join('\n') + '\n'
    );
  }
  return { ...result, ...output };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFilePath)) {
  runOpenPathPromotionContractResolver().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
