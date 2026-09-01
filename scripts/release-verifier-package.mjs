#!/usr/bin/env node

import { existsSync } from 'node:fs';

import {
  RELEASE_VERIFIER_COMMANDS,
  RELEASE_VERIFIER_REQUIRED_FILES,
  validateReleaseVerifierPackageFiles,
} from './lib/release-verifier-contract.mjs';

function imagePathToLocalPath(imagePath) {
  return imagePath.startsWith('/app/') ? imagePath.slice('/app/'.length) : imagePath;
}

export function checkReleaseVerifierPackage(root = '/app') {
  const availableFiles = RELEASE_VERIFIER_REQUIRED_FILES.filter((imagePath) =>
    existsSync(`${root}/${imagePathToLocalPath(imagePath)}`)
  );
  return validateReleaseVerifierPackageFiles(availableFiles);
}

export function runReleaseVerifierPackageCommand(argv = process.argv.slice(2)) {
  const command = argv[0] ?? 'check';
  if (command === '--help' || command === 'help') {
    process.stdout.write('Usage: release-verifier-package.mjs check|manifest|--help\n');
    return 0;
  }
  if (command === 'manifest') {
    process.stdout.write(
      JSON.stringify(
        {
          requiredFiles: RELEASE_VERIFIER_REQUIRED_FILES,
          commands: RELEASE_VERIFIER_COMMANDS,
        },
        null,
        2
      ) + '\n'
    );
    return 0;
  }
  if (command !== 'check') throw new Error(`Unknown verifier package command: ${command}`);

  const report = checkReleaseVerifierPackage(process.env.RELEASE_VERIFIER_PACKAGE_ROOT ?? '/app');
  process.stdout.write(JSON.stringify(report) + '\n');
  return report.ok ? 0 : 1;
}

if (process.argv[1]?.endsWith('/release-verifier-package.mjs')) {
  try {
    process.exitCode = runReleaseVerifierPackageCommand();
  } catch (error) {
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}
