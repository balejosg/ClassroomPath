import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildReleaseEvidenceBundle,
  parseLinuxBootstrapCanaryArtifact,
  parseWindowsBootstrapCanaryArtifact,
  runReleaseEvidenceBundle,
  verifyArtifactIntegrity,
} from '../scripts/lib/release-evidence-bundle.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');
const bundleScriptPath = resolve(projectRoot, 'scripts/release-evidence-bundle.mjs');

const tempDirs: string[] = [];

function createTempDir(prefix: string) {
  const dir = mkdtempSync(resolve(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function buildReleaseEvidenceInput(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-04-30T10:00:00.000Z',
    release: {
      outcome: 'released',
      tagName: 'v1.2.99',
      classroomPathSha: 'cp-sha',
      openPathSha: 'op-sha',
    },
    promotionEligibility: {
      status: 'eligible',
      deploymentMode: 'promotion-eligible',
    },
    workflowRunUrl: 'https://github.com/balejosg/ClassroomPath/actions/runs/123',
    jobs: {
      verifyOpenPathUpstream: 'success',
      resolveReleaseImages: 'success',
      verifyStagingReleaseState: 'success',
      windowsFirefoxCanary: 'success',
      windowsProductionBootstrapCanary: 'success',
      linuxProductionBootstrapCanary: 'success',
      productionClientUpdateCanary: 'live-tested',
      deployProduction: 'success',
      smokeTestProduction: 'success',
      rollbackProduction: 'skipped',
    },
    diagnostics: {
      windowsProductionBootstrapFailureBoundary: {
        id: 'none',
        message: 'Windows AJAX auto-allow canary completed successfully.',
      },
      linuxProductionBootstrapFailureBoundary: {
        id: 'none',
        message: 'Linux AJAX auto-allow canary completed successfully.',
      },
    },
    stagingVerification: {
      smokeResult: 'success',
      smokeStatus: 'PASS',
      releaseGateResult: 'success',
      windowsFirefoxHighRisk: 'true',
      windowsBootstrapResult: 'success',
      firefoxPolicyResult: 'success',
      verifiedAt: '2026-04-30T09:59:00.000Z',
    },
    targets: {
      staging: {
        publicUrl: 'https://classroompath-staging.duckdns.org',
      },
      production: {
        publicUrl: 'http://127.0.0.1:0',
      },
    },
    immutableImages: {
      gateway: 'gateway@sha256:1',
      migrations: 'migrations@sha256:1',
      openPathApi: 'openpath-api@sha256:1',
      spa: 'spa@sha256:1',
      verifier: 'verifier@sha256:1',
    },
    artifacts: {
      releaseImageMetadata: 'release-image-metadata-v1.2.99',
      stagingReleaseState: 'staging-release-state-v1.2.99',
      productionSmokeResults: 'smoke-test-results-production',
      windowsProductionBootstrapCanary: 'windows-production-bootstrap-canary',
      linuxProductionBootstrapCanary: 'linux-production-bootstrap-canary',
      releaseEvidence: 'release-evidence-v1.2.99',
    },
    ...overrides,
  };
}

function writeWindowsCanaryArtifact(artifactDir: string) {
  writeJson(resolve(artifactDir, 'production-windows-ajax-auto-allow-canary.json'), {
    success: true,
    failureBoundary: {
      id: 'none',
      message: 'success',
    },
    diagnosticPhases: [
      { id: 'firefox-extension-ready', status: 'passed' },
      { id: 'artifact-written', status: 'passed' },
    ],
    redditDiagnostics: {
      page: {
        completedRedditDiagnosticEvents: {
          'reddit-emoji-image': true,
          'reddit-external-preview-image': false,
          'reddit-i-image': true,
          'reddit-stylesheet': true,
          'reddit-static-script': false,
        },
      },
      whitelist: {
        global: {
          containsExpectedHosts: {
            'emoji.redditmedia.com': true,
            'external-preview.redd.it': false,
            'i.redd.it': true,
            'styles.redditmedia.com': true,
            'www.redditstatic.com': false,
          },
        },
        native: {
          containsExpectedHosts: {
            'emoji.redditmedia.com': true,
            'external-preview.redd.it': false,
            'i.redd.it': true,
            'styles.redditmedia.com': true,
            'www.redditstatic.com': false,
          },
        },
      },
    },
  });
}

function writeLinuxCanaryArtifact(artifactDir: string) {
  writeJson(resolve(artifactDir, 'production-linux-ajax-auto-allow-canary.json'), {
    success: true,
    failureBoundary: {
      id: 'none',
      message: 'success',
    },
    diagnosticPhases: [
      { id: 'origin-page-load', status: 'passed' },
      { id: 'artifact-written', status: 'passed' },
    ],
    redditDiagnostics: {
      page: {
        completedRedditDiagnosticEvents: {
          'reddit-emoji-image': true,
          'reddit-external-preview-image': false,
          'reddit-i-image': true,
          'reddit-stylesheet': true,
          'reddit-static-script': false,
        },
      },
      whitelist: {
        local: {
          containsExpectedHosts: {
            'emoji.redditmedia.com': true,
            'external-preview.redd.it': false,
            'i.redd.it': true,
            'styles.redditmedia.com': true,
            'www.redditstatic.com': false,
          },
        },
      },
    },
  });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('release evidence bundle module', () => {
  test('parses Windows and Linux bootstrap canary artifacts into normalized evidence', () => {
    const windowsArtifactDir = createTempDir('classroompath-release-evidence-windows-');
    const linuxArtifactDir = createTempDir('classroompath-release-evidence-linux-');

    writeWindowsCanaryArtifact(windowsArtifactDir);
    writeLinuxCanaryArtifact(linuxArtifactDir);

    const windows = parseWindowsBootstrapCanaryArtifact(windowsArtifactDir);
    const linux = parseLinuxBootstrapCanaryArtifact(linuxArtifactDir);

    assert.equal(windows.failureBoundary.id, 'none');
    assert.equal(windows.redditHosts['emoji.redditmedia.com'].globalWhitelist, true);
    assert.equal(windows.redditHosts['emoji.redditmedia.com'].nativeWhitelist, true);
    assert.equal(windows.redditHosts['emoji.redditmedia.com'].pageEvent, true);
    assert.equal(windows.redditHosts['www.redditstatic.com'].pageEvent, false);
    assert.deepEqual(
      windows.diagnosticPhases.map((phase: { id: string }) => phase.id),
      ['firefox-extension-ready', 'artifact-written']
    );
    assert.equal(linux.failureBoundary.id, 'none');
    assert.equal(linux.redditHosts['emoji.redditmedia.com'].globalWhitelist, true);
    assert.equal(linux.redditHosts['emoji.redditmedia.com'].nativeWhitelist, false);
    assert.equal(linux.redditHosts['emoji.redditmedia.com'].pageEvent, true);
    assert.equal(linux.redditHosts['www.redditstatic.com'].pageEvent, false);
    assert.deepEqual(
      linux.diagnosticPhases.map((phase: { id: string }) => phase.id),
      ['origin-page-load', 'artifact-written']
    );
  });

  test('marks a listed Windows bootstrap artifact as missing when the JSON evidence file is absent', () => {
    const windowsArtifactDir = createTempDir('classroompath-release-evidence-missing-');

    writeFileSync(resolve(windowsArtifactDir, 'Update-OpenPath.log'), 'log only\n', 'utf8');

    const integrity = verifyArtifactIntegrity({
      releaseEvidence: buildReleaseEvidenceInput({
        jobs: {
          verifyOpenPathUpstream: 'success',
          resolveReleaseImages: 'success',
          verifyStagingReleaseState: 'success',
          windowsFirefoxCanary: 'success',
          windowsProductionBootstrapCanary: 'success',
          linuxProductionBootstrapCanary: 'failure',
          productionClientUpdateCanary: 'live-tested',
          deployProduction: 'success',
          smokeTestProduction: 'success',
          rollbackProduction: 'skipped',
        },
      }),
      windowsProductionBootstrapCanary: {
        listed: true,
        artifactDir: windowsArtifactDir,
      },
      linuxProductionBootstrapCanary: {
        listed: false,
        artifactDir: null,
      },
    });

    assert.equal(integrity.windowsProductionBootstrapCanary.status, 'missing');
    assert.equal(integrity.linuxProductionBootstrapCanary.status, 'missing');
  });

  test('does not require a canary artifact before a high-risk post-release canary has produced evidence', () => {
    const integrity = verifyArtifactIntegrity({
      releaseEvidence: buildReleaseEvidenceInput({
        jobs: {
          verifyOpenPathUpstream: 'success',
          resolveReleaseImages: 'success',
          verifyStagingReleaseState: 'success',
          windowsFirefoxCanary: 'success',
          windowsProductionBootstrapCanary: 'pending-post-release',
          linuxProductionBootstrapCanary: 'pending-post-release',
          productionClientUpdateCanary: 'pending-post-release',
          deployProduction: 'success',
          smokeTestProduction: 'success',
          rollbackProduction: 'skipped',
        },
      }),
      windowsProductionBootstrapCanary: {
        listed: false,
        artifactDir: null,
      },
      linuxProductionBootstrapCanary: {
        listed: false,
        artifactDir: null,
      },
    });

    assert.equal(integrity.windowsProductionBootstrapCanary.status, 'not_applicable');
    assert.equal(integrity.linuxProductionBootstrapCanary.status, 'not_applicable');
  });

  test('writes partial bundle outputs before failing when a successful canary is missing its JSON artifact', async () => {
    const workspace = createTempDir('classroompath-release-evidence-cli-');
    const fakeBinDir = createTempDir('classroompath-release-evidence-gh-');
    const windowsSourceDir = createTempDir('classroompath-release-evidence-source-windows-');
    const linuxSourceDir = createTempDir('classroompath-release-evidence-source-linux-');
    const bundleOutputDir = resolve(workspace, 'bundle-output');
    const fakeGhPath = resolve(fakeBinDir, 'gh');
    const cliOutputDir = join(workspace, 'cli-output');

    writeFileSync(resolve(windowsSourceDir, 'Update-OpenPath.log'), 'log only\n', 'utf8');
    writeLinuxCanaryArtifact(linuxSourceDir);
    writeJson(resolve(workspace, 'release-evidence.json'), buildReleaseEvidenceInput());

    writeFileSync(
      fakeGhPath,
      `#!/bin/sh
set -eu
if [ "$1" = "api" ]; then
  printf '%s\n' '{"artifacts":[{"name":"windows-production-bootstrap-canary"},{"name":"linux-production-bootstrap-canary"}]}'
  exit 0
fi
if [ "$1" = "run" ] && [ "$2" = "download" ]; then
  artifact_name=''
  output_dir=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --name)
        artifact_name="$2"
        shift 2
        ;;
      --dir)
        output_dir="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done
  mkdir -p "$output_dir"
  if [ "$artifact_name" = "windows-production-bootstrap-canary" ]; then
    cp -R "$TEST_WINDOWS_ARTIFACT_DIR"/. "$output_dir"/
    exit 0
  fi
  if [ "$artifact_name" = "linux-production-bootstrap-canary" ]; then
    cp -R "$TEST_LINUX_ARTIFACT_DIR"/. "$output_dir"/
    exit 0
  fi
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`,
      'utf8'
    );
    chmodSync(fakeGhPath, 0o755);

    const bundle = buildReleaseEvidenceBundle({
      releaseEvidence: buildReleaseEvidenceInput({
        targets: {
          staging: { publicUrl: 'https://classroompath-staging.duckdns.org' },
          production: { publicUrl: 'https://classroompath.eu' },
        },
      }),
      productionHealth: {
        checkedAt: '2026-04-30T10:05:00.000Z',
        productionUrl: 'https://classroompath.eu',
        health: { status: 'ok' },
        ready: { ready: true },
      },
      outputDir: bundleOutputDir,
      windowsProductionBootstrapCanary: {
        listed: true,
        artifactDir: windowsSourceDir,
      },
      linuxProductionBootstrapCanary: {
        listed: true,
        artifactDir: linuxSourceDir,
      },
    });

    assert.equal(bundle.artifactIntegrity.windowsProductionBootstrapCanary.status, 'missing');
    assert.equal(bundle.artifactIntegrity.linuxProductionBootstrapCanary.status, 'ok');
    assert.equal(
      JSON.parse(readFileSync(resolve(bundleOutputDir, 'artifact-integrity.json'), 'utf8'))
        .windowsProductionBootstrapCanary.status,
      'missing'
    );
    assert.equal(
      JSON.parse(
        readFileSync(
          resolve(bundleOutputDir, 'canary-evidence/linux-production-bootstrap.json'),
          'utf8'
        )
      ).failureBoundary.id,
      'none'
    );

    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;
    const originalWindowsArtifactDir = process.env.TEST_WINDOWS_ARTIFACT_DIR;
    const originalLinuxArtifactDir = process.env.TEST_LINUX_ARTIFACT_DIR;
    const originalFetch = globalThis.fetch;

    try {
      process.chdir(workspace);
      process.env.PATH = `${fakeBinDir}:${originalPath ?? ''}`;
      process.env.TEST_WINDOWS_ARTIFACT_DIR = windowsSourceDir;
      process.env.TEST_LINUX_ARTIFACT_DIR = linuxSourceDir;
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url =
          typeof input === 'string' || input instanceof URL ? String(input) : String(input.url);

        if (url.endsWith('/cp/health')) {
          return {
            ok: true,
            text: async () => '{"status":"ok"}',
          } as Response;
        }

        if (url.endsWith('/cp/ready')) {
          return {
            ok: true,
            text: async () => '{"ready":true}',
          } as Response;
        }

        return {
          ok: false,
          text: async () => '{"error":"not-found"}',
        } as Response;
      }) as typeof fetch;

      await assert.rejects(
        runReleaseEvidenceBundle({
          repo: 'balejosg/ClassroomPath',
          deployRun: '123',
          tag: 'v1.2.99',
          outputDir: cliOutputDir,
          productionUrl: 'https://classroompath.eu',
          windowsCanaryRun: null,
          linuxCanaryRun: null,
        }),
        /windows-production-bootstrap-canary.*missing/
      );
      assert.equal(
        JSON.parse(readFileSync(resolve(cliOutputDir, 'artifact-integrity.json'), 'utf8'))
          .windowsProductionBootstrapCanary.status,
        'missing'
      );
      assert.equal(
        JSON.parse(readFileSync(resolve(cliOutputDir, 'production-health.json'), 'utf8')).health
          .status,
        'ok'
      );
      assert.equal(
        JSON.parse(readFileSync(resolve(cliOutputDir, 'release-evidence.json'), 'utf8'))
          .artifactIntegrity.windowsProductionBootstrapCanary.status,
        'missing'
      );
    } finally {
      process.chdir(originalCwd);
      process.env.PATH = originalPath;
      process.env.TEST_WINDOWS_ARTIFACT_DIR = originalWindowsArtifactDir;
      process.env.TEST_LINUX_ARTIFACT_DIR = originalLinuxArtifactDir;
      globalThis.fetch = originalFetch;
    }
  });
});
