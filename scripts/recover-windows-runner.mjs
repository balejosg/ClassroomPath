#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

import {
  DEFAULT_WINDOWS_RUNNER_RECOVERY,
  isKnownWindowsRunnerWorkflow,
  parseSnapshots,
  recommendWindowsRunnerRecovery,
  selectBaselineSnapshot,
} from './lib/windows-runner-recovery.mjs';

const DRY_RUN = process.env.WINDOWS_RUNNER_RECOVERY_DRY_RUN === '1';
const DEFAULT_WAIT_TIMEOUT_SECONDS = 600;

function printUsage() {
  console.error(`Usage:
  scripts/recover-windows-runner.sh status
  scripts/recover-windows-runner.sh recommend [--artifact <path>]
  scripts/recover-windows-runner.sh restore --snapshot <name> --confirm
  scripts/recover-windows-runner.sh unblock-queue --run <target-run-id> --confirm

Environment:
  WINDOWS_RUNNER_RECOVERY_DRY_RUN=1 prints commands without executing them.
`);
}

function quoteArg(arg) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(String(arg)) ? String(arg) : JSON.stringify(String(arg));
}

function renderCommand(args) {
  return args.map(quoteArg).join(' ');
}

function runCommand(args, { capture = false, allowFailure = false } = {}) {
  if (DRY_RUN) {
    console.log(renderCommand(args));
    return capture ? '' : { status: 0, stdout: '', stderr: '' };
  }

  const result = spawnSync(args[0], args.slice(1), {
    encoding: 'utf8',
    stdio: capture || allowFailure ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${renderCommand(args)} failed with exit code ${result.status ?? 'unknown'}`);
  }

  return capture ? result.stdout.trim() : result;
}

function runProxmoxQm(args, options) {
  if (!DRY_RUN && DEFAULT_WINDOWS_RUNNER_RECOVERY.vmid === '<vmid>') {
    throw new Error('Set WINDOWS_RUNNER_VMID to the private Windows runner VMID.');
  }
  return runCommand(['ssh', DEFAULT_WINDOWS_RUNNER_RECOVERY.proxmoxHost, 'qm', ...args], options);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    artifact: '',
    snapshot: '',
    targetRunId: '',
    confirm: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = () => {
      const value = rest[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return value;
    };

    if (arg === '--artifact') {
      options.artifact = next();
    } else if (arg === '--snapshot') {
      options.snapshot = next();
    } else if (arg === '--run') {
      options.targetRunId = next();
    } else if (arg === '--confirm') {
      options.confirm = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function listRunsByStatus(status) {
  const output = runCommand(
    [
      'gh',
      'run',
      'list',
      '--repo',
      DEFAULT_WINDOWS_RUNNER_RECOVERY.repo,
      '--status',
      status,
      '--limit',
      '20',
      '--json',
      'databaseId,workflowName,status,conclusion,createdAt,url',
    ],
    { capture: true }
  );

  if (DRY_RUN || !output) {
    return [];
  }

  return JSON.parse(output);
}

function listActiveRuns() {
  return [...listRunsByStatus('queued'), ...listRunsByStatus('in_progress')];
}

function fetchRunJobs(runId) {
  const output = runCommand(
    [
      'gh',
      'run',
      'view',
      String(runId),
      '--repo',
      DEFAULT_WINDOWS_RUNNER_RECOVERY.repo,
      '--json',
      'jobs',
    ],
    { capture: true, allowFailure: true }
  );

  if (DRY_RUN || !output) {
    return [];
  }

  return JSON.parse(output).jobs ?? [];
}

function minutesSince(timestamp) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - parsed) / 60_000));
}

function collectActiveWindowsJobs() {
  return listActiveRuns().flatMap((run) => {
    const jobs = fetchRunJobs(run.databaseId);
    if (jobs.length === 0) {
      if (
        !isKnownWindowsRunnerWorkflow(run.workflowName) &&
        !String(run.workflowName ?? '')
          .toLowerCase()
          .includes('windows')
      ) {
        return [];
      }

      return [
        {
          runId: String(run.databaseId),
          workflow: run.workflowName,
          status: run.status,
          ageMinutes: minutesSince(run.createdAt),
          url: run.url,
        },
      ];
    }

    return jobs
      .filter(
        (job) =>
          String(job.runner_name ?? job.runnerName ?? '').includes(
            DEFAULT_WINDOWS_RUNNER_RECOVERY.runnerName
          ) ||
          String(job.name ?? '')
            .toLowerCase()
            .includes('windows') ||
          (Array.isArray(job.labels) && job.labels.includes('Windows'))
      )
      .map((job) => ({
        runId: String(run.databaseId),
        workflow: run.workflowName,
        jobName: job.name,
        status: job.status ?? run.status,
        ageMinutes: minutesSince(run.createdAt),
        url: run.url ?? job.html_url,
      }));
  });
}

function collectRunnerState() {
  const output = runCommand(
    ['gh', 'api', `repos/${DEFAULT_WINDOWS_RUNNER_RECOVERY.repo}/actions/runners`, '--paginate'],
    { capture: true }
  );

  if (DRY_RUN || !output) {
    return { status: 'unknown', busy: false, found: false };
  }

  const runners = JSON.parse(output).runners ?? [];
  const runner = runners.find(
    (candidate) => candidate.name === DEFAULT_WINDOWS_RUNNER_RECOVERY.runnerName
  );

  return {
    status: runner?.status ?? 'missing',
    busy: Boolean(runner?.busy),
    found: Boolean(runner),
  };
}

function collectVmState() {
  const statusOutput = runProxmoxQm(['status', DEFAULT_WINDOWS_RUNNER_RECOVERY.vmid], {
    capture: true,
  });
  const snapshotOutput = runProxmoxQm(['listsnapshot', DEFAULT_WINDOWS_RUNNER_RECOVERY.vmid], {
    capture: true,
  });
  const configOutput = runProxmoxQm(['config', DEFAULT_WINDOWS_RUNNER_RECOVERY.vmid], {
    capture: true,
  });

  if (DRY_RUN) {
    return { status: 'unknown', bootOrder: '', snapshots: [] };
  }

  return {
    status: statusOutput.match(/status:\s*(\S+)/)?.[1] ?? 'unknown',
    bootOrder: configOutput.match(/^boot:\s*(.+)$/m)?.[1] ?? '',
    snapshots: parseSnapshots(snapshotOutput),
  };
}

function readCanaryArtifact(artifactPath) {
  if (!artifactPath) {
    return null;
  }
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}`);
  }
  return JSON.parse(readFileSync(artifactPath, 'utf8'));
}

