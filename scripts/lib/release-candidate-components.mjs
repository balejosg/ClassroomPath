#!/usr/bin/env node

import { readFileSync } from 'node:fs';

function createEmptyFlags() {
  return {
    gatewayChanged: false,
    migrationsChanged: false,
    openpathApiChanged: false,
    spaChanged: false,
    verifierChanged: false,
  };
}

function markAllChanged(flags) {
  flags.gatewayChanged = true;
  flags.migrationsChanged = true;
  flags.openpathApiChanged = true;
  flags.spaChanged = true;
  flags.verifierChanged = true;
}

function markClassroomPathRuntimeChanged(flags) {
  flags.gatewayChanged = true;
  flags.migrationsChanged = true;
  flags.spaChanged = true;
  flags.verifierChanged = true;
}

function markClassroomPathOpsChanged(flags) {
  flags.migrationsChanged = true;
  flags.verifierChanged = true;
}

function isReleaseMeasurementOnlyFile(filePath) {
  return (
    filePath === 'scripts/measure-release-candidate-timings.mjs' ||
    filePath === 'tests/release-candidate-timings.test.ts'
  );
}

function isVerifierRuntimeTestFile(filePath) {
  return (
    filePath === 'tests/smoke.test.ts' ||
    filePath === 'tests/release-gate.test.ts' ||
    filePath === 'tests/release-gate-policy.ts' ||
    filePath === 'tests/helpers/resolved-fetch.ts' ||
    filePath === 'tests/helpers/release-gate-client.ts'
  );
}

function applyOpenPathPathClassification(flags, filePath) {
  if (
    /^docs\//.test(filePath) ||
    /^\.opencode\//.test(filePath) ||
    /^\.github\/ISSUE_TEMPLATE\//.test(filePath) ||
    /^.*\.md$/.test(filePath) ||
    filePath === 'AGENTS.md'
  ) {
    return true;
  }

  if (/^api\/tests\//.test(filePath) || /^react-spa\/src\/__tests__\//.test(filePath)) {
    flags.verifierChanged = true;
    return true;
  }

  if (
    /^shared\//.test(filePath) ||
    /^api\//.test(filePath) ||
    filePath === 'tsconfig.base.json' ||
    filePath === 'package.json' ||
    filePath === 'package-lock.json' ||
    /^scripts\//.test(filePath) ||
    /^\.github\//.test(filePath)
  ) {
    if (/^shared\//.test(filePath) || filePath === 'tsconfig.base.json') {
      flags.gatewayChanged = true;
      flags.spaChanged = true;
    } else if (/^api\//.test(filePath)) {
      flags.gatewayChanged = true;
    }
    flags.openpathApiChanged = true;
    flags.verifierChanged = true;
    return true;
  }

  if (/^react-spa\//.test(filePath)) {
    flags.gatewayChanged = true;
    flags.spaChanged = true;
    flags.verifierChanged = true;
    return true;
  }

  if (
    /^firefox-extension\//.test(filePath) ||
    /^linux\//.test(filePath) ||
    /^windows\//.test(filePath) ||
    filePath === 'runtime/browser-policy-spec.json'
  ) {
    flags.openpathApiChanged = true;
    flags.verifierChanged = true;
    return true;
  }

  return false;
}

export function classifyOpenPathChangedPaths(filePaths) {
  const flags = createEmptyFlags();
  const normalized = [
    ...new Set((filePaths ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean)),
  ];

  if (normalized.length === 0) {
    return flags;
  }

  for (const filePath of normalized) {
    if (!applyOpenPathPathClassification(flags, filePath)) {
      markAllChanged(flags);
      return flags;
    }
  }

  return flags;
}

