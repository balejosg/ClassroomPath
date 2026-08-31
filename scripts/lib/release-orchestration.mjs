/**
 * Library: implements the high-risk promotion step order, production deploy commands, and post-release canary trigger.
 *
 * Invoked by: Imported by `scripts/release-promote.mjs`; tested by `release-orchestration.test.ts`.
 * Usage: (library module, not invoked directly)
 */
import { execFile as nodeExecFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

const DEFAULT_REPO = 'balejosg/ClassroomPath';
const execFile = promisify(nodeExecFile);
const GH_RUN_MONITOR_FIELDS = 'status,conclusion,jobs,url,name,workflowName';

export async function runStep({ id, command, env = {}, cwd = process.cwd() }) {
  if (!id) {
    throw new Error('runStep requires id');
  }
  if (!command) {
    throw new Error(`runStep ${id} requires command`);
  }

  const startedAt = performance.now();
  const { executable, args, shell } = normalizeCommand(command);
  const heartbeatIntervalSeconds = Number(
    env.RELEASE_PROMOTE_HEARTBEAT_SECONDS ?? process.env.RELEASE_PROMOTE_HEARTBEAT_SECONDS ?? '60'
  );

  const status = await new Promise((resolve, reject) => {
    let heartbeat;
    const stdoutChunks = [];
    const stderrChunks = [];
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk) => {
      stdoutChunks.push(Buffer.from(chunk));
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderrChunks.push(Buffer.from(chunk));
      process.stderr.write(chunk);
    });

    if (Number.isFinite(heartbeatIntervalSeconds) && heartbeatIntervalSeconds > 0) {
      heartbeat = setInterval(() => {
        const elapsed = Number(((performance.now() - startedAt) / 1000).toFixed(0));
        process.stderr.write(`[release-promote] ${id} still running after ${elapsed}s\n`);
      }, heartbeatIntervalSeconds * 1000);
      heartbeat.unref?.();
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (heartbeat) clearInterval(heartbeat);
      resolve({
        status: code === 0 ? 'success' : 'failed',
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });

  const seconds = Number(((performance.now() - startedAt) / 1000).toFixed(2));
  return { id, status: status.status, seconds, stdout: status.stdout, stderr: status.stderr };
}

export function buildPromotionPlan({
  tag,
  highRiskWindows = false,
  postProductionWindowsCanary = true,
  transcriptRoot = '.opencode/tmp/release-promote',
} = {}) {
  if (!tag) {
    throw new Error('tag is required');
  }
  if (!/^v\d+(?:\.\d+){2,}$/.test(tag)) {
    throw new Error('tag must look like v<major>.<minor>.<patch>');
  }

  const releaseBundleStateDir = join(transcriptRoot, tag, 'bundle');
  const releaseBundleStateFile = join(releaseBundleStateDir, 'staging-release.env');

  const steps = [
    step(
      'verify-clean-repos',
      [
        'bash',
        '-lc',
        [
          'bash scripts/require-main-branch.sh git ClassroomPath',
          'git diff --quiet --ignore-submodules=dirty',
          'git diff --cached --quiet --ignore-submodules=dirty',
          'git fetch origin main --quiet',
          'test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"',
          'git -C upstream/openpath diff --quiet',
          'git -C upstream/openpath diff --cached --quiet',
          'test "$(git -C upstream/openpath rev-parse HEAD)" = "$(git rev-parse HEAD:upstream/openpath)"',
        ].join(' && '),
      ],
      'Verify ClassroomPath is clean at origin/main and OpenPath is clean at the pinned gitlink.'
    ),
    step(
      'resolve-origin-main',
      ['bash', '-lc', 'git fetch origin main --quiet && git rev-parse origin/main'],
      'Resolve the exact ClassroomPath origin/main SHA to promote.'
    ),
    step(
      'wait-release-candidate',
      [
        'bash',
        '-lc',
        [
          `bundle_state_dir=${quoteShellArg(releaseBundleStateDir)}`,
          'mkdir -p "$bundle_state_dir"',
          'target_sha="$(git rev-parse origin/main)"',
          'UPSTREAM_OPENPATH_SHA="$(git -C upstream/openpath rev-parse HEAD)" node scripts/wait-for-release-candidate.mjs resolve-bundle',
          '  --repo balejosg/ClassroomPath',
          '  --sha "$target_sha"',
          '  --output-file "$bundle_state_dir/release-candidate-images.env"',
          '  --output-dir "$bundle_state_dir/release-bundle"',
          '  --legacy-manifest-file "$bundle_state_dir/release-manifest.env"',
          '  > "$bundle_state_dir/outputs.env"',
          'release_id="$(awk -F= \'$1 == "release_id" {print $2; exit}\' "$bundle_state_dir/outputs.env")"',
          'run_id="$(awk -F= \'$1 == "release_bundle_run_id" {print $2; exit}\' "$bundle_state_dir/outputs.env")"',
          'test -n "$release_id"',
          'test -n "$run_id"',
          `printf 'STAGING_RELEASE_ID=%s\\nSTAGING_RELEASE_RUN_ID=%s\\n' "$release_id" "$run_id" > ${quoteShellArg(releaseBundleStateFile)}`,
        ].join('\n'),
      ],
      'Resolve and persist the exact Release Bundle identity for origin/main.'
    ),
    step(
      'deploy-staging',
      [
        'bash',
        '-lc',
        [
          `test -s ${quoteShellArg(releaseBundleStateFile)}`,
          `set -a && . ${quoteShellArg(releaseBundleStateFile)} && set +a`,
          'test -n "$STAGING_RELEASE_ID" && test -n "$STAGING_RELEASE_RUN_ID"',
          'STAGING_GHCR_USERNAME="${STAGING_GHCR_USERNAME:-balejosg}" STAGING_GHCR_TOKEN="${STAGING_GHCR_TOKEN:-$(gh auth token)}" npm run deploy:staging',
        ].join(' && '),
      ],
      'Deploy the same exact Release Bundle identity to staging.'
    ),
  ];

  if (highRiskWindows) {
    steps.push(
      step(
        'ensure-windows-prepromotion-evidence',
        ['node', 'scripts/prepromotion-windows-evidence.mjs', 'run-and-persist'],
        'Run and persist required Windows prepromotion evidence.'
      )
    );
  }

  steps.push(
    step(
      'verify-promotion-ready',
      ['npm', 'run', 'verify:promotion-ready'],
      'Verify staging evidence is production-promotion ready.'
    ),
    step(
      'verify-production-target-ready',
      ['npm', 'run', 'verify:production-target-ready'],
      'Verify the production SSH target, release-state, public URLs, platform, and no-host-node deploy contract before tagging.'
    ),
    step(
      'release-preflight',
      ['bash', '-lc', `RELEASE_PREFLIGHT_NEXT_TAG=${quoteShellArg(tag)} npm run release:preflight`],
      'Run the consolidated release preflight before creating the production tag.'
    ),
    step(
      'tag-production',
      ['bash', 'scripts/tag-production-release.sh', tag],
      `Create and push production tag ${tag}.`
    ),
    step(
      'wait-production-deploy',
      buildWaitForTagDeployCommand(tag),
      'Wait for the tag-triggered production deploy workflow to finish.'
    ),
    step(
      'verify-production-health',
      [
        'bash',
        '-lc',
        [
          'production_health_url="$(node scripts/deploy-targets.mjs get production gatewayHealthUrl)"',
          'production_ready_url="$(node scripts/deploy-targets.mjs get production readyUrl)"',
          'curl -fsS "$production_health_url"',
          'curl -fsS "$production_ready_url"',
        ].join(' && '),
      ],
      'Verify production gateway health and readiness.'
    )
  );

  if (postProductionWindowsCanary) {
    steps.push(
      step(
        'run-post-production-windows-canary',
        [
          'npm',
          'run',
          'diagnostics:windows-ajax:direct',
          '--',
          '--environment',
          'production',
          '--confirm-production',
          '--artifact-dir',
          `.opencode/tmp/postproduction-windows-ajax/${tag}`,
          '--skip-when-canary-token-absent',
        ],
        'Run the post-production Windows AJAX canary against production.'
      )
    );
  }

  steps.push(
    step(
      'report-residual-actions-runs',
      [
        'bash',
        '-lc',
        `sha="$(git rev-parse HEAD)" && node scripts/actions-health.mjs report-stale --repo ${DEFAULT_REPO} --sha "$sha" --tag ${tag}`,
      ],
      'Report residual stale/corrupt non-gate GitHub Actions runs without blocking promotion.'
    )
  );

  steps.push(step('print-summary', null, 'Print promotion summary.'));

  return {
    tag,
    highRiskWindows,
    postProductionWindowsCanary,
    releaseBundleStateDir,
    releaseBundleStateFile,
    steps,
  };
}

export function formatCommand(command) {
  if (!command) {
    return '(internal)';
  }

  if (typeof command === 'string') {
    return command;
  }

  return command.map(quoteShellArg).join(' ');
}

export function buildWaitForTagDeployCommand(tag) {
  return [
    'bash',
    '-lc',
    [
      'deadline=$((SECONDS + 600))',
      'run_id=""',
      'while [ "$SECONDS" -le "$deadline" ]; do',
      `  run_id="$(gh run list --repo ${quoteShellArg(DEFAULT_REPO)} --workflow deploy.yml --event push --branch ${quoteShellArg(tag)} --json databaseId,headBranch,event,workflowName,name --jq ${quoteShellArg(`.[] | select(.headBranch == "${tag}" and .event == "push" and (.workflowName == "Deploy" or .name == "Deploy")) | .databaseId`)} --limit 50 | head -n1)"`,
      '  if [ -n "$run_id" ]; then',
      '    echo "Found production deploy run: $run_id"',
      '    break',
      '  fi',
      `  echo "Waiting for production deploy workflow for ${tag}..."`,
      '  sleep 10',
      'done',
      'test -n "$run_id"',
      `node scripts/actions-health.mjs wait --repo ${quoteShellArg(DEFAULT_REPO)} --run-id "$run_id" --json`,
    ].join('\n'),
  ];
}

export async function monitorGitHubRun({
  repo = DEFAULT_REPO,
  runId,
  execFile: runExecFile = execFile,
} = {}) {
  if (!runId) {
    throw new Error('runId is required');
  }

  const result = await runExecFile('gh', [
    'run',
    'view',
    String(runId),
    '--repo',
    repo,
    '--json',
    GH_RUN_MONITOR_FIELDS,
  ]);
  const run = JSON.parse(String(result.stdout ?? '{}'));
  return buildGitHubRunMonitorSummary({ repo, runId: String(runId), run });
}

export function buildGitHubRunMonitorSummary({ repo = DEFAULT_REPO, runId, run }) {
  const jobs = Array.isArray(run?.jobs) ? run.jobs : [];
  const failedJobs = jobs.filter((job) => {
    const conclusion = String(job?.conclusion ?? '').toLowerCase();
    return conclusion && conclusion !== 'success' && conclusion !== 'skipped';
  });

  return {
    repo,
    runId: String(runId ?? ''),
    workflow: run?.workflowName ?? run?.name ?? 'unknown',
    status: run?.status ?? 'unknown',
    conclusion: run?.conclusion ?? 'unknown',
    url: run?.url ?? null,
    jobs: jobs.map((job) => ({
      name: job?.name ?? 'unknown',
      status: job?.status ?? 'unknown',
      conclusion: job?.conclusion ?? 'unknown',
    })),
    failedJobs: failedJobs.map((job) => ({
      name: job?.name ?? 'unknown',
      status: job?.status ?? 'unknown',
      conclusion: job?.conclusion ?? 'unknown',
    })),
  };
}

export function summarizeGitHubRunMonitor(summary) {
  const failed = summary.failedJobs ?? [];
  const failureText =
    failed.length > 0
      ? ` failed_jobs=${failed.map((job) => `${job.name}:${job.conclusion}`).join(',')}`
      : '';
  const urlText = summary.url ? ` ${summary.url}` : '';
  return `GitHub Actions run ${summary.runId}: ${summary.workflow} status=${summary.status} conclusion=${summary.conclusion}${failureText}${urlText}`;
}

/**
 * Write (or update) the per-step state file for a given tag.
 *
 * Shape: { tag, startedAt, updatedAt, steps: { <id>: { status, seconds } } }
 *
 * Called after each step result during an --execute run so a crash mid-sequence
 * leaves a recoverable state that --resume can consult.
 */
export function writeStepState({
  root = '.opencode/tmp/release-promote',
  tag,
  releaseId,
  rcRunId,
  startedAt,
  stepId,
  status,
  seconds,
} = {}) {
  const stateDir = join(root, tag);
  const statePath = join(stateDir, 'state.json');

  let existing = {};
  try {
    existing = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    // First write for this tag — start fresh.
  }

  if (existing.tag && existing.tag !== tag) {
    throw new Error(`Promotion state tag mismatch: ${existing.tag} != ${tag}`);
  }

  const normalizedReleaseId = normalizeReleaseId(releaseId, 'releaseId');
  const existingReleaseId = normalizeReleaseId(existing.releaseId, 'persisted releaseId');
  if (existingReleaseId && normalizedReleaseId && existingReleaseId !== normalizedReleaseId) {
    throw new Error(
      `Promotion state is bound to a different Release Bundle releaseId: ${existingReleaseId} != ${normalizedReleaseId}`
    );
  }

  const normalizedRcRunId = normalizeRcRunId(rcRunId, 'rcRunId');
  const existingRcRunId = normalizeRcRunId(existing.rcRunId, 'persisted rcRunId');
  if (existingRcRunId && normalizedRcRunId && existingRcRunId !== normalizedRcRunId) {
    throw new Error(
      `Promotion state is bound to a different Release Bundle rcRunId: ${existingRcRunId} != ${normalizedRcRunId}`
    );
  }

  const boundReleaseId = normalizedReleaseId || existingReleaseId;
  const boundRcRunId = normalizedRcRunId || existingRcRunId;

  const updated = {
    tag,
    ...(boundReleaseId ? { releaseId: boundReleaseId } : {}),
    ...(boundRcRunId ? { rcRunId: boundRcRunId } : {}),
    startedAt: existing.startedAt ?? startedAt,
    updatedAt: new Date().toISOString(),
    steps: {
      ...(existing.steps ?? {}),
      [stepId]: { status, seconds },
    },
  };

  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

function normalizeReleaseId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 64-character lowercase SHA-256 hex string`);
  }
  return normalized;
}

function normalizeRcRunId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a numeric GitHub run id`);
  }
  return normalized;
}

