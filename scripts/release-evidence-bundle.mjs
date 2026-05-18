#!/usr/bin/env node

import { resolve } from 'node:path';

import { runReleaseEvidenceBundle } from './lib/release-evidence-bundle.mjs';

const DEFAULT_REPO = 'balejosg/ClassroomPath';
const DEFAULT_PRODUCTION_URL = 'https://classroompath.example.invalid';

function usage() {
  return `Usage: npm run release:evidence-bundle -- --deploy-run <id> [options]

Collects a verifiable release evidence bundle from local release-evidence.json plus downloaded canary artifacts.

Run this from a directory that already contains release-evidence.json.

Required:
  --deploy-run <id>          GitHub Actions Deploy run id.

Options:
  --tag <vX.Y.Z>             Release tag to stamp into the generated bundle.
  --canary-run <id>          Backwards-compatible alias for --windows-canary-run.
  --windows-canary-run <id>  GitHub Actions Windows bootstrap canary run id.
  --linux-canary-run <id>    GitHub Actions Linux bootstrap canary run id.
  --repo <owner/repo>        GitHub repository. Default: ${DEFAULT_REPO}
  --production-url <url>     Production base URL. Default: ${DEFAULT_PRODUCTION_URL}
  --output-dir <path>        Output directory. Default: release-evidence-bundle-<deploy-run>
  --help                    Show this help.

Generated files include:
  release-evidence.json
  release-evidence.md
  artifact-integrity.json
  canary-evidence/windows-production-bootstrap.json
  canary-evidence/linux-production-bootstrap.json
  production-health.json
`;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function parseArgs(argv) {
  const args = {
    repo: DEFAULT_REPO,
    productionUrl: DEFAULT_PRODUCTION_URL,
    outputDir: null,
    deployRun: null,
    tag: null,
    windowsCanaryRun: null,
    linuxCanaryRun: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--repo':
        args.repo = readValue(argv, ++index, arg);
        break;
      case '--production-url':
        args.productionUrl = readValue(argv, ++index, arg).replace(/\/+$/, '');
        break;
      case '--output-dir':
        args.outputDir = readValue(argv, ++index, arg);
        break;
      case '--deploy-run':
        args.deployRun = readValue(argv, ++index, arg);
        break;
      case '--tag':
        args.tag = readValue(argv, ++index, arg);
        break;
      case '--canary-run':
      case '--windows-canary-run':
        args.windowsCanaryRun = readValue(argv, ++index, arg);
        break;
      case '--linux-canary-run':
        args.linuxCanaryRun = readValue(argv, ++index, arg);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && !args.deployRun) {
    throw new Error('--deploy-run is required');
  }

  args.outputDir ??= `release-evidence-bundle-${args.deployRun ?? 'help'}`;
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const outputDir = resolve(args.outputDir);
  await runReleaseEvidenceBundle({
    repo: args.repo,
    deployRun: args.deployRun,
    tag: args.tag,
    outputDir,
    productionUrl: args.productionUrl,
    windowsCanaryRun: args.windowsCanaryRun,
    linuxCanaryRun: args.linuxCanaryRun,
  });

  process.stdout.write(`Wrote release evidence bundle to ${outputDir}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
