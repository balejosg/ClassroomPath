#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildDeployBrief, renderDeployBriefMarkdown } from './lib/deploy-brief.mjs';

const DEFAULT_REPO = 'balejosg/ClassroomPath';

function usage() {
  return `Usage: npm run ops:deploy-brief -- [options]

Creates a compact deploy/promotion brief from release evidence.

Modes:
  --release-evidence <path>  Build from an existing release-evidence.json artifact.
  --run <github-run-id>      Download known release evidence artifacts from a GitHub run.

Options:
  --tag <tag>                Release tag. Helps run mode find release-evidence-<tag>.
  --repo <owner/repo>        GitHub repository. Default: ${DEFAULT_REPO}
  --output-dir <path>        Output directory. Default: .opencode/tmp/deploy-brief
  --help                     Show this help.

Generated files:
  deploy-brief.md
  deploy-brief.json
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
    releaseEvidence: null,
    run: null,
    tag: null,
    repo: DEFAULT_REPO,
    outputDir: '.opencode/tmp/deploy-brief',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--release-evidence':
        args.releaseEvidence = readValue(argv, ++index, arg);
        break;
      case '--run':
        args.run = readValue(argv, ++index, arg);
        break;
      case '--tag':
        args.tag = readValue(argv, ++index, arg);
        break;
      case '--repo':
        args.repo = readValue(argv, ++index, arg);
        break;
      case '--output-dir':
        args.outputDir = readValue(argv, ++index, arg);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && !args.releaseEvidence && !args.run) {
    throw new Error('--release-evidence or --run is required');
  }

  return args;
}

function readJsonIfPresent(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { value: null, artifact: { path: filePath ?? 'unknown', status: 'missing' } };
  }

  try {
    return {
      value: JSON.parse(readFileSync(filePath, 'utf8')),
      artifact: { path: filePath, status: 'read' },
    };
  } catch (error) {
    return {
      value: null,
      artifact: {
        path: filePath,
        status: error instanceof Error ? error.message : 'unreadable',
      },
    };
  }
}

function runGh(args) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function viewRun({ repo, runId }) {
  const result = runGh([
    'run',
    'view',
    String(runId),
    '--repo',
    repo,
    '--json',
    'databaseId,url,headSha,jobs',
  ]);

  if (!result.ok) {
    return null;
  }

  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    return null;
  }
}

function downloadReleaseEvidenceArtifact({ repo, runId, tag, outputDir }) {
  const artifactDir = resolve(outputDir, 'source-artifacts');
  mkdirSync(artifactDir, { recursive: true });

  const artifactNames = tag
    ? [`release-evidence-${tag}`, 'release-evidence']
    : ['release-evidence'];
  for (const artifactName of artifactNames) {
    const result = runGh([
      'run',
      'download',
      String(runId),
      '--repo',
      repo,
      '--name',
      artifactName,
      '--dir',
      artifactDir,
    ]);

    if (result.ok) {
      return { artifactDir, artifactName };
    }
  }

  return { artifactDir, artifactName: null };
}

function findReleaseEvidenceJson(dir) {
  if (!existsSync(dir)) {
    return null;
  }

  const candidates = [];
  const visit = (currentDir) => {
    for (const entry of readdirSync(currentDir)) {
      const entryPath = resolve(currentDir, entry);
      const stat = statSync(entryPath);
      if (stat.isDirectory()) {
        visit(entryPath);
      } else if (entry === 'release-evidence.json') {
        candidates.push(entryPath);
      }
    }
  };

  visit(dir);
  return (
    candidates.find((candidate) => candidate.includes('release-evidence-bundle')) ??
    candidates[0] ??
    null
  );
}

function loadReleaseEvidence(args) {
  if (args.releaseEvidence) {
    const result = readJsonIfPresent(resolve(args.releaseEvidence));
    return {
      releaseEvidence: result.value,
      runMetadata: null,
      sourceArtifacts: [result.artifact],
    };
  }

  const runMetadata = viewRun({ repo: args.repo, runId: args.run });
  const download = downloadReleaseEvidenceArtifact({
    repo: args.repo,
    runId: args.run,
    tag: args.tag,
    outputDir: resolve(args.outputDir),
  });
  const releaseEvidencePath = findReleaseEvidenceJson(download.artifactDir);
  const result = readJsonIfPresent(releaseEvidencePath);

  return {
    releaseEvidence: result.value,
    runMetadata,
    sourceArtifacts: [
      {
        path: download.artifactName ?? `release-evidence-${args.tag ?? args.run}`,
        status: download.artifactName ? 'downloaded' : 'missing',
      },
      result.artifact,
    ],
  };
}

function writeBrief({ brief, outputDir }) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'deploy-brief.json'), `${JSON.stringify(brief, null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'deploy-brief.md'), renderDeployBriefMarkdown(brief));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const outputDir = resolve(args.outputDir);
  const { releaseEvidence, runMetadata, sourceArtifacts } = loadReleaseEvidence(args);
  const brief = buildDeployBrief({
    releaseEvidence,
    runMetadata,
    sourceArtifacts,
    repo: args.repo,
  });

  writeBrief({ brief, outputDir });
  process.stdout.write(renderDeployBriefMarkdown(brief));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
