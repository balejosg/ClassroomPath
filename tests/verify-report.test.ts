import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';

import { createVerifyReporter } from '../scripts/lib/verify-report.ts';

describe('verify report', () => {
  test('writes a machine-readable verification report with stage transitions', () => {
    const reportDir = mkdtempSync(join(tmpdir(), 'classroompath-verify-report-test-'));
    const reportFile = join(reportDir, 'verify-report.json');

    try {
      const reporter = createVerifyReporter(
        {
          browsersAvailable: true,
          composeFile: 'docker/docker-compose.test.yml',
          composeProjectName: 'classroompath_test_fixture',
          mode: 'commit',
          needsApiCoverage: false,
          needsCoverageGate: false,
          needsSpaCoverage: false,
          playwrightCacheDir: '/tmp/playwright',
          playwrightWorkers: 4,
          rootDir: '/tmp/classroompath',
          skipOpenPathStatic: false,
          stagedFiles: ['scripts/release-images.mjs'],
          submoduleOnly: false,
          testDbPort: 54321,
          verificationScope: 'release-automation',
        },
        {
          now: (() => {
            const values = [
              '2026-04-08T10:00:00.000Z',
              '2026-04-08T10:00:01.000Z',
              '2026-04-08T10:00:02.000Z',
              '2026-04-08T10:00:03.000Z',
            ];
            let index = 0;
            return () => values[index++] ?? values.at(-1) ?? '2026-04-08T10:00:03.000Z';
          })(),
          reportFile,
        }
      );

      reporter.addNote('release automation lane');
      reporter.startStage('format-and-secrets', 'Format and secret checks', {
        commands: ['npm run format:check', 'npm run security:secrets'],
      });
      reporter.completeStage('format-and-secrets', 'Format and secret checks');
      reporter.finalize(true);

      const report = JSON.parse(readFileSync(reportFile, 'utf8')) as {
        ok: boolean;
        scope: string;
        notes: string[];
        stages: Array<{ id: string; status: string }>;
      };

      assert.equal(report.ok, true);
      assert.equal(report.scope, 'release-automation');
      assert.deepEqual(report.notes, ['release automation lane']);
      assert.deepEqual(
        report.stages.map((stage) => ({ id: stage.id, status: stage.status })),
        [
          {
            id: 'format-and-secrets',
            status: 'passed',
          },
        ]
      );
    } finally {
      rmSync(reportDir, { force: true, recursive: true });
    }
  });
});
