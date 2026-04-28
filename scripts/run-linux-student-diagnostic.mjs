#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');
const workspaceRoot = resolve(projectRoot, '..');
const DRY_RUN = process.env.LINUX_STUDENT_DIRECT_DRY_RUN === '1';

function defaultArtifactDir() {
  return resolve(
    projectRoot,
    '.opencode/tmp/linux-student-direct',
    new Date().toISOString().replace(/[:.]/g, '-')
  );
}

function parseArgs(argv) {
  const options = {
    openpathRoot: resolve(workspaceRoot, 'OpenPath'),
    artifactDir: defaultArtifactDir(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--openpath-root') {
      options.openpathRoot = resolve(next());
    } else if (arg === '--artifact-dir') {
      options.artifactDir = resolve(next());
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/run-linux-student-diagnostic.mjs [options]

Options:
  --openpath-root <path>  OpenPath checkout to execute (default: ../OpenPath)
  --artifact-dir <path>   Artifact directory (default: .opencode/tmp/linux-student-direct/<timestamp>)
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function summarizeLinuxArtifact(artifactDir, { testStatus = 1 } = {}) {
  const artifactPath = resolve(artifactDir, 'linux-auto-allow-boundary.json');
  const markdownPath = resolve(artifactDir, 'linux-student-policy-summary.md');
  const outputPath = resolve(artifactDir, 'linux-student-policy-summary.env');
  const missingArtifactResult = testStatus === 0 ? 'success' : 'failure';

  if (DRY_RUN) {
    console.log(
      `local: node scripts/summarize-linux-student-policy-evidence.mjs --artifact ${artifactPath} --summary ${markdownPath} --missing-artifact-result ${missingArtifactResult}`
    );
    console.log('local-artifact-fields: failureBoundary diagnosticPhases');
    return 0;
  }

  return runCommand(
    process.execPath,
    [
      'scripts/summarize-linux-student-policy-evidence.mjs',
      '--artifact',
      artifactPath,
      '--summary',
      markdownPath,
      '--missing-artifact-result',
      missingArtifactResult,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
      },
    }
  );
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  console.log(`openpath_root=${options.openpathRoot}`);
  console.log(`artifact_dir=${options.artifactDir}`);
  console.log(`OPENPATH_STUDENT_ARTIFACTS_DIR=${options.artifactDir}`);
  console.log('command=npm run test:student-policy:linux');

  if (DRY_RUN) {
    summarizeLinuxArtifact(options.artifactDir, { testStatus: 0 });
    return;
  }

  mkdirSync(options.artifactDir, { recursive: true });
  let testStatus = 0;
  try {
    testStatus = runCommand('npm', ['run', 'test:student-policy:linux'], {
      cwd: options.openpathRoot,
      env: {
        ...process.env,
        OPENPATH_STUDENT_ARTIFACTS_DIR: options.artifactDir,
      },
    });
  } finally {
    summarizeLinuxArtifact(options.artifactDir, { testStatus });
  }

  if (testStatus !== 0) {
    process.exit(testStatus);
  }

  console.log(`direct Linux student diagnostic complete: ${options.artifactDir}`);
}

main();