function printStatus() {
  console.log(`# Windows runner recovery status for ${DEFAULT_WINDOWS_RUNNER_RECOVERY.runnerName}`);
  const runner = collectRunnerState();
  const activeJobs = collectActiveWindowsJobs();
  const vm = collectVmState();
  const baseline = selectBaselineSnapshot(vm.snapshots);

  if (DRY_RUN) {
    return;
  }

  console.log(JSON.stringify({ runner, activeJobs, vm, baselineSnapshot: baseline }, null, 2));
}

function printRecommendation(artifactPath) {
  const runner = collectRunnerState();
  const activeJobs = collectActiveWindowsJobs();
  const vm = collectVmState();
  const recommendation = recommendWindowsRunnerRecovery({
    runner,
    activeJobs,
    vm,
    snapshots: vm.snapshots,
    canaryArtifact: readCanaryArtifact(artifactPath),
  });

  console.log(JSON.stringify(recommendation, null, 2));
}

function waitForRunnerOnline() {
  if (DRY_RUN) {
    console.log(
      `wait for ${DEFAULT_WINDOWS_RUNNER_RECOVERY.runnerName} online busy=false (timeout ${DEFAULT_WAIT_TIMEOUT_SECONDS}s)`
    );
    return;
  }

  const started = Date.now();
  while (Date.now() - started < DEFAULT_WAIT_TIMEOUT_SECONDS * 1000) {
    const runner = collectRunnerState();
    if (runner.status === 'online' && !runner.busy) {
      console.log(`${DEFAULT_WINDOWS_RUNNER_RECOVERY.runnerName} online busy=false`);
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15_000);
  }

  throw new Error(`Timed out waiting for ${DEFAULT_WINDOWS_RUNNER_RECOVERY.runnerName} online`);
}

function restoreSnapshot({ snapshot, confirm }) {
  if (!snapshot) {
    throw new Error('restore requires --snapshot <name>');
  }
  if (!confirm) {
    throw new Error('restore requires --confirm');
  }

  runProxmoxQm(['rollback', DEFAULT_WINDOWS_RUNNER_RECOVERY.vmid, snapshot]);
  runProxmoxQm(['set', DEFAULT_WINDOWS_RUNNER_RECOVERY.vmid, '--boot', 'order=sata0']);
  runProxmoxQm(['start', DEFAULT_WINDOWS_RUNNER_RECOVERY.vmid], { allowFailure: true });
  waitForRunnerOnline();
}

function unblockQueue({ targetRunId, confirm }) {
  if (!targetRunId) {
    throw new Error('unblock-queue requires --run <target-run-id>');
  }
  if (!confirm) {
    throw new Error('unblock-queue requires --confirm');
  }

  const activeRuns = listActiveRuns().filter(
    (run) =>
      String(run.databaseId) !== String(targetRunId) &&
      isKnownWindowsRunnerWorkflow(run.workflowName)
  );

  if (DRY_RUN) {
    console.log(`skip target run ${targetRunId}`);
    console.log('gh run cancel <obsolete-run-id> --repo balejosg/ClassroomPath');
    return;
  }

  for (const run of activeRuns) {
    runCommand([
      'gh',
      'run',
      'cancel',
      String(run.databaseId),
      '--repo',
      DEFAULT_WINDOWS_RUNNER_RECOVERY.repo,
    ]);
  }
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

  try {
    if (options.command === 'status') {
      printStatus();
    } else if (options.command === 'recommend') {
      printRecommendation(options.artifact);
    } else if (options.command === 'restore') {
      restoreSnapshot({ snapshot: options.snapshot, confirm: options.confirm });
    } else if (options.command === 'unblock-queue') {
      unblockQueue({ targetRunId: options.targetRunId, confirm: options.confirm });
    } else {
      printUsage();
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
