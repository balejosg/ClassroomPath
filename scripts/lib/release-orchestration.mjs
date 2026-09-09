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

/** @param {any} options */
export function buildPromotionPlan(options = {}) {
  const normalizedRcRunId = normalizeRcRunId(options.rcRunId, 'rcRunId');
  if (!normalizedRcRunId) {
    throw new Error('rcRunId is required');
  }
  return buildRcFirstPromotionPlan({ ...options, rcRunId: normalizedRcRunId });
}

/** Build the sole production promotion plan: explicit RC first, proposed tag last. */
function buildRcFirstPromotionPlan({
  rcRunId,
  tag,
  highRiskWindows = false,
  postProductionWindowsCanary = true,
  localOnly = false,
  transcriptRoot = '.opencode/tmp/release-promote',
} = {}) {
  if (!tag) {
    throw new Error('tag is required');
  }
  if (!/^v\d+(?:\.\d+){2,}$/.test(tag)) {
    throw new Error('tag must look like v<major>.<minor>.<patch>');
  }

  const identityRoot = join(transcriptRoot, `rc-${rcRunId}`);
  const releaseBundleStateDir = join(identityRoot, 'bundle');
  const releaseBundleStateFile = join(releaseBundleStateDir, 'staging-release.env');
  const releaseBundleDir = join(releaseBundleStateDir, 'release-bundle');

  const steps = [
    step(
      'resolve-release-candidate',
      [
        'bash',
        '-lc',
        [
          'set -euo pipefail',
          `bundle_state_dir=${quoteShellArg(releaseBundleStateDir)}`,
          'mkdir -p "$bundle_state_dir"',
          `node scripts/wait-for-release-candidate.mjs resolve-bundle --repo ${quoteShellArg(DEFAULT_REPO)} --rc-run-id ${quoteShellArg(rcRunId)} \\`,
          '  --output-file "$bundle_state_dir/release-candidate-images.env" \\',
          '  --output-dir "$bundle_state_dir/release-bundle" \\',
          '  --legacy-manifest-file "$bundle_state_dir/release-manifest.env" > "$bundle_state_dir/outputs.env"',
          'classroom_path_sha="$(awk -F= \'$1 == "APP_SHA" {print $2; exit}\' "$bundle_state_dir/outputs.env")"',
          'release_id="$(awk -F= \'$1 == "release_id" {print $2; exit}\' "$bundle_state_dir/outputs.env")"',
          'openpath_sha="$(awk -F= \'$1 == "openpath_sha" {print $2; exit}\' "$bundle_state_dir/outputs.env")"',
          'openpath_contract_sha256="$(awk -F= \'$1 == "openpath_contract_sha256" {print $2; exit}\' "$bundle_state_dir/outputs.env")"',
          'git cat-file -e "$classroom_path_sha^{commit}"',
          'test "$(git rev-parse "$classroom_path_sha:upstream/openpath")" = "$openpath_sha"',
          'test -n "$release_id" && test -n "$openpath_sha" && test -n "$openpath_contract_sha256"',
          `printf 'STAGING_RELEASE_ID=%s\\nSTAGING_CLASSROOMPATH_SHA=%s\\nSTAGING_OPENPATH_SHA=%s\\nSTAGING_OPENPATH_CONTRACT_SHA256=%s\\nSTAGING_RELEASE_RUN_ID=%s\\n' "$release_id" "$classroom_path_sha" "$openpath_sha" "$openpath_contract_sha256" ${quoteShellArg(rcRunId)} > "$bundle_state_dir/staging-release.env"`,
        ].join('\n'),
      ],
      'Resolve the explicitly selected successful Release Candidate and persist its immutable bundle identity.'
    ),
    step(
      'verify-clean-repos',
      [
        'bash',
        '-lc',
        [
          'set -euo pipefail',
          `locator_file=${quoteShellArg(releaseBundleStateFile)}`,
          'test -s "$locator_file"',
          'set -a && . "$locator_file" && set +a',
          'bash scripts/require-canonical-operator-tooling.sh',
          'git diff --quiet --ignore-submodules=dirty',
          'git diff --cached --quiet --ignore-submodules=dirty',
          'git -C upstream/openpath diff --quiet',
          'git -C upstream/openpath diff --cached --quiet',
          'git cat-file -e "$STAGING_CLASSROOMPATH_SHA^{commit}"',
          'test "$(git rev-parse "$STAGING_CLASSROOMPATH_SHA:upstream/openpath")" = "$STAGING_OPENPATH_SHA"',
        ].join('\n'),
      ],
      'Verify the operator checkout is clean and the selected RC commit/tree contains the exact identity.'
    ),
    step(
      'verify-promotion-identity',
      [
        'bash',
        '-lc',
        [
          'set -euo pipefail',
          `locator_file=${quoteShellArg(releaseBundleStateFile)}`,
          `bundle_file=${quoteShellArg(join(releaseBundleDir, 'classroompath-release-bundle.json'))}`,
          `contract_file=${quoteShellArg(join(releaseBundleDir, 'openpath-promotion-contract.json'))}`,
          'test -s "$locator_file" && test -s "$bundle_file" && test -s "$contract_file"',
          'set -a && . "$locator_file" && set +a',
          'bash scripts/require-canonical-operator-tooling.sh',
          `test "$STAGING_RELEASE_RUN_ID" = ${quoteShellArg(rcRunId)}`,
          'git cat-file -e "$STAGING_CLASSROOMPATH_SHA^{commit}"',
          'test "$(git rev-parse "$STAGING_CLASSROOMPATH_SHA:upstream/openpath")" = "$STAGING_OPENPATH_SHA"',
          'test "$(sha256sum "$contract_file" | awk \'{print $1}\')" = "$STAGING_OPENPATH_CONTRACT_SHA256"',
          'node scripts/release-bundle.mjs verify \\',
          '  --bundle-file "$bundle_file" \\',
          '  --contract-file "$contract_file" \\',
          '  --release-id "$STAGING_RELEASE_ID" \\',
          '  --openpath-sha "$STAGING_OPENPATH_SHA" \\',
          '  --classroompath-sha "$STAGING_CLASSROOMPATH_SHA"',
        ].join('\n'),
      ],
      'Revalidate RC run, ClassroomPath SHA, releaseId, OpenPath SHA, and contract bytes before resume or selective execution.'
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
          'test -n "$STAGING_CLASSROOMPATH_SHA" && test -n "$STAGING_OPENPATH_SHA"',
          'test -n "$STAGING_OPENPATH_CONTRACT_SHA256"',
          'STAGING_GHCR_USERNAME="${STAGING_GHCR_USERNAME:-balejosg}" STAGING_GHCR_TOKEN="${STAGING_GHCR_TOKEN:-$(gh auth token)}" npm run deploy:staging -- --rc-run-id "$STAGING_RELEASE_RUN_ID"',
        ].join(' && '),
      ],
      'Deploy the same exact explicitly selected Release Bundle to staging through the shared executor adapter.'
    ),
    ...(highRiskWindows
      ? [
          step(
            'ensure-windows-prepromotion-evidence',
            ['node', 'scripts/prepromotion-windows-evidence.mjs', 'run-and-persist'],
            'Run and persist required Windows prepromotion evidence.'
          ),
        ]
      : []),
    step(
      'verify-staging-exact',
      [
        'bash',
        '-lc',
        [
          `set -a && . ${quoteShellArg(releaseBundleStateFile)} && set +a`,
          `npm run verify:staging-exact -- --staging-only --rc-run-id "$STAGING_RELEASE_RUN_ID" --candidate-sha "$STAGING_CLASSROOMPATH_SHA" --release-id "$STAGING_RELEASE_ID" --openpath-sha "$STAGING_OPENPATH_SHA" --contract-sha256 "$STAGING_OPENPATH_CONTRACT_SHA256" --current-output ${quoteShellArg(join(identityRoot, 'staging-current-images.env'))} --verification-output ${quoteShellArg(join(identityRoot, 'staging-verification.env'))}`,
        ].join('\n'),
      ],
      'Verify staging runtime, persisted state, health, readiness, and exact RC identity.'
    ),
    step(
      'verify-candidate-tooling',
      [
        'bash',
        '-lc',
        [
          `set -a && . ${quoteShellArg(releaseBundleStateFile)} && set +a`,
          `node scripts/verify-candidate-tooling.mjs --candidate-sha "$STAGING_CLASSROOMPATH_SHA" --rc-run-id "$STAGING_RELEASE_RUN_ID" --tag ${quoteShellArg(tag)} --release-id "$STAGING_RELEASE_ID" --openpath-sha "$STAGING_OPENPATH_SHA" --contract-sha256 "$STAGING_OPENPATH_CONTRACT_SHA256" --bundle-file ${quoteShellArg(join(releaseBundleDir, 'classroompath-release-bundle.json'))} --contract-file ${quoteShellArg(join(releaseBundleDir, 'openpath-promotion-contract.json'))} --staging-current ${quoteShellArg(join(identityRoot, 'staging-current-images.env'))} --staging-verification ${quoteShellArg(join(identityRoot, 'staging-verification.env'))}`,
        ].join('\n'),
      ],
      'Run candidate-owned Release Bundle, tag-evidence, and readiness-contract compatibility checks from the exact RC commit.'
    ),
    step(
      'production-readiness',
      [
        'bash',
        '-lc',
        [
          `set -a && . ${quoteShellArg(releaseBundleStateFile)} && set +a`,
          `npm run verify:production-readiness -- --rc-run-id "$STAGING_RELEASE_RUN_ID" --candidate-sha "$STAGING_CLASSROOMPATH_SHA" --release-id "$STAGING_RELEASE_ID" --openpath-sha "$STAGING_OPENPATH_SHA" --contract-sha256 "$STAGING_OPENPATH_CONTRACT_SHA256" --bundle-file ${quoteShellArg(join(releaseBundleDir, 'classroompath-release-bundle.json'))} --contract-file ${quoteShellArg(join(releaseBundleDir, 'openpath-promotion-contract.json'))} --high-risk ${highRiskWindows ? 'true' : 'false'}`,
        ].join('\n'),
      ],
      'Run canonical read-only production readiness: recovery authority, config, host, and exact artifacts.'
    ),
  ];

  steps.push(
    step(
      'release-preflight',
      [
        'bash',
        '-lc',
        [
          'set -euo pipefail',
          `set -a && . ${quoteShellArg(releaseBundleStateFile)} && set +a`,
          'RELEASE_PREFLIGHT_NEXT_TAG=' +
            quoteShellArg(tag) +
            ' RELEASE_PREFLIGHT_RC_RUN_ID="$STAGING_RELEASE_RUN_ID" RELEASE_PREFLIGHT_CANDIDATE_SHA="$STAGING_CLASSROOMPATH_SHA" RELEASE_PREFLIGHT_RELEASE_ID="$STAGING_RELEASE_ID" RELEASE_PREFLIGHT_OPENPATH_SHA="$STAGING_OPENPATH_SHA" RELEASE_PREFLIGHT_CONTRACT_SHA256="$STAGING_OPENPATH_CONTRACT_SHA256" npm run release:preflight',
        ].join('\n'),
      ],
      'Run the consolidated release preflight against the selected RC before approval.'
    ),
    step(
      'approval',
      null,
      'The explicit --execute flag is the approval boundary; dry-run never crosses into tag creation.'
    ),
    step(
      'tag-production',
      [
        'bash',
        '-lc',
        [
          'set -euo pipefail',
          `set -a && . ${quoteShellArg(releaseBundleStateFile)} && set +a`,
          `bash scripts/tag-production-release.sh ${quoteShellArg(tag)} --rc-run-id "$STAGING_RELEASE_RUN_ID" --candidate-sha "$STAGING_CLASSROOMPATH_SHA" --release-id "$STAGING_RELEASE_ID" --openpath-sha "$STAGING_OPENPATH_SHA" --contract-sha256 "$STAGING_OPENPATH_CONTRACT_SHA256" --bundle-file ${quoteShellArg(join(releaseBundleDir, 'classroompath-release-bundle.json'))} --contract-file ${quoteShellArg(join(releaseBundleDir, 'openpath-promotion-contract.json'))} --staging-current ${quoteShellArg(join(identityRoot, 'staging-current-images.env'))} --staging-verification ${quoteShellArg(join(identityRoot, 'staging-verification.env'))} --high-risk ${highRiskWindows ? 'true' : 'false'}${localOnly ? ' --local-only' : ''}`,
        ].join('\n'),
      ],
      localOnly
        ? `Create or reconcile local production tag ${tag} bound to RC run ${rcRunId}; do not publish it.`
        : `Create and push production tag ${tag} bound to RC run ${rcRunId}.`
    )
  );

  if (!localOnly) {
    steps.push(
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
            `.opencode/tmp/postproduction-windows-ajax/rc-${rcRunId}`,
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
          [
            'set -euo pipefail',
            `set -a && . ${quoteShellArg(releaseBundleStateFile)} && set +a`,
            `node scripts/actions-health.mjs report-stale --repo ${DEFAULT_REPO} --sha "$STAGING_CLASSROOMPATH_SHA" --tag ${tag}`,
          ].join('\n'),
        ],
        'Report residual stale/corrupt non-gate GitHub Actions runs for the selected RC without blocking promotion.'
      )
    );

    steps.push(step('print-summary', null, 'Print promotion summary.'));
  }

  return {
    rcRunId,
    tag,
    highRiskWindows,
    postProductionWindowsCanary,
    localOnly,
    identityRoot,
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
/** @param {any} options */
export function writeStepState({
  root = '.opencode/tmp/release-promote',
  identityRoot,
  tag,
  releaseId,
  classroomPathSha,
  openpathSha,
  openpathContractSha256,
  rcRunId,
  startedAt,
  stepId,
  status,
  seconds,
} = {}) {
  const stateRcRunId = normalizeRcRunId(rcRunId, 'rcRunId');
  const stateDir = identityRoot ?? join(root, stateRcRunId ? `rc-${stateRcRunId}` : tag);
  const statePath = join(stateDir, 'state.json');

  let existing = {};
  try {
    existing = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    // First write for this tag — start fresh.
  }

  if (existing.tag && tag && existing.tag !== tag) {
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

  const normalizedClassroomPathSha = normalizeSha40(classroomPathSha, 'classroomPathSha');
  const existingClassroomPathSha = normalizeSha40(
    existing.classroomPathSha,
    'persisted classroomPathSha'
  );
  assertIdentityMatch('ClassroomPath SHA', existingClassroomPathSha, normalizedClassroomPathSha);

  const normalizedOpenpathSha = normalizeSha40(openpathSha, 'openpathSha');
  const existingOpenpathSha = normalizeSha40(existing.openpathSha, 'persisted openpathSha');
  assertIdentityMatch('OpenPath SHA', existingOpenpathSha, normalizedOpenpathSha);

  const normalizedOpenpathContractSha256 = normalizeSha256(
    openpathContractSha256,
    'openpathContractSha256'
  );
  const existingOpenpathContractSha256 = normalizeSha256(
    existing.openpathContractSha256,
    'persisted openpathContractSha256'
  );
  assertIdentityMatch(
    'OpenPath contract SHA-256',
    existingOpenpathContractSha256,
    normalizedOpenpathContractSha256
  );

  const boundReleaseId = normalizedReleaseId || existingReleaseId;
  const boundClassroomPathSha = normalizedClassroomPathSha || existingClassroomPathSha;
  const boundOpenpathSha = normalizedOpenpathSha || existingOpenpathSha;
  const boundOpenpathContractSha256 =
    normalizedOpenpathContractSha256 || existingOpenpathContractSha256;
  const boundRcRunId = normalizedRcRunId || existingRcRunId;

  const updated = {
    ...(tag ? { tag } : {}),
    ...(boundReleaseId ? { releaseId: boundReleaseId } : {}),
    ...(boundClassroomPathSha ? { classroomPathSha: boundClassroomPathSha } : {}),
    ...(boundOpenpathSha ? { openpathSha: boundOpenpathSha } : {}),
    ...(boundOpenpathContractSha256 ? { openpathContractSha256: boundOpenpathContractSha256 } : {}),
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

function normalizeSha40(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${label} must be a 40-character lowercase SHA`);
  }
  return normalized;
}

function normalizeSha256(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${label} must be a 64-character lowercase SHA-256 hex string`);
  }
  return normalized;
}

function assertIdentityMatch(label, existingValue, requestedValue) {
  if (existingValue && requestedValue && existingValue !== requestedValue) {
    throw new Error(
      `Promotion state is bound to a different ${label}: ${existingValue} != ${requestedValue}`
    );
  }
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
  const classroomPathSha = normalizeSha40(
    values.STAGING_CLASSROOMPATH_SHA,
    'STAGING_CLASSROOMPATH_SHA'
  );
  const openpathSha = normalizeSha40(values.STAGING_OPENPATH_SHA, 'STAGING_OPENPATH_SHA');
  const openpathContractSha256 = normalizeSha256(
    values.STAGING_OPENPATH_CONTRACT_SHA256,
    'STAGING_OPENPATH_CONTRACT_SHA256'
  );
  const rcRunId = normalizeRcRunId(values.STAGING_RELEASE_RUN_ID, 'STAGING_RELEASE_RUN_ID');
  if (!releaseId || !classroomPathSha || !openpathSha || !openpathContractSha256 || !rcRunId) {
    throw new Error(`Exact Release Bundle locator is incomplete: ${locatorPath}`);
  }
  return { releaseId, classroomPathSha, openpathSha, openpathContractSha256, rcRunId };
}

/**
 * Read the per-step state file for a given tag.
 * Returns null when no state file exists yet.
 */
/** @param {any} options */
export function readStepState({
  root = '.opencode/tmp/release-promote',
  tag,
  rcRunId,
  identityRoot,
} = {}) {
  const stateRcRunId = normalizeRcRunId(rcRunId, 'rcRunId');
  const statePath = join(
    identityRoot ?? join(root, stateRcRunId ? `rc-${stateRcRunId}` : tag),
    'state.json'
  );
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
