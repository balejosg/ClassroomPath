import { readFileSync } from 'node:fs';
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
    scriptName,
  };
}

function collectWorkflowCommands({ packageJson, workflows }) {
  const browserDownloadCommands = [];
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

function collectTimingSamples(jobSamples, relevantJobNames) {
  const relevantNames = new Set(relevantJobNames);
  const samples = [];

  for (const sample of asArray(jobSamples)) {
    for (const job of asArray(sample.jobs)) {
      const jobName = String(job.name ?? '');
      if (!relevantNames.has(jobName) || job.conclusion !== 'success') {
        continue;
      }

      const durationSeconds = parseCompletedSeconds(job.startedAt, job.completedAt);
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

function buildPlaywrightRecommendation(playwright) {
  if (
    playwright.browserDownloadCommands.length === 0 &&
    playwright.directTestCommands.length === 0
  ) {
    return {
      action: 'do-not-add-cache',
      reason:
        'Audited CI workflow set does not install Playwright browsers or run Playwright directly; smoke tests use the verifier image path.',
    };
  }

  if (playwright.browserDownloadCommands.length === 0) {
    return {
      action: 'measure-more',
      reason:
        'Playwright is invoked without an observed browser-install step; collect runner logs before adding browser cache.',
    };
  }

  return {
    action: 'measure-more',
    reason:
      'Playwright browser installs are present; compare repeated download time and cache-hit stability before changing cache policy.',
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
  const turboTimingSamples = collectTimingSamples(
    jobSamples,
    commands.turboBackedCommands.map((command) => command.jobName)
  );
  const playwright = {
    browserDownloadCommands: commands.browserDownloadCommands,
    directTestCommands: commands.directTestCommands,
  };
  const turbo = {
    turboBackedCommands: commands.turboBackedCommands,
    timingSamples: turboTimingSamples,
  };

  return {
    playwright: {
      ...playwright,
      recommendation: buildPlaywrightRecommendation(playwright),
    },
    turbo: {
      ...turbo,
      recommendation: buildTurboRecommendation(turbo.turboBackedCommands, turbo.timingSamples),
    },
  };
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

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--jobs-json') {
      jobsJsonPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    workflowPaths.push(arg);
  }

  return {
    jobsJsonPath,
    workflowPaths: workflowPaths.length > 0 ? workflowPaths : DEFAULT_WORKFLOWS,
  };
}

function normalizeJobsJson(rawJobsJson) {
  if (Array.isArray(rawJobsJson)) {
    return rawJobsJson;
  }

  return [
    {
      workflowName: rawJobsJson.workflowName,
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

  process.stdout.write(`${JSON.stringify(measurement, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
