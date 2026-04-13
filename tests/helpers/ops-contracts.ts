import assert from 'node:assert/strict';
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
    with?: Record<string, unknown>;
    'continue-on-error'?: boolean;
    'working-directory'?: string;
  }>;
};

export type WorkflowDefinition = {
  concurrency?: string | { group?: string; 'cancel-in-progress'?: boolean };
  on?: {
    push?: {
      branches?: string[];
      tags?: string[];
      paths?: string[];
    };
    workflow_run?: {
      workflows?: string[];
      types?: string[];
    };
    workflow_call?: Record<string, unknown>;
    workflow_dispatch?: Record<string, never>;
  };
  jobs?: Record<string, WorkflowJob>;
};

const currentFilePath = fileURLToPath(import.meta.url);
const helpersDir = dirname(currentFilePath);
const projectRoot = resolve(helpersDir, '..', '..');

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
