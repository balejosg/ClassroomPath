#!/usr/bin/env node

import { readFileSync } from 'node:fs';

function createEmptyFlags() {
  const flags = {
    gatewayChanged: false,
    migrationsChanged: false,
    openpathApiChanged: false,
    spaChanged: false,
    verifierChanged: false,
  };
  Object.defineProperty(flags, 'openpathFirefoxAssetsChanged', {
    value: false,
    writable: true,
    enumerable: false,
  });
  return flags;
}

export const PACKAGE_JSON_CHANGE_KIND = Object.freeze({
  OPERATIONAL_SCRIPTS_ONLY: 'operational_scripts_only',
  RUNTIME: 'runtime',
});

const OPERATIONAL_PACKAGE_SCRIPT_PATTERNS = [
  /^db:test:/,
  /^deploy:/,
  /^format:/,
  /^promote:/,
  /^release:/,
  /^security:/,
  /^stripe:/,
  /^test:/,
  /^verify:/,
  /^doctor$/,
  /^lint$/,
  /^size:check$/,
  /^submodule:update$/,
  /^typecheck$/,
];

function markAllChanged(flags) {
  flags.gatewayChanged = true;
  flags.migrationsChanged = true;
  flags.openpathApiChanged = true;
  flags.openpathFirefoxAssetsChanged = true;
  flags.spaChanged = true;
  flags.verifierChanged = true;
}

