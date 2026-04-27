#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_REF = 'main';
const DEFAULT_ENVIRONMENT = 'staging';
const DEFAULT_SUITE = 'windows-bootstrap-ajax';
const DRY_RUN = process.env.RUNNER_DIAGNOSTIC_DRY_RUN === '1';

const SUITES = {
  'openpath-windows-e2e': {
    repo: 'balejosg/Openpath',
    workflow: 'e2e-tests.yml',
    fields: { platform: 'windows', suite: 'e2e' },
  },
  'openpath-windows-student-policy': {
    repo: 'balejosg/Openpath',
    workflow: 'e2e-tests.yml',
    fields: { platform: 'windows', suite: 'student-policy' },
  },
  'windows-bootstrap-ajax': {
    repo: 'balejosg/ClassroomPath',
    workflow: 'windows-production-bootstrap-canary.yml',
    fields: { diagnostic_mode: 'true' },
    includeEnvironment: true,
    baseUrlField: 'base_url',
  },
  'production-client-update': {
    repo: 'balejosg/ClassroomPath',
    workflow: 'production-client-update-canary.yml',
    fields: { target_platform: 'windows' },
    baseUrlField: 'production_base_url',
  },
  'runner-smoke': {
    repo: 'balejosg/ClassroomPath',
    workflow: 'self-hosted-windows-runner-smoke.yml',
    fields: {},
  },
};

function printUsage() {
  console.error(`Usage:
  npm run diagnostics:runner -- [options]

Options:
  --suite <name>              ${Object.keys(SUITES).join(' | ')}
  --environment <name>        staging | production (default: ${DEFAULT_ENVIRONMENT})
  --base-url <url>            Optional public URL override for suites that accept one
  --ref <ref>                 Git ref to dispatch (default: ${DEFAULT_REF})
  --wait                      Wait for the dispatched run to finish
  --download-artifacts        Download artifacts after waiting
  --confirm-production        Required when --environment production
`);
}

function parseArgs(argv) {
  const options = {
    suite: DEFAULT_SUITE,
    environment: DEFAULT_ENVIRONMENT,
    ref: DEFAULT_REF,
    baseUrl: '',
    wait: false,
    downloadArtifacts: false,
    confirmProduction: false,
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

    if (arg === '--suite') {
      options.suite = next();
    } else if (arg === '--environment') {
      options.environment = next();
    } else if (arg === '--base-url') {
      options.baseUrl = next();
    } else if (arg === '--ref') {
      options.ref = next();
    } else if (arg === '--wait') {
      options.wait = true;
    } else if (arg === '--download-artifacts') {
      options.downloadArtifacts = true;
      options.wait = true;
    } else if (arg === '--confirm-production') {
      options.confirmProduction = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function quoteArg(arg) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(arg) ? arg : JSON.stringify(arg);
}

function renderCommand(args) {
  return args.map((arg) => quoteArg(String(arg))).join(' ');
}

function runCommand(args, { capture = false } = {}) {
  if (DRY_RUN) {
    console.log(renderCommand(args));
    return '';
  }

  const result = spawnSync(args[0], args.slice(1), {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${renderCommand(args)} failed with exit code ${result.status ?? 'unknown'}`);
  }

  return capture ? result.stdout.trim() : '';
}

function buildDispatchCommand({ suite, options }) {
  const args = [
    'gh',
    'workflow',
    'run',
    suite.workflow,
    '--repo',
    suite.repo,
    '--ref',
    options.ref,
  ];
  const fields = { ...suite.fields };

  if (suite.includeEnvironment) {
    fields.target_environment = options.environment;
  }

  if (suite.baseUrlField && options.baseUrl) {
    fields[suite.baseUrlField] = options.baseUrl;
  }

  for (const [key, value] of Object.entries(fields)) {
    args.push('-f', `${key}=${value}`);
  }

  return args;
}

function buildRunListCommand({ suite, options }) {
  return [
    'gh',
    'run',
    'list',
    '--repo',
    suite.repo,
    '--workflow',
    suite.workflow,
    '--branch',
    options.ref,
    '--limit',
    '1',
    '--json',
    'databaseId',
    '--jq',
    '.[0].databaseId',
  ];
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  }

  const suite = SUITES[options.suite];
  if (!suite) {
    console.error(`Unknown runner diagnostic suite: ${options.suite}`);
    printUsage();
    process.exit(1);
  }

  if (!['staging', 'production'].includes(options.environment)) {
    console.error(`Unsupported environment: ${options.environment}`);
    process.exit(1);
  }

  if (options.environment === 'production' && !options.confirmProduction) {
    console.error('Production runner diagnostics require --confirm-production.');
    process.exit(1);
  }

  runCommand(buildDispatchCommand({ suite, options }));

  if (!options.wait) {
    return;
  }

  if (!DRY_RUN) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }

  const runId = runCommand(buildRunListCommand({ suite, options }), { capture: true });
  const resolvedRunId = DRY_RUN ? '<latest-run-id>' : runId;
  if (!resolvedRunId) {
    throw new Error(`Could not resolve latest run id for ${suite.workflow}`);
  }

  runCommand(['gh', 'run', 'watch', resolvedRunId, '--repo', suite.repo, '--exit-status']);

  if (options.downloadArtifacts) {
    const artifactDir = resolve('.opencode/tmp/runner-diagnostics', String(resolvedRunId));
    if (!DRY_RUN) {
      mkdirSync(artifactDir, { recursive: true });
    }
    runCommand([
      'gh',
      'run',
      'download',
      resolvedRunId,
      '--repo',
      suite.repo,
      '--dir',
      artifactDir,
    ]);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
