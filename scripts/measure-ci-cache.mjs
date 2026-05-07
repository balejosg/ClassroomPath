import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parse as parseYaml } from 'yaml';

const DEFAULT_WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/reusable-smoke-test.yml'];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseWorkflow(text, path) {
  const parsed = parseYaml(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${path} must parse as a workflow object`);
  }

  return parsed;
}

function normalizeWorkflows(workflows) {
  return workflows.map((workflow) => ({
    path: String(workflow.path ?? '').trim(),
    definition: parseWorkflow(String(workflow.text ?? ''), workflow.path),
  }));
}

function findNpmRunScripts(command) {
  const scripts = [];
  const pattern = /(?:^|[\s;&|()])npm\s+run\s+([A-Za-z0-9:_-]+)/g;
  let match;

  while ((match = pattern.exec(command))) {
    scripts.push(match[1]);
  }

  return scripts;
}

function findTurboMode(command) {
  const match = command.match(/scripts\/run-turbo\.sh\s+([A-Za-z0-9:_-]+)/);
  return match?.[1] ?? null;
}

function isTurboBackedScript(packageJson, scriptName) {
  const command = String(packageJson?.scripts?.[scriptName] ?? '');

  return (
    command.includes('scripts/run-turbo.sh') || command.includes('scripts/build-classroompath.sh')
  );
}

function createCommandRecord({ workflowPath, jobId, job, step, scriptName = null }) {
  return {
    workflowPath,
    jobId,
    jobName: String(job.name ?? jobId),
    stepName: String(step.name ?? ''),
    command: String(step.run ?? ''),
    workingDirectory: String(step['working-directory'] ?? ''),
    scriptName,
  };
}

function collectWorkflowCommands({ packageJson, workflows }) {
  const browserDownloadCommands = [];
  const dependencyInstallCommands = [];
  const directTestCommands = [];
  const turboBackedCommands = [];

  for (const workflow of normalizeWorkflows(workflows)) {
    const jobs = workflow.definition.jobs ?? {};
    for (const [jobId, job] of Object.entries(jobs)) {
      for (const step of asArray(job.steps)) {
        const command = String(step?.run ?? '');
        if (!command) {
          continue;
        }

        const record = createCommandRecord({
          workflowPath: workflow.path,
          jobId,
          job,
          step,
        });

        if (/(?:^|[\s;&|()])(?:npx\s+)?playwright\s+install\b/.test(command)) {
          browserDownloadCommands.push(record);
        }

        if (/(?:^|[\s;&|()])npm\s+ci\b/.test(command)) {
          dependencyInstallCommands.push(record);
        }

        if (/(?:^|[\s;&|()])(?:npx\s+)?playwright\s+test\b/.test(command)) {
          directTestCommands.push(record);
        }

        const directTurboMode = findTurboMode(command);
        if (directTurboMode) {
          turboBackedCommands.push({
            ...record,
            scriptName: directTurboMode,
          });
          continue;
        }

        for (const scriptName of findNpmRunScripts(command)) {
          if (isTurboBackedScript(packageJson, scriptName)) {
            turboBackedCommands.push(
              createCommandRecord({
                workflowPath: workflow.path,
                jobId,
                job,
                step,
                scriptName,
              })
            );
          }
        }
      }
    }
  }

  return {
    browserDownloadCommands,
    dependencyInstallCommands,
    directTestCommands,
    turboBackedCommands,
  };
}

function parseCompletedSeconds(startedAt, completedAt) {
  const started = Date.parse(String(startedAt ?? ''));
  const completed = Date.parse(String(completedAt ?? ''));

  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    return null;
  }

  return Math.round((completed - started) / 1000);
}

function parseCompletedSecondsFromRecord(record) {
  return parseCompletedSeconds(
    record.startedAt ?? record.started_at,
    record.completedAt ?? record.completed_at
  );
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return 'n/a';
  }

  const wholeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;

  if (minutes === 0) {
    return `${remainder}s`;
  }

  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

function collectTimingSamples(jobSamples, relevantJobNames) {
  const relevantNames = new Set(relevantJobNames);
  const samples = [];

  for (const sample of asArray(jobSamples)) {
    for (const job of asArray(sample.jobs)) {
      const jobName = String(job.name ?? '');
      if (!relevantNames.has(jobName) || job.conclusion !== 'success') {
        continue;
      }

      const durationSeconds = parseCompletedSecondsFromRecord(job);
      if (durationSeconds === null) {
        continue;
      }

      samples.push({
        workflowName: String(sample.workflowName ?? ''),
        jobName,
        durationSeconds,
      });
    }
  }

  return samples;
}

function collectStepTimingSamples(jobSamples, relevantCommands) {
  const relevantStepsByJobName = new Map();
  const samples = [];

  for (const command of relevantCommands) {
    const stepNames = relevantStepsByJobName.get(command.jobName) ?? new Set();
    stepNames.add(command.stepName);
    relevantStepsByJobName.set(command.jobName, stepNames);
  }

  for (const sample of asArray(jobSamples)) {
    for (const job of asArray(sample.jobs)) {
      const jobName = String(job.name ?? '');
      const relevantStepNames = relevantStepsByJobName.get(jobName);
      if (!relevantStepNames || job.conclusion !== 'success') {
        continue;
      }

      for (const step of asArray(job.steps)) {
        const stepName = String(step.name ?? '');
        if (!relevantStepNames.has(stepName) || step.conclusion !== 'success') {
          continue;
        }

        const durationSeconds = parseCompletedSecondsFromRecord(step);
        if (durationSeconds === null) {
          continue;
        }

        samples.push({
          workflowName: String(sample.workflowName ?? ''),
          jobName,
          stepName,
          durationSeconds,
        });
      }
    }
  }

  return samples;
}

function buildPlaywrightRecommendation(playwright) {
  if (
    playwright.browserDownloadCommands.length === 0 &&
    playwright.directTestCommands.length === 0
  ) {
    return {
      action: 'do-not-add-cache',
      reason:
        'Do not add Playwright browser cache: audited CI workflow set does not install Playwright browsers or run Playwright directly; smoke tests use the verifier image path.',
    };
  }

  if (playwright.browserDownloadCommands.length === 0) {
    return {
      action: 'measure-more',
      reason:
        'Do not add Playwright browser cache yet: Playwright is invoked without an observed browser-install step; collect runner logs first.',
    };
  }

  return {
    action: 'measure-more',
    reason:
      'Do not add Playwright browser cache from a single run: browser installs are present, so compare repeated download time and cache-hit stability before changing cache policy.',
  };
}

function buildDependencyInstallRecommendation(commands, timingSamples) {
  if (commands.length === 0) {
    return {
      action: 'do-not-change',
      reason: 'No npm ci commands were found in the audited workflows.',
    };
  }

  if (timingSamples.length < 2) {
    return {
      action: 'measure-more',
      reason:
        'npm ci commands exist, but at least two successful dependency install timing samples are required before consolidating jobs.',
    };
  }

  return {
    action: 'evaluate-consolidation',
    reason:
      'Repeated dependency install timing samples exist; compare duplicate install cost against the diagnostic value of separate CI lanes before consolidating.',
  };
}

function buildTurboRecommendation(turboBackedCommands, timingSamples) {
  if (turboBackedCommands.length === 0) {
    return {
      action: 'do-not-add-cache',
      reason: 'No turbo-backed workflow commands were found in the audited workflows.',
    };
  }

  if (timingSamples.length < 2) {
    return {
      action: 'measure-more',
      reason:
        'Turbo-backed workflow commands exist, but at least two successful timing samples are required before adding cache.',
    };
  }

  return {
    action: 'evaluate-cache',
    reason:
      'Repeated successful timing samples exist; compare elapsed time and cache-hit stability before introducing a Turbo cache.',
  };
}

export function buildCiCacheMeasurement({ packageJson, workflows, jobSamples = [] }) {
  const commands = collectWorkflowCommands({ packageJson, workflows });
  const dependencyInstallTimingSamples = collectStepTimingSamples(
    jobSamples,
    commands.dependencyInstallCommands
  );
  const turboTimingSamples = collectTimingSamples(
    jobSamples,
    commands.turboBackedCommands.map((command) => command.jobName)
  );
  const turboStepTimingSamples = collectStepTimingSamples(jobSamples, commands.turboBackedCommands);
  const playwright = {
    browserDownloadCommands: commands.browserDownloadCommands,
    directTestCommands: commands.directTestCommands,
  };
  const turbo = {
    turboBackedCommands: commands.turboBackedCommands,
    timingSamples: turboTimingSamples,
    stepTimingSamples: turboStepTimingSamples,
  };

  return {
    playwright: {
      ...playwright,
      recommendation: buildPlaywrightRecommendation(playwright),
    },
    dependencyInstalls: {
      commands: commands.dependencyInstallCommands,
      timingSamples: dependencyInstallTimingSamples,
      recommendation: buildDependencyInstallRecommendation(
        commands.dependencyInstallCommands,
        dependencyInstallTimingSamples
      ),
    },
    turbo: {
      ...turbo,
      recommendation: buildTurboRecommendation(turbo.turboBackedCommands, turbo.timingSamples),
    },
  };
}

function renderCommand(command) {
  const workingDirectory = command.workingDirectory ? `, cwd: ${command.workingDirectory}` : '';
  const scriptName = command.scriptName ? `, script: ${command.scriptName}` : '';

  return `${command.jobName} / ${command.stepName}${workingDirectory}${scriptName}`;
}

function renderStepSamples(samples) {
  if (samples.length === 0) {
    return '- No successful step timing samples were supplied.';
  }

  return samples
    .map(
      (sample) =>
        `- ${sample.jobName} / ${sample.stepName}: ${formatDuration(sample.durationSeconds)}`
    )
    .join('\n');
}

function renderJobSamples(samples) {
  if (samples.length === 0) {
    return '- No successful job timing samples were supplied.';
  }

  return samples
    .map((sample) => `- ${sample.jobName}: ${formatDuration(sample.durationSeconds)}`)
    .join('\n');
}

export function formatCiCacheMeasurementMarkdown(measurement, options = {}) {
  const runId = options.runId ? ` for run ${options.runId}` : '';
  const source = options.source ? `\n\nSource: ${options.source}` : '';
  const dependencyCommands =
    measurement.dependencyInstalls.commands.length === 0
      ? '- No `npm ci` steps found.'
      : measurement.dependencyInstalls.commands
          .map((command) => `- ${renderCommand(command)}`)
          .join('\n');
  const turboCommands =
    measurement.turbo.turboBackedCommands.length === 0
      ? '- No turbo/build-backed workflow steps found.'
      : measurement.turbo.turboBackedCommands
          .map((command) => `- ${renderCommand(command)}`)
          .join('\n');

  return `# ClassroomPath CI Timing Measurement${runId}${source}

## npm ci steps

${dependencyCommands}

### Observed npm ci timing

${renderStepSamples(measurement.dependencyInstalls.timingSamples)}

Recommendation: ${measurement.dependencyInstalls.recommendation.action} - ${measurement.dependencyInstalls.recommendation.reason}

## Turbo/build jobs

${turboCommands}

### Observed turbo/build step timing

${renderStepSamples(measurement.turbo.stepTimingSamples)}

### Observed turbo/build job timing

${renderJobSamples(measurement.turbo.timingSamples)}

Recommendation: ${measurement.turbo.recommendation.action} - ${measurement.turbo.recommendation.reason}

## Playwright cache decision

Recommendation: ${measurement.playwright.recommendation.action} - ${measurement.playwright.recommendation.reason}

Policy: this report is observability only. Do not add Playwright cache, Turbo cache, or new cache policy from this artifact unless repeated CI samples show a material, stable bottleneck.
`;
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

function readWorkflowFiles(paths) {
  return paths.map((path) => ({
    path,
    text: readFileSync(resolve(path), 'utf8'),
  }));
}

function parseArgs(argv) {
  const workflowPaths = [];
  let jobsJsonPath = null;
  let outputPath = null;
  let format = 'json';
  let runId = null;
  let source = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--jobs-json') {
      jobsJsonPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--output') {
      outputPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--format') {
      format = argv[index + 1] ?? format;
      index += 1;
      continue;
    }
    if (arg === '--run-id') {
      runId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === '--source') {
      source = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    workflowPaths.push(arg);
  }

  return {
    format,
    jobsJsonPath,
    outputPath,
    runId,
    source,
    workflowPaths: workflowPaths.length > 0 ? workflowPaths : DEFAULT_WORKFLOWS,
  };
}

export function normalizeJobsJson(rawJobsJson) {
  if (Array.isArray(rawJobsJson)) {
    return rawJobsJson;
  }

  return [
    {
      workflowName: rawJobsJson.workflowName ?? rawJobsJson.name,
      jobs: rawJobsJson.jobs,
    },
  ];
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const measurement = buildCiCacheMeasurement({
    packageJson: readJsonFile('package.json'),
    workflows: readWorkflowFiles(args.workflowPaths),
    jobSamples: args.jobsJsonPath ? normalizeJobsJson(readJsonFile(args.jobsJsonPath)) : [],
  });
  const output =
    args.format === 'markdown'
      ? formatCiCacheMeasurementMarkdown(measurement, {
          runId: args.runId,
          source: args.source,
        })
      : `${JSON.stringify(measurement, null, 2)}\n`;

  if (args.outputPath) {
    writeFileSync(resolve(args.outputPath), output);
    return;
  }

  process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