function markReleaseCandidateServerImagesChanged(flags) {
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

function isProductionCanaryHarnessFile(filePath) {
  return (
    filePath === 'scripts/create-production-windows-bootstrap-canary.mjs' ||
    filePath === 'scripts/linux-firefox-block-page-canary.mjs' ||
    filePath === 'scripts/production-enrollment-download-canary.mjs' ||
    filePath === 'scripts/write-production-client-canary-evidence.mjs'
  );
}

function isFirefoxReleaseAssetWorkflowFile(filePath) {
  return (
    filePath === '.github/workflows/firefox-release-assets.yml' ||
    filePath === 'scripts/firefox-release-evidence.mjs' ||
    filePath === 'scripts/resolve-firefox-release-assets-cache.mjs' ||
    filePath === 'tests/firefox-release-assets-cache.test.ts'
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

function isOpenPathFirefoxReleaseRuntimePath(filePath) {
  const relativePath = filePath.replace(/^firefox-extension\//, '');

  return (
    relativePath === 'manifest.json' ||
    relativePath === 'package.json' ||
    relativePath === 'tsconfig.json' ||
    relativePath === 'tsconfig.build.json' ||
    /^src\//.test(relativePath) ||
    /^blocked\//.test(relativePath) ||
    /^popup\//.test(relativePath) ||
    /^icons\//.test(relativePath)
  );
}

function isOpenPathFirefoxReleasePackagingPath(filePath) {
  return (
    filePath === '.github/workflows/firefox-release-assets.yml' ||
    filePath === 'firefox-extension/build-firefox-release.mjs' ||
    filePath === 'firefox-extension/sign-firefox-release.mjs' ||
    filePath === 'firefox-extension/verify-firefox-release-artifacts.mjs'
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function isOperationalPackageScript(scriptName) {
  return OPERATIONAL_PACKAGE_SCRIPT_PATTERNS.some((pattern) => pattern.test(scriptName));
}

function readScripts(packageJson) {
  const scripts = packageJson.scripts ?? {};
  return isPlainObject(scripts) ? scripts : null;
}

export function classifyPackageJsonChange(beforeText, afterText) {
  let beforePackage;
  let afterPackage;
  try {
    beforePackage = JSON.parse(beforeText);
    afterPackage = JSON.parse(afterText);
  } catch {
    return PACKAGE_JSON_CHANGE_KIND.RUNTIME;
  }

  if (!isPlainObject(beforePackage) || !isPlainObject(afterPackage)) {
    return PACKAGE_JSON_CHANGE_KIND.RUNTIME;
  }

  const beforeScripts = readScripts(beforePackage);
  const afterScripts = readScripts(afterPackage);
  if (!beforeScripts || !afterScripts) {
    return PACKAGE_JSON_CHANGE_KIND.RUNTIME;
  }

  const beforeWithoutScripts = { ...beforePackage };
  const afterWithoutScripts = { ...afterPackage };
  delete beforeWithoutScripts.scripts;
  delete afterWithoutScripts.scripts;
  if (stableStringify(beforeWithoutScripts) !== stableStringify(afterWithoutScripts)) {
    return PACKAGE_JSON_CHANGE_KIND.RUNTIME;
  }

  const changedScriptNames = new Set([
    ...Object.keys(beforeScripts).filter(
      (scriptName) =>
        stableStringify(beforeScripts[scriptName]) !== stableStringify(afterScripts[scriptName])
    ),
    ...Object.keys(afterScripts).filter(
      (scriptName) =>
        stableStringify(beforeScripts[scriptName]) !== stableStringify(afterScripts[scriptName])
    ),
  ]);

  if ([...changedScriptNames].every((scriptName) => isOperationalPackageScript(scriptName))) {
    return PACKAGE_JSON_CHANGE_KIND.OPERATIONAL_SCRIPTS_ONLY;
  }

  return PACKAGE_JSON_CHANGE_KIND.RUNTIME;
}

function applyOpenPathPathClassification(flags, filePath) {
  if (isOpenPathFirefoxReleasePackagingPath(filePath)) {
    flags.openpathFirefoxAssetsChanged = true;
    flags.verifierChanged = true;
    return true;
  }

  if (
    /^docs\//.test(filePath) ||
    /^\.opencode\//.test(filePath) ||
    /^\.github\//.test(filePath) ||
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

  if (/^tests\//.test(filePath)) {
    return true;
  }

  if (
    /^shared\//.test(filePath) ||
    /^api\//.test(filePath) ||
    filePath === 'tsconfig.base.json' ||
    filePath === 'package.json' ||
    filePath === 'package-lock.json' ||
    /^scripts\//.test(filePath)
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

  if (/^firefox-extension\//.test(filePath)) {
    if (isOpenPathFirefoxReleaseRuntimePath(filePath)) {
      flags.openpathFirefoxAssetsChanged = true;
      flags.verifierChanged = true;
    }
    return true;
  }

  if (
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

export function classifyReleaseCandidateComponents({
  changedFiles,
  openpathChangedFiles,
  packageJsonChangeKind = PACKAGE_JSON_CHANGE_KIND.RUNTIME,
}) {
  const flags = createEmptyFlags();
  const normalizedChangedFiles = [
    ...new Set((changedFiles ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean)),
  ];

  for (const file of normalizedChangedFiles) {
    switch (true) {
      case isReleaseMeasurementOnlyFile(file):
      case isProductionCanaryHarnessFile(file):
      case isFirefoxReleaseAssetWorkflowFile(file):
        break;
      case file === 'package.json':
        if (packageJsonChangeKind !== PACKAGE_JSON_CHANGE_KIND.OPERATIONAL_SCRIPTS_ONLY) {
          markClassroomPathRuntimeChanged(flags);
        }
        break;
      case file === 'package-lock.json':
        markClassroomPathRuntimeChanged(flags);
        break;
      case file === 'scripts/detect-release-candidate-components.sh':
      case file === 'scripts/lib/release-candidate-components.mjs':
        markReleaseCandidateServerImagesChanged(flags);
        break;
      case /^scripts\//.test(file):
        markClassroomPathOpsChanged(flags);
        break;
      case /^\.github\/actions\/setup-node\//.test(file):
      case /^\.github\/actions\/setup-docker-build\//.test(file):
      case /^\.github\/actions\/build-release-candidate-image\//.test(file):
      case file === '.github/workflows/release-candidate-images.yml':
      case file === '.github/workflows/reusable-release-candidate-image-family.yml':
        markReleaseCandidateServerImagesChanged(flags);
        break;
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
      case file === 'upstream/openpath':
      case /^upstream\/openpath\//.test(file): {
        const openpathFlags = classifyOpenPathChangedPaths(openpathChangedFiles);
        flags.gatewayChanged ||= openpathFlags.gatewayChanged;
        flags.migrationsChanged ||= openpathFlags.migrationsChanged;
        flags.openpathApiChanged ||= openpathFlags.openpathApiChanged;
        flags.openpathFirefoxAssetsChanged ||= openpathFlags.openpathFirefoxAssetsChanged;
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

export function isManifestOnlyReleaseCandidateChange(flags) {
  return (
    !flags.gatewayChanged &&
    !flags.migrationsChanged &&
    !flags.openpathApiChanged &&
    !flags.openpathFirefoxAssetsChanged &&
    !flags.spaChanged &&
    !flags.verifierChanged
  );
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
  /** @type {{ changedFileList?: string; openpathChangedFileList?: string; packageJsonBefore?: string; packageJsonAfter?: string }} */
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
      case '--package-json-before':
        parsed.packageJsonBefore = value;
        index += 1;
        break;
      case '--package-json-after':
        parsed.packageJsonAfter = value;
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
  const packageJsonChangeKind =
    parsed.packageJsonBefore && parsed.packageJsonAfter
      ? classifyPackageJsonChange(
          readFileSync(parsed.packageJsonBefore, 'utf8'),
          readFileSync(parsed.packageJsonAfter, 'utf8')
        )
      : PACKAGE_JSON_CHANGE_KIND.RUNTIME;
  const flags = classifyReleaseCandidateComponents({
    changedFiles: parseListFile(parsed.changedFileList),
    openpathChangedFiles: parseListFile(parsed.openpathChangedFileList),
    packageJsonChangeKind,
  });

  process.stdout.write(
    [
      `gateway_changed=${flags.gatewayChanged}`,
      `migrations_changed=${flags.migrationsChanged}`,
      `openpath_firefox_assets_changed=${flags.openpathFirefoxAssetsChanged}`,
      `openpath_api_changed=${flags.openpathApiChanged}`,
      `spa_changed=${flags.spaChanged}`,
      `verifier_changed=${flags.verifierChanged}`,
      `manifest_only=${isManifestOnlyReleaseCandidateChange(flags)}`,
      '',
    ].join('\n')
  );
}

runCli();