export function readReleaseBundleLocatorIdentity(locatorPath) {
  let text;
  try {
    text = readFileSync(locatorPath, 'utf8');
  } catch {
    return null;
  }

  const values = Object.fromEntries(
    String(text)
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf('=');
        return separator === -1
          ? [line, '']
          : [line.slice(0, separator), line.slice(separator + 1)];
      })
  );
  const releaseId = normalizeReleaseId(values.STAGING_RELEASE_ID, 'STAGING_RELEASE_ID');
  const rcRunId = normalizeRcRunId(values.STAGING_RELEASE_RUN_ID, 'STAGING_RELEASE_RUN_ID');
  if (!releaseId || !rcRunId) {
    throw new Error(`Exact Release Bundle locator is incomplete: ${locatorPath}`);
  }
  return { releaseId, rcRunId };
}

/**
 * Read the per-step state file for a given tag.
 * Returns null when no state file exists yet.
 */
export function readStepState({ root = '.opencode/tmp/release-promote', tag } = {}) {
  const statePath = join(root, tag, 'state.json');
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function step(id, command, description) {
  return { id, command, description };
}

function normalizeCommand(command) {
  if (typeof command === 'string') {
    return { executable: command, args: [], shell: true };
  }

  if (Array.isArray(command) && command.length > 0) {
    const [executable, ...args] = command;
    return { executable, args, shell: false };
  }

  throw new Error('command must be a non-empty string or array');
}

function quoteShellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(text)) {
    return text;
  }

  return `'${text.replaceAll("'", "'\\''")}'`;
}
