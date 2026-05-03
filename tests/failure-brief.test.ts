import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildFailureBrief, renderFailureBriefMarkdown } from '../scripts/lib/failure-brief.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function withTempDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'failure-brief-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe('failure brief', () => {
  test('Windows page observer failures map to extension cleanup retry', () => {
    withTempDir((dir) => {
      const artifact = join(dir, 'production-windows-ajax-auto-allow-canary.json');
      writeJson(artifact, {
        success: false,
        failureBoundary: {
          id: 'page-observer',
          message: 'The Firefox page-resource observer was not installed.',
        },
        diagnosticPhases: [
          { id: 'firefox-extension-ready', status: 'passed' },
          { id: 'origin-page-load', status: 'passed' },
          { id: 'page-observer', status: 'failed' },
        ],
        probeEvidence: [{ id: 'ajax-fetch', expectedWhitelistHost: 'ajax.example.test' }],
      });

      const brief = buildFailureBrief({ artifactPath: artifact, kind: 'windows-ajax' });

      assert.equal(brief.kind, 'windows-ajax');
      assert.equal(brief.status, 'fail');
      assert.equal(brief.failureBoundary.id, 'page-observer');
      assert.equal(brief.probableLayer, 'extension');
      assert.equal(brief.safeToRetry, 'after-cleanup');
      assert.match(brief.nextCommand, /diagnostics:windows-ajax:direct/);
      assert.deepEqual(brief.missingEvidence, []);
    });
  });

  test('Linux DNS failures map to DNS layer and direct network check command', () => {
    withTempDir((dir) => {
      const artifact = join(dir, 'production-linux-ajax-auto-allow-canary.json');
      writeJson(artifact, {
        success: false,
        failureBoundary: {
          id: 'dns-policy-apply',
          message: 'The Linux DNS policy did not allow every expected host.',
        },
        diagnosticPhases: [
          { id: 'firefox-extension-ready', status: 'passed' },
          { id: 'dns-policy-apply', status: 'failed' },
        ],
        probeEvidence: [{ id: 'ajax-fetch', expectedWhitelistHost: 'ajax.example.test' }],
      });

      const brief = buildFailureBrief({ artifactPath: artifact, kind: 'linux-ajax' });

      assert.equal(brief.status, 'fail');
      assert.equal(brief.failureBoundary.id, 'dns-policy-apply');
      assert.equal(brief.probableLayer, 'dns');
      assert.equal(brief.safeToRetry, 'no');
      assert.match(brief.nextCommand, /diagnostics:linux-ajax:direct/);
      assert.match(brief.nextCommand, /network/);
    });
  });

  test('missing artifacts produce artifact-written without throwing', () => {
    const artifact = '/tmp/classroompath-missing-failure-brief-artifact.json';

    const brief = buildFailureBrief({ artifactPath: artifact, kind: 'windows-ajax' });

    assert.equal(brief.status, 'unknown');
    assert.equal(brief.failureBoundary.id, 'artifact-written');
    assert.equal(brief.requiredEvidence.present, 'no');
    assert.match(brief.message, /Could not read artifact/);
    assert.deepEqual(brief.missingEvidence, ['artifact']);
  });

  test('passing artifacts produce no escalation', () => {
    withTempDir((dir) => {
      const artifact = join(dir, 'production-linux-ajax-auto-allow-canary.json');
      writeJson(artifact, {
        success: true,
        failureBoundary: {
          id: 'none',
          message: 'Linux AJAX auto-allow canary completed successfully.',
        },
        diagnosticPhases: [{ id: 'artifact-written', status: 'passed' }],
      });

      const brief = buildFailureBrief({ artifactPath: artifact, kind: 'linux-ajax' });
      const markdown = renderFailureBriefMarkdown(brief);

      assert.equal(brief.status, 'pass');
      assert.equal(brief.failureBoundary.id, 'none');
      assert.equal(brief.safeToRetry, 'not-needed');
      assert.equal(brief.nextCommand, 'No action required');
      assert.match(markdown, /Status: pass/);
      assert.match(markdown, /Read full artifact only if: no escalation/);
    });
  });

  test('Windows cleanup evidence upgrades retry classification', () => {
    withTempDir((dir) => {
      const artifact = join(dir, 'production-windows-ajax-auto-allow-canary.json');
      writeJson(artifact, {
        success: false,
        failureBoundary: {
          id: 'origin-page-load',
          message: 'Origin page did not reach the local canary server.',
        },
        cleanup: {
          leftoverBrowserProcesses: [
            { name: 'firefox.exe', pid: 501 },
            { name: 'geckodriver.exe', pid: 777 },
          ],
        },
        diagnosticPhases: [{ id: 'origin-page-load', status: 'failed' }],
      });

      const brief = buildFailureBrief({ artifactPath: artifact, kind: 'windows-ajax' });

      assert.equal(brief.probableLayer, 'browser');
      assert.equal(brief.safeToRetry, 'after-cleanup');
      assert.match(brief.message, /cleanup evidence/);
    });
  });

  test('CLI writes markdown by default and JSON with --format json', () => {
    withTempDir((dir) => {
      const artifact = join(dir, 'production-windows-ajax-auto-allow-canary.json');
      const output = join(dir, 'brief.json');
      writeJson(artifact, {
        success: false,
        failureBoundary: { id: 'page-observer', message: 'Observer missing.' },
        diagnosticPhases: [{ id: 'page-observer', status: 'failed' }],
      });

      const markdownResult = spawnSync(
        process.execPath,
        ['scripts/failure-brief.mjs', '--artifact', artifact, '--kind', 'windows-ajax'],
        { cwd: projectRoot, encoding: 'utf8' }
      );
      assert.equal(markdownResult.status, 0, markdownResult.stderr);
      assert.match(markdownResult.stdout, /^# Failure Brief/);
      assert.match(markdownResult.stdout, /Kind: windows-ajax/);

      const jsonResult = spawnSync(
        process.execPath,
        [
          'scripts/failure-brief.mjs',
          '--artifact',
          artifact,
          '--kind',
          'windows-ajax',
          '--format',
          'json',
          '--output',
          output,
        ],
        { cwd: projectRoot, encoding: 'utf8' }
      );
      assert.equal(jsonResult.status, 0, jsonResult.stderr);
      assert.equal(JSON.parse(readFileSync(output, 'utf8')).failureBoundary.id, 'page-observer');
    });
  });
});
