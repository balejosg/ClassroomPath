import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

import { gitMaybe, gitOutput, sanitizeGitEnv } from '../scripts/lib/git-process.mjs';

function writeFile(cwd: string, relativePath: string, content: string) {
  const path = join(cwd, relativePath);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

function initRepo(repoDir: string) {
  gitOutput(['init'], { cwd: repoDir });
  gitOutput(['checkout', '-b', 'main'], { cwd: repoDir });
  gitOutput(['config', 'user.name', 'Codex'], { cwd: repoDir });
  gitOutput(['config', 'user.email', 'codex@example.com'], { cwd: repoDir });
}

describe('git process helpers', () => {
  test('sanitizeGitEnv removes repository-routing variables without touching unrelated env', () => {
    const sanitized = sanitizeGitEnv({
      HOME: '/tmp/home',
      GIT_DIR: '/tmp/bogus',
      GIT_INDEX_FILE: '/tmp/bogus.index',
      GIT_WORK_TREE: '/tmp/worktree',
      GIT_TERMINAL_PROMPT: '0',
    });

    assert.equal(sanitized.HOME, '/tmp/home');
    assert.equal(sanitized.GIT_TERMINAL_PROMPT, '0');
    assert.equal('GIT_DIR' in sanitized, false);
    assert.equal('GIT_INDEX_FILE' in sanitized, false);
    assert.equal('GIT_WORK_TREE' in sanitized, false);
  });

  test('gitOutput ignores contaminated git env when cwd points at a valid repo', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'classroompath-git-process-'));

    try {
      initRepo(repoDir);
      writeFile(repoDir, 'README.md', 'baseline\n');
      gitOutput(['add', '.'], { cwd: repoDir });
      gitOutput(['commit', '-m', 'baseline'], { cwd: repoDir });
      const head = gitOutput(['rev-parse', 'HEAD'], { cwd: repoDir });

      const contaminatedEnv = {
        ...process.env,
        GIT_DIR: join(repoDir, 'bogus-dot-git'),
        GIT_INDEX_FILE: join(repoDir, 'bogus.index'),
      };

      assert.equal(gitOutput(['rev-parse', 'HEAD'], { cwd: repoDir, env: contaminatedEnv }), head);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  test('gitMaybe preserves the current empty-string fallback contract', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'classroompath-git-process-maybe-'));

    try {
      assert.equal(gitMaybe(['rev-parse', 'HEAD'], { cwd: repoDir }), '');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
