#!/usr/bin/env node

/**
 * Runs a full runner diagnostic: collects environment snapshots, network probes, and extension health from a self-hosted runner.
 *
 * Invoked by: Developer CLI via `npm run diagnostics:runner`.
 * Usage: node scripts/run-runner-diagnostic.mjs [--target staging|production]
 * Env: GITHUB_TOKEN, WINDOWS_RUNNER_LABEL.
 */

import { resolve } from 'node:path';
import process from 'node:process';
import {
  collectRunEvidence,
  dispatchWorkflow,
  downloadArtifacts,
  findLatestRun,
  inspectRunnerState,
  waitForRun,
} from './lib/github-actions-diagnostic-client.mjs';

const DEFAULT_REF = 'main';
const DEFAULT_ENVIRONMENT = 'staging';
const DEFAULT_SUITE = 'windows-bootstrap-ajax';
const DRY_RUN = process.env.RUNNER_DIAGNOSTIC_DRY_RUN === '1';
const FAKE_WATCH_FAILURE = process.env.RUNNER_DIAGNOSTIC_FAKE_WATCH_FAILURE === '1';
const FAKE_ARTIFACT_DOWNLOAD_FAILURE =
  process.env.RUNNER_DIAGNOSTIC_FAKE_ARTIFACT_DOWNLOAD_FAILURE === '1';

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
  'linux-bootstrap-ajax': {
    repo: 'balejosg/ClassroomPath',
    workflow: 'linux-production-bootstrap-canary.yml',
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
  --check-runner-state        Inspect self-hosted runner state before dispatch
  --runner-name <name>        Runner name for --check-runner-state
  --force-dispatch            Dispatch even when checked runner is busy
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
    checkRunnerState: false,
    runnerName: '',
    forceDispatch: false,
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
    } else if (arg === '--check-runner-state') {
      options.checkRunnerState = true;
    } else if (arg === '--runner-name') {
      options.runnerName = next();
    } else if (arg === '--force-dispatch') {
      options.forceDispatch = true;
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

function buildWorkflowFields({ suite, options }) {
  const fields = { ...suite.fields };

  if (suite.includeEnvironment) {
    fields.target_environment = options.environment;
  }

  if (suite.baseUrlField && options.baseUrl) {
    fields[suite.baseUrlField] = options.baseUrl;
  }

  return fields;
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

  if (options.environment === 'production' && suite.baseUrlField && !options.baseUrl) {
    console.error(
      'Production runner diagnostics require --base-url with a private production URL.'
    );
    process.exit(1);
  }

  const artifactDir = resolve(
    '.opencode/tmp/runner-diagnostics',
    DRY_RUN ? '<latest-run-id>' : `${options.suite}-${Date.now()}`
  );

  if (options.checkRunnerState) {
    if (!options.runnerName) {
      console.error('Runner state diagnostics require --runner-name with the private runner name.');
      process.exit(1);
    }

    const state = inspectRunnerState({
      repo: suite.repo,
      runnerName: options.runnerName,
      evidenceDir: artifactDir,
      dryRun: DRY_RUN,
    });

    if (state.status !== 'online') {
      console.error(`Runner is not online: ${options.runnerName} (${state.status})`);
      process.exit(1);
    }

    if (state.busy && !options.forceDispatch) {
      console.error(
        `Runner is busy: ${options.runnerName}. Re-run with --force-dispatch to queue anyway.`
      );
      process.exit(1);
    }
  }

  dispatchWorkflow({
    repo: suite.repo,
    workflow: suite.workflow,
    ref: options.ref,
    fields: buildWorkflowFields({ suite, options }),
    dryRun: DRY_RUN,
  });

  if (!options.wait) {
    return;
  }

  if (!DRY_RUN) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }

  const runId = findLatestRun({
    repo: suite.repo,
    workflow: suite.workflow,
    ref: options.ref,
    dryRun: DRY_RUN,
  });
  const resolvedRunId = DRY_RUN ? '<latest-run-id>' : runId;
  if (!resolvedRunId) {
    throw new Error(`Could not resolve latest run id for ${suite.workflow}`);
  }

  const resolvedArtifactDir = resolve('.opencode/tmp/runner-diagnostics', String(resolvedRunId));
  const watchResult = waitForRun({
    repo: suite.repo,
    runId: resolvedRunId,
    dryRun: DRY_RUN,
    fakeWatchFailure: FAKE_WATCH_FAILURE,
  });
  const downloadResult = { status: 0 };

  if (options.downloadArtifacts) {
    downloadResult.status = downloadArtifacts({
      repo: suite.repo,
      runId: resolvedRunId,
      evidenceDir: resolvedArtifactDir,
      dryRun: DRY_RUN,
      fakeArtifactDownloadFailure: FAKE_ARTIFACT_DOWNLOAD_FAILURE,
    }).status;
  }

  collectRunEvidence({
    repo: suite.repo,
    runId: resolvedRunId,
    evidenceDir: resolvedArtifactDir,
    suite: suite.workflow,
    watchStatus: typeof watchResult === 'object' ? watchResult.status : 0,
    artifactDownloadStatus: downloadResult.status,
    dryRun: DRY_RUN,
  });

  console.log(`Runner diagnostic evidence: ${resolvedArtifactDir}`);

  if (typeof watchResult === 'object' && watchResult.status !== 0) {
    process.exit(watchResult.status);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
