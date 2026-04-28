import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  readLinuxStudentArtifactSummary,
  renderLinuxStudentMarkdown,
} from '../scripts/summarize-linux-student-policy-evidence.mjs';

test('Linux student evidence summary exposes failure boundary outputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'linux-student-summary-'));
  const artifactPath = join(dir, 'linux-auto-allow-boundary.json');
  writeFileSync(
    artifactPath,
    `${JSON.stringify(
      {
        platform: 'linux',
        success: false,
        failureBoundary: {
          id: 'dns-policy-apply',
          message: 'api.example.test did not resolve through local dnsmasq',
          recommendedNextAction: 'Inspect dnsmasq state.',
        },
        diagnosticPhases: [
          { id: 'local-whitelist-apply', status: 'passed' },
          { id: 'dns-policy-apply', status: 'failed' },
        ],
        probes: [{ id: 'fetch', host: 'api.example.test', url: 'http://api.example.test/fetch' }],
        diagnostics: { resolvConf: 'nameserver 127.0.0.1\n' },
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  const summary = readLinuxStudentArtifactSummary(artifactPath);

  assert.equal(summary.success, false);
  assert.equal(summary.failureBoundary.id, 'dns-policy-apply');
  assert.equal(
    summary.failureBoundary.message,
    'api.example.test did not resolve through local dnsmasq'
  );
});

test('Linux student evidence markdown includes phases and probes', () => {
  const markdown = renderLinuxStudentMarkdown({
    platform: 'linux',
    success: true,
    failureBoundary: {
      id: 'success',
      message: 'Linux AJAX/subresource auto-allow completed successfully.',
      recommendedNextAction: 'No action.',
    },
    diagnosticPhases: [{ id: 'probe-traffic', status: 'passed' }],
    probes: [
      { id: 'fetch', host: 'api.example.test', url: 'http://api.example.test/fetch' },
      { id: 'stylesheet', host: 'style.example.test', url: 'http://style.example.test/style.css' },
    ],
    diagnostics: {},
  });

  assert.match(markdown, /Linux Student Policy Evidence/);
  assert.match(markdown, /Failure boundary: `success`/);
  assert.match(markdown, /\| probe-traffic \| passed \|/);
  assert.match(markdown, /\| fetch \| api\.example\.test \|/);
  assert.match(markdown, /\| stylesheet \| style\.example\.test \|/);
});

test('Linux student evidence summary reports missing artifacts as artifact-written', () => {
  const summary = readLinuxStudentArtifactSummary('/tmp/does-not-exist-linux-auto-allow.json');

  assert.equal(summary.success, false);
  assert.equal(summary.failureBoundary.id, 'artifact-written');
  assert.match(summary.failureBoundary.message, /does-not-exist-linux-auto-allow/);
});

test('Linux student evidence summary treats a missing artifact after exit 0 as direct-run success', () => {
  const summary = readLinuxStudentArtifactSummary('/tmp/does-not-exist-linux-auto-allow.json', {
    missingArtifactResult: 'success',
  });

  assert.equal(summary.success, true);
  assert.equal(summary.failureBoundary.id, 'none');
  assert.match(summary.failureBoundary.message, /completed without a boundary artifact/);
});
