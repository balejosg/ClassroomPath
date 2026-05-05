import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseYaml } from 'yaml';

export type WorkflowJob = {
  name?: string;
  if?: string;
  needs?: string | string[];
  outputs?: Record<string, string>;
  'runs-on'?: string | string[];
  uses?: string;
  secrets?: string | Record<string, string>;
  with?: Record<string, unknown>;
  steps?: Array<{
    name?: string;
    id?: string;
    if?: string;
    run?: string;
    uses?: string;
    env?: Record<string, string>;
    with?: Record<string, unknown>;
    'continue-on-error'?: boolean;
    shell?: string;
    'working-directory'?: string;
  }>;
};

export type WorkflowDefinition = {
  permissions?: Record<string, string>;
  concurrency?: string | { group?: string; 'cancel-in-progress'?: boolean };
  on?: {
    push?: {
      branches?: string[];
      tags?: string[];
      paths?: string[];
    };
    schedule?: Array<{
      cron?: string;
    }>;
    workflow_run?: {
      workflows?: string[];
      types?: string[];
    };
    workflow_call?: Record<string, unknown>;
    workflow_dispatch?: {
      inputs?: Record<
        string,
        {
          description?: string;
          required?: boolean;
          default?: boolean | string;
          type?: string;
        }
      >;
    };
  };
  jobs?: Record<string, WorkflowJob>;
};

const currentFilePath = fileURLToPath(import.meta.url);
const helpersDir = dirname(currentFilePath);
const projectRoot = resolve(helpersDir, '..', '..');
const SANITIZED_GIT_ENV_KEYS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_WORK_TREE',
] as const;

function resolveProjectPath(relativePath: string): string {
  const filePath = resolve(projectRoot, relativePath);
  assert.ok(existsSync(filePath), `${relativePath} should exist`);
  return filePath;
}

export function readProjectText(relativePath: string): string {
  return readFileSync(resolveProjectPath(relativePath), 'utf-8');
}

export function readProjectWorkflow(relativePath: string): WorkflowDefinition {
  return parseYaml(readProjectText(relativePath)) as WorkflowDefinition;
}

export function readProjectJson<T>(relativePath: string): T {
  return JSON.parse(readProjectText(relativePath)) as T;
}

export function assertTextIncludesAll(
  content: string,
  requiredTokens: string[],
  message: string
): void {
  for (const token of requiredTokens) {
    assert.ok(content.includes(token), `${message}: missing ${token}`);
  }
}

export function assertTextExcludesAll(
  content: string,
  forbiddenTokens: string[],
  message: string
): void {
  for (const token of forbiddenTokens) {
    assert.ok(!content.includes(token), `${message}: should not include ${token}`);
  }
}

export function assertTextSequence(
  content: string,
  orderedTokens: string[],
  message: string
): void {
  let lastIndex = -1;

  for (const token of orderedTokens) {
    const index = content.indexOf(token, lastIndex + 1);
    assert.notEqual(index, -1, `${message}: missing ${token}`);
    assert.ok(index > lastIndex, `${message}: expected ${token} after previous token`);
    lastIndex = index;
  }
}

export function extractShellFunction(content: string, functionName: string): string {
  const pattern = new RegExp(
    `(?:^|\\n)([ \\t]*)${functionName}\\(\\) \\{[\\s\\S]*?(?=\\n\\1[a-zA-Z0-9_]+\\(\\) \\{|\\nelse\\n|\\nfi\\n|$)`
  );
  const match = content.match(pattern);

  assert.ok(match, `Expected to find ${functionName}()`);

  const commonIndent = match[1] ?? '';
  return match[0].replace(new RegExp(`\\n${commonIndent}`, 'g'), '\n').trim();
}

export function extractShellAssignment(content: string, variableName: string): string {
  const match = content.match(new RegExp(`(?:^|\\n)${variableName}=(.+)(?:\\n|$)`));

  assert.ok(match?.[1], `Expected to find assignment for ${variableName}`);

  return match[1].trim();
}

export function findWorkflowJob(workflow: WorkflowDefinition, jobName: string): WorkflowJob {
  const job = workflow.jobs?.[jobName];

  assert.ok(job, `Expected workflow to define job ${jobName}`);

  return job;
}

export function findWorkflowStepByName(
  job: WorkflowJob,
  stepName: string
): NonNullable<WorkflowJob['steps']>[number] {
  const step = (job.steps ?? []).find((candidate) => candidate.name === stepName);

  assert.ok(step, `Expected workflow job to define step ${stepName}`);

  return step;
}

export function sanitizeGitEnv(
  envOverrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  const env = {
    ...process.env,
    ...envOverrides,
  };

  for (const key of SANITIZED_GIT_ENV_KEYS) {
    delete env[key];
  }

  return env;
}

export function runProjectCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
  } = {}
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: sanitizeGitEnv(options.env),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