export function classifyReleaseCandidateComponents({ changedFiles, openpathChangedFiles }) {
  const flags = createEmptyFlags();
  const normalizedChangedFiles = [
    ...new Set((changedFiles ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean)),
  ];

  for (const file of normalizedChangedFiles) {
    switch (true) {
      case isReleaseMeasurementOnlyFile(file):
        break;
      case /^(package\.json|package-lock\.json)$/.test(file):
        markClassroomPathRuntimeChanged(flags);
        break;
      case file === 'scripts/detect-release-candidate-components.sh':
      case file === 'scripts/lib/release-candidate-components.mjs':
        markAllChanged(flags);
        return flags;
      case /^scripts\//.test(file):
        markClassroomPathOpsChanged(flags);
        break;
      case /^\.github\/actions\/setup-node\//.test(file):
      case /^\.github\/actions\/setup-docker-build\//.test(file):
      case /^\.github\/actions\/build-release-candidate-image\//.test(file):
      case /^\.github\/actions\/publish-release-candidate-manifest\//.test(file):
      case file === '.github/workflows/release-candidate-images.yml':
      case file === '.github/workflows/reusable-release-candidate-image-family.yml':
        markAllChanged(flags);
        return flags;
      case /^api\/drizzle\//.test(file):
      case file === 'api/drizzle.config.ts':
      case /^api\/src\/db\//.test(file):
      case /^api\/scripts\//.test(file):
      case /^api\/package/.test(file):
        flags.gatewayChanged = true;
        flags.migrationsChanged = true;
        flags.verifierChanged = true;
        break;
      case /^api\//.test(file):
      case file === 'docker/Dockerfile.cp-api':
      case /^config\//.test(file):
        flags.gatewayChanged = true;
        flags.verifierChanged = true;
        break;
      case /^react-spa\//.test(file):
      case file === 'docker/Dockerfile.spa':
        flags.spaChanged = true;
        flags.verifierChanged = true;
        break;
      case isVerifierRuntimeTestFile(file):
      case file === 'docker/Dockerfile.release-verifier':
      case file === '.github/workflows/smoke-tests.yml':
      case file === '.github/workflows/deploy.yml':
        flags.verifierChanged = true;
        break;
      case /^tests\//.test(file):
        break;
      case file === 'docker/Dockerfile.migrations':
        flags.migrationsChanged = true;
        break;
      case file === 'docker/Dockerfile.api':
        flags.openpathApiChanged = true;
        break;
      case file === '.github/workflows/firefox-release-assets.yml':
        flags.openpathApiChanged = true;
        break;
      case file === 'upstream/openpath':
      case /^upstream\/openpath\//.test(file): {
        const openpathFlags = classifyOpenPathChangedPaths(openpathChangedFiles);
        flags.gatewayChanged ||= openpathFlags.gatewayChanged;
        flags.migrationsChanged ||= openpathFlags.migrationsChanged;
        flags.openpathApiChanged ||= openpathFlags.openpathApiChanged;
        flags.spaChanged ||= openpathFlags.spaChanged;
        flags.verifierChanged ||= openpathFlags.verifierChanged;
        break;
      }
      default:
        break;
    }
  }

  return flags;
}

function parseListFile(path) {
  if (!path) {
    return [];
  }

  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseCliArgs(argv) {
  /** @type {{ changedFileList?: string; openpathChangedFileList?: string }} */
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1] ?? '';

    switch (arg) {
      case '--changed-file-list':
        parsed.changedFileList = value;
        index += 1;
        break;
      case '--openpath-changed-file-list':
        parsed.openpathChangedFileList = value;
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
  if (command !== 'classify') {
    return;
  }

  const parsed = parseCliArgs(args);
  const flags = classifyReleaseCandidateComponents({
    changedFiles: parseListFile(parsed.changedFileList),
    openpathChangedFiles: parseListFile(parsed.openpathChangedFileList),
  });

  process.stdout.write(
    [
      `gateway_changed=${flags.gatewayChanged}`,
      `migrations_changed=${flags.migrationsChanged}`,
      `openpath_api_changed=${flags.openpathApiChanged}`,
      `spa_changed=${flags.spaChanged}`,
      `verifier_changed=${flags.verifierChanged}`,
      '',
    ].join('\n')
  );
}

runCli();
