import { describe, test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { gitOutput } from '../scripts/lib/git-process.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');
const riskScriptPath = resolve(projectRoot, 'scripts/detect-windows-firefox-risk.sh');

const runGit = (cwd: string, ...args: string[]) => gitOutput(args, { cwd });

const runRiskScript = (cwd: string, env: Record<string, string>) => {
  const outputPath = join(cwd, 'github-output.env');

  const result = spawnSync('bash', [riskScriptPath], {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      ...env,
      GITHUB_OUTPUT: outputPath,
    },
  });

  if (result.status !== 0) {
    throw (
      result.error ?? new Error(result.stderr || `bash exited with code ${String(result.status)}`)
    );
  }

  if (result.error && result.error.code !== 'EPERM') {
    throw result.error;
  }

  return Object.fromEntries(
    readFileSync(outputPath, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return [key!, rest.join('=')];
      })
  );
};

const commitAll = (cwd: string, message: string) => {
  runGit(cwd, 'add', '.');
  runGit(cwd, 'commit', '-m', message);
  return runGit(cwd, 'rev-parse', 'HEAD');
};

const writeFile = (cwd: string, relativePath: string, content: string) => {
  const path = join(cwd, relativePath);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

void describe('Release Risk Detection', () => {
  void test('detects high risk against the currently deployed production SHA instead of the previous tag', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'release-risk-production-state-'));

    try {
      runGit(repoDir, 'init');
      runGit(repoDir, 'checkout', '-b', 'main');
      runGit(repoDir, 'config', 'user.name', 'Codex');
      runGit(repoDir, 'config', 'user.email', 'codex@example.com');

      writeFile(repoDir, 'README.md', 'baseline\n');
      const productionSha = commitAll(repoDir, 'baseline');

      writeFile(
        repoDir,
        'upstream/openpath/linux/scripts/runtime/openpath-self-update.sh',
        '#!/usr/bin/env bash\n'
      );
      const previousTagSha = commitAll(repoDir, 'risky linux change');
      runGit(repoDir, 'tag', 'v1.2.97', previousTagSha);

      writeFile(repoDir, 'scripts/noop.sh', '#!/usr/bin/env bash\n');
      const targetSha = commitAll(repoDir, 'non risky follow-up');

      writeFileSync(
        join(repoDir, 'production-release-state.env'),
        `APP_SHA=${productionSha}\nIMAGE_SOURCE=release-candidate\n`
      );

      const outputs = runRiskScript(repoDir, {
        GITHUB_REF_NAME: 'v1.2.98',
        GITHUB_SHA: targetSha,
        PRODUCTION_RELEASE_STATE_PATH: 'production-release-state.env',
      });

      assert.equal(outputs.high_risk, 'true');
      assert.equal(outputs.base_source, 'production-state');
      assert.equal(outputs.base_ref, productionSha);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  void test('falls back to the previous release tag when production state is unavailable', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'release-risk-previous-tag-'));

    try {
      runGit(repoDir, 'init');
      runGit(repoDir, 'checkout', '-b', 'main');
      runGit(repoDir, 'config', 'user.name', 'Codex');
      runGit(repoDir, 'config', 'user.email', 'codex@example.com');

      writeFile(repoDir, 'README.md', 'baseline\n');
      commitAll(repoDir, 'baseline');

      writeFile(
        repoDir,
        'upstream/openpath/linux/scripts/runtime/openpath-self-update.sh',
        '#!/usr/bin/env bash\n'
      );
      const previousTagSha = commitAll(repoDir, 'risky linux change');
      runGit(repoDir, 'tag', 'v1.2.97', previousTagSha);

      writeFile(repoDir, 'scripts/noop.sh', '#!/usr/bin/env bash\n');
      const targetSha = commitAll(repoDir, 'non risky follow-up');

      const outputs = runRiskScript(repoDir, {
        GITHUB_REF_NAME: 'v1.2.98',
        GITHUB_SHA: targetSha,
      });

      assert.equal(outputs.high_risk, 'false');
      assert.equal(outputs.base_source, 'previous-tag');
      assert.equal(outputs.base_ref, 'v1.2.97');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  void test('ignores contaminated git env when resolving release risk in temp repos', () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'release-risk-contaminated-env-'));

    try {
      runGit(repoDir, 'init');
      runGit(repoDir, 'checkout', '-b', 'main');
      runGit(repoDir, 'config', 'user.name', 'Codex');
      runGit(repoDir, 'config', 'user.email', 'codex@example.com');

      writeFile(repoDir, 'README.md', 'baseline\n');
      commitAll(repoDir, 'baseline');

      writeFile(
        repoDir,
        'upstream/openpath/linux/scripts/runtime/openpath-self-update.sh',
        '#!/usr/bin/env bash\n'
      );
      const previousTagSha = commitAll(repoDir, 'risky linux change');
      runGit(repoDir, 'tag', 'v1.2.97', previousTagSha);

      writeFile(repoDir, 'scripts/noop.sh', '#!/usr/bin/env bash\n');
      const targetSha = commitAll(repoDir, 'non risky follow-up');

      const outputs = runRiskScript(repoDir, {
        GITHUB_REF_NAME: 'v1.2.98',
        GITHUB_SHA: targetSha,
        GIT_DIR: join(repoDir, 'bogus-dot-git'),
        GIT_INDEX_FILE: join(repoDir, 'bogus.index'),
      });

      assert.equal(outputs.high_risk, 'false');
      assert.equal(outputs.base_source, 'previous-tag');
      assert.equal(outputs.base_ref, 'v1.2.97');
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});
