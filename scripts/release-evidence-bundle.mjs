#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_REPO = 'balejosg/ClassroomPath';
const DEFAULT_PRODUCTION_URL = 'https://classroompath.eu';

function usage() {
  return `Usage: npm run release:evidence-bundle -- --deploy-run <id> [options]

Collects a compact post-release evidence bundle for incident handoffs.

Required:
  --deploy-run <id>          GitHub Actions Deploy run id.

Options:
  --canary-run <id>          GitHub Actions Windows bootstrap canary run id.
  --repo <owner/repo>        GitHub repository. Default: ${DEFAULT_REPO}
  --production-url <url>     Production base URL. Default: ${DEFAULT_PRODUCTION_URL}
  --output-dir <path>        Output directory. Default: release-evidence-bundle-<deploy-run>
  --help                    Show this help.

Generated files include:
  deploy-run.json
  deploy-artifacts.tsv
  windows-bootstrap-canary-run.json
  windows-bootstrap-canary-artifacts.tsv
  production-health.json
  bundle-summary.md
`;
}

function parseArgs(argv) {
  const args = {
    repo: DEFAULT_REPO,
    productionUrl: DEFAULT_PRODUCTION_URL,
    outputDir: null,
    deployRun: null,
    canaryRun: null,
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
      case '--canary-run':
        args.canaryRun = readValue(argv, ++index, arg);
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

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }

  return result.stdout;
}

function ghRunView(repo, runId) {
  return run('gh', [
    'run',
    'view',
    runId,
    '--repo',
    repo,
    '--json',
    'status,conclusion,headSha,createdAt,updatedAt,url,workflowName,jobs',
  ]);
}

function ghArtifacts(repo, runId) {
  return run('gh', [
    'api',
    `repos/${repo}/actions/runs/${runId}/artifacts`,
    '--jq',
    '.artifacts[] | [.name,.expired,.size_in_bytes,.created_at] | @tsv',
  ]);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${body}`);
  }

  return JSON.parse(body);
}

async function collectProductionHealth(productionUrl) {
  const [health, ready] = await Promise.all([
    fetchJson(`${productionUrl}/cp/health`),
    fetchJson(`${productionUrl}/cp/ready`),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    productionUrl,
    health,
    ready,
  };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const outputDir = resolve(args.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const deployRun = JSON.parse(ghRunView(args.repo, args.deployRun));
  writeJson(resolve(outputDir, 'deploy-run.json'), deployRun);
  writeFileSync(
    resolve(outputDir, 'deploy-artifacts.tsv'),
    ghArtifacts(args.repo, args.deployRun),
    'utf8'
  );

  let canaryRun = null;
  if (args.canaryRun) {
    canaryRun = JSON.parse(ghRunView(args.repo, args.canaryRun));
    writeJson(resolve(outputDir, 'windows-bootstrap-canary-run.json'), canaryRun);
    writeFileSync(
      resolve(outputDir, 'windows-bootstrap-canary-artifacts.tsv'),
      ghArtifacts(args.repo, args.canaryRun),
      'utf8'
    );
  }

  const productionHealth = await collectProductionHealth(args.productionUrl);
  writeJson(resolve(outputDir, 'production-health.json'), productionHealth);

  const summary = [
    '# Release Evidence Bundle',
    '',
    `- Repository: \`${args.repo}\``,
    `- Deploy run: ${deployRun.url ?? args.deployRun}`,
    `- Deploy conclusion: \`${deployRun.conclusion ?? deployRun.status ?? 'unknown'}\``,
    `- Deploy SHA: \`${deployRun.headSha ?? 'unknown'}\``,
    `- Windows bootstrap canary run: ${canaryRun?.url ?? args.canaryRun ?? 'n/a'}`,
    `- Windows bootstrap canary conclusion: \`${canaryRun?.conclusion ?? 'n/a'}\``,
    `- Production health: \`${productionHealth.health?.status ?? 'unknown'}\``,
    `- Production ready: \`${productionHealth.ready?.ready ?? 'unknown'}\``,
    '',
  ].join('\n');
  writeFileSync(resolve(outputDir, 'bundle-summary.md'), summary, 'utf8');

  process.stdout.write(`Wrote release evidence bundle to ${outputDir}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
