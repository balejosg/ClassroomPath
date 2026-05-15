import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const DEFAULT_REPO = 'balejosg/ClassroomPath';
const PRODUCTION_URL = 'https://classroompath.eu';

export async function runStep({ id, command, env = {}, cwd = process.cwd() }) {
  if (!id) {
    throw new Error('runStep requires id');
  }
  if (!command) {
    throw new Error(`runStep ${id} requires command`);
  }

  const startedAt = performance.now();
  const { executable, args, shell } = normalizeCommand(command);

  const status = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code === 0 ? 'success' : 'failed');
    });
  });

  const seconds = Number(((performance.now() - startedAt) / 1000).toFixed(2));
  return { id, status, seconds };
}

export function buildPromotionPlan({
  tag,
  highRiskWindows = false,
  postProductionWindowsCanary = false,
} = {}) {
  if (!tag) {
    throw new Error('tag is required');
  }
  if (!/^v\d+(?:\.\d+){2,}$/.test(tag)) {
    throw new Error('tag must look like v<major>.<minor>.<patch>');
  }

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
          'git -C upstream/openpath fetch origin main --quiet',
          'test "$(git -C upstream/openpath rev-parse --abbrev-ref HEAD)" = "main"',
          'test "$(git -C upstream/openpath rev-parse HEAD)" = "$(git -C upstream/openpath rev-parse origin/main)"',
        ].join(' && '),
      ],
      'Verify ClassroomPath and upstream OpenPath are clean main checkouts matching origin/main.'
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
        'UPSTREAM_OPENPATH_SHA="$(git -C upstream/openpath rev-parse HEAD)" node scripts/wait-for-release-candidate.mjs resolve-manifest --sha "$(git rev-parse origin/main)"',
      ],
      'Wait for the release-candidate manifest for origin/main.'
    ),
    step(
      'deploy-staging',
      [
        'bash',
        '-lc',
        'STAGING_GHCR_USERNAME=balejosg STAGING_GHCR_TOKEN="$(gh auth token)" npm run deploy:staging',
      ],
      'Deploy the resolved release candidate to staging.'
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
      'tag-production',
      ['npm', 'run', 'promote:production', '--', tag],
      `Create and push production tag ${tag}.`
    ),
    step(
      'wait-production-deploy',
      [
        'bash',
        '-lc',
        `run_id="$(gh run list --repo ${DEFAULT_REPO} --workflow deploy.yml --event push --json databaseId,headBranch --jq '.[] | select(.headBranch == "${tag}") | .databaseId' --limit 20 | head -n1)" && test -n "$run_id" && node scripts/actions-health.mjs wait --repo ${DEFAULT_REPO} --run-id "$run_id"`,
      ],
      'Wait for the tag-triggered production deploy workflow to finish.'
    ),
    step(
      'verify-production-health',
      [
        'bash',
        '-lc',
        `curl -fsS ${PRODUCTION_URL}/cp/health && curl -fsS ${PRODUCTION_URL}/cp/ready`,
      ],
      'Verify production gateway health and readiness.'
    )
  );

  if (postProductionWindowsCanary) {
    steps.push(
      step(
        'run-post-production-windows-canary',
        ['npm', 'run', 'diagnostics:runner', '--', '--suite', 'production-client-update'],
        'Run the post-production Windows client canary.'
      )
    );
  }

  steps.push(step('print-summary', null, 'Print promotion summary.'));

  return { tag, highRiskWindows, postProductionWindowsCanary, steps };
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
