#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_ARTIFACT_PATH = 'linux-auto-allow-boundary.json';

function parseArgs(argv) {
  const options = {
    artifactPath: DEFAULT_ARTIFACT_PATH,
    summaryPath: '',
    missingArtifactResult: 'failure',
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

    if (arg === '--artifact') {
      options.artifactPath = next();
    } else if (arg === '--summary') {
      options.summaryPath = next();
    } else if (arg === '--missing-artifact-result') {
      options.missingArtifactResult = next();
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node scripts/summarize-linux-student-policy-evidence.mjs [options]

Options:
  --artifact <path>                 Linux auto-allow boundary JSON (default: ${DEFAULT_ARTIFACT_PATH})
  --summary <path>                  Optional markdown summary output path
  --missing-artifact-result <mode>  failure | success (default: failure)
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function writeGithubOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value).replace(/\r?\n/g, ' ')}\n`);
}

function missingArtifactSuccess(artifactPath) {
  return {
    platform: 'linux',
    success: true,
    failureBoundary: {
      id: 'none',
      message: `Linux student policy direct run completed without a boundary artifact at ${artifactPath}.`,
      recommendedNextAction: 'No follow-up required for this direct runner run.',
    },
    diagnosticPhases: [
      {
        id: 'artifact-written',
        status: 'skipped',
        message: 'No boundary artifact was produced because the direct run completed successfully.',
      },
    ],
    probes: [],
    diagnostics: {},
  };
}

function artifactReadFailure(artifactPath, error) {
  return {
    platform: 'linux',
    success: false,
    failureBoundary: {
      id: 'artifact-written',
      message: `Could not read Linux auto-allow artifact at ${artifactPath}: ${error}`,
      recommendedNextAction:
        'Inspect the OpenPath runner artifact directory and summary upload path.',
    },
    diagnosticPhases: [{ id: 'artifact-written', status: 'failed', message: String(error) }],
    probes: [],
    diagnostics: {},
  };
}

export function readLinuxStudentArtifactSummary(
  artifactPath = DEFAULT_ARTIFACT_PATH,
  options = {}
) {
  try {
    if (!existsSync(artifactPath)) {
      if (options.missingArtifactResult === 'success') {
        return missingArtifactSuccess(artifactPath);
      }
      return artifactReadFailure(artifactPath, 'file does not exist');
    }
    return JSON.parse(readFileSync(artifactPath, 'utf8'));
  } catch (error) {
    return artifactReadFailure(
      artifactPath,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function renderLinuxStudentMarkdown(summary) {
  const boundary = summary.failureBoundary ?? {};
  const lines = [
    '## Linux Student Policy Evidence',
    '',
    `- Functional result: \`${summary.success === true ? 'success' : 'failure'}\``,
    `- Failure boundary: \`${boundary.id ?? 'unknown'}\``,
    `- Boundary message: ${boundary.message ?? 'n/a'}`,
    `- Recommended next action: ${boundary.recommendedNextAction ?? 'n/a'}`,
    '',
    '| Phase | Status | Message |',
    '| --- | --- | --- |',
  ];

  for (const phase of summary.diagnosticPhases ?? []) {
    lines.push(`| ${phase.id} | ${phase.status} | ${phase.message ?? ''} |`);
  }

  lines.push('', '| Probe | Host | Result |', '| --- | --- | --- |');
  for (const probe of summary.probes ?? []) {
    const result = probe.secondResult ?? probe.firstResult ?? '';
    lines.push(`| ${probe.id} | ${probe.host} | ${result} |`);
  }

  lines.push('');
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = readLinuxStudentArtifactSummary(options.artifactPath, {
    missingArtifactResult: options.missingArtifactResult,
  });
  const markdown = renderLinuxStudentMarkdown(summary);

  if (options.summaryPath) {
    writeFileSync(options.summaryPath, `${markdown}\n`, 'utf8');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  }

  writeGithubOutput('linux_student_result', summary.success === true ? 'success' : 'failure');
  writeGithubOutput('failure_boundary_id', summary.failureBoundary?.id ?? 'unknown');
  writeGithubOutput('failure_boundary_message', summary.failureBoundary?.message ?? '');

  console.log(markdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
