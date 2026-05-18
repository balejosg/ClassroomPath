import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildBundleCanaryEvidence,
  buildReleaseEvidenceBundle,
  parseLinuxBootstrapCanaryArtifact,
  parseWindowsBootstrapCanaryArtifact,
  runReleaseEvidenceBundle,
  validateReleaseEvidenceChecklist,
  verifyArtifactIntegrity,
} from '../scripts/lib/release-evidence-bundle.mjs';
import { buildDeployBrief, renderDeployBriefMarkdown } from '../scripts/lib/deploy-brief.mjs';

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
      preproductionWindowsBootstrapCanary: 'success',
      windowsProductionBootstrapCanary: null,
      linuxProductionBootstrapCanary: 'success',
      productionClientUpdateCanary: 'live-tested',
      deployProduction: 'success',
      smokeTestProduction: 'success',
      rollbackProduction: 'skipped',
    },
    diagnostics: {
      preproductionWindowsBootstrapFailureBoundary: {
        id: 'none',
        message:
          'Windows page-resource observation completed without automatic rule creation and explicit allowlist probes succeeded.',
      },
      linuxProductionBootstrapFailureBoundary: {
        id: 'none',
        message:
          'Linux page-resource observation completed without automatic rule creation and explicit allowlist probes succeeded.',
      },
    },
    stagingVerification: {
      smokeResult: 'success',
      smokeStatus: 'PASS',
      releaseGateResult: 'success',
      windowsFirefoxHighRisk: 'true',
      windowsBootstrapResult: 'success',
      firefoxPolicyResult: 'success',
      linuxBootstrapResult: 'success',
      windowsSelfUpdateResult: 'success',
      linuxSelfUpdateResult: 'success',
      prepromotionRehearsalResult: 'success',
      verifiedAt: '2026-04-30T09:59:00.000Z',
    },
    targets: {
      staging: {
        publicUrl: 'https://staging.classroompath.example.invalid',
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
      preproductionWindowsBootstrapCanary: 'preproduction-windows-bootstrap-canary',
      windowsProductionBootstrapCanary: null,
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
      { id: 'blocked-page-unblock-request', status: 'passed' },
      { id: 'external-allowlisted-navigation', status: 'passed' },
      { id: 'artifact-written', status: 'passed' },
    ],
    allowlistedNavigation: {
      url: 'https://example.com/',
      expectedHosts: ['example.com'],
      finalHost: 'example.com',
      href: 'https://example.com/',
      title: 'Example Domain',
      success: true,
      blockedByOpenPath: false,
      timedOut: false,
      errors: [],
    },
    blockedPageUnblockRequest: {
      success: true,
      permissionsMonkeypatch: false,
      permissionStrategy: 'required-data-collection',
      extensionSource: 'managed',
      firefoxMode: 'selenium-managed',
      blockedPageDomain: 'blocked-page-unblock-request.127.0.0.1.sslip.io',
      blockedPageUrl:
        'moz-extension://canary/blocked/blocked.html?domain=blocked-page-unblock-request.127.0.0.1.sslip.io',
      statusText: 'Solicitud enviada. Quedara pendiente hasta que la revisen.',
      errorText: '',
    },
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
  test('selects parsed canary evidence only when artifact integrity passed', () => {
    const windowsArtifactDir = createTempDir('classroompath-release-evidence-policy-windows-');
    writeWindowsCanaryArtifact(windowsArtifactDir);

    const parsed = buildBundleCanaryEvidence({
      integrity: { status: 'ok' },
      artifactDir: windowsArtifactDir,
      parser: parseWindowsBootstrapCanaryArtifact,
      fallbackFailureBoundary: { id: 'fallback', message: 'fallback' },
      fallbackRedditHosts: {},
    });

    assert.equal(parsed.failureBoundary.id, 'none');
    assert.equal(
      parsed.artifactPath.endsWith('production-windows-ajax-auto-allow-canary.json'),
      true
    );

    const fallback = buildBundleCanaryEvidence({
      integrity: { status: 'missing' },
      artifactDir: null,
      parser: parseWindowsBootstrapCanaryArtifact,
      fallbackFailureBoundary: { id: 'preproduction-installed-client-evidence', message: 'held' },
      fallbackRedditHosts: { 'emoji.redditmedia.com': { pageEvent: false } },
    });

    assert.equal(fallback.failureBoundary.id, 'preproduction-installed-client-evidence');
    assert.deepEqual(fallback.diagnosticPhases, [
      { id: 'preproduction-installed-client-evidence', status: 'not_applicable' },
      { id: 'artifact-written', status: 'passed' },
    ]);
    assert.deepEqual(fallback.redditHosts, {
      'emoji.redditmedia.com': { pageEvent: false },
    });
  });

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
    assert.equal(windows.allowlistedNavigation.finalHost, 'example.com');
    assert.equal(windows.blockedPageUnblockRequest.permissionsMonkeypatch, false);
    assert.equal(windows.blockedPageUnblockRequest.permissionStrategy, 'required-data-collection');
    assert.deepEqual(
      windows.diagnosticPhases.map((phase: { id: string }) => phase.id),
      [
        'firefox-extension-ready',
        'blocked-page-unblock-request',
        'external-allowlisted-navigation',
        'artifact-written',
      ]
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

  test('rejects Windows canary evidence without a real blocked-page unblock request proof', () => {
    const windowsArtifactDir = createTempDir(
      'classroompath-release-evidence-windows-missing-blocked-'
    );
    writeWindowsCanaryArtifact(windowsArtifactDir);
    const artifactPath = resolve(
      windowsArtifactDir,
      'production-windows-ajax-auto-allow-canary.json'
    );
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, unknown>;
    delete artifact.blockedPageUnblockRequest;
    writeJson(artifactPath, artifact);

    assert.throws(
      () => parseWindowsBootstrapCanaryArtifact(windowsArtifactDir),
      /windows\.blockedPageUnblockRequest\.success missing or false/
    );
  });

  test('rejects Windows canary evidence without a passed blocked-page diagnostic phase', () => {
    const windowsArtifactDir = createTempDir(
      'classroompath-release-evidence-windows-missing-blocked-phase-'
    );
    writeWindowsCanaryArtifact(windowsArtifactDir);
    const artifactPath = resolve(
      windowsArtifactDir,
      'production-windows-ajax-auto-allow-canary.json'
    );
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      diagnosticPhases?: Array<Record<string, unknown>>;
    };
    artifact.diagnosticPhases = artifact.diagnosticPhases?.filter(
      (phase) => phase.id !== 'blocked-page-unblock-request'
    );
    writeJson(artifactPath, artifact);

    assert.throws(
      () => parseWindowsBootstrapCanaryArtifact(windowsArtifactDir),
      /windows\.diagnosticPhases blocked-page-unblock-request passed missing/
    );
  });

  test('rejects Windows canary evidence that monkeypatches permissions', () => {
    const windowsArtifactDir = createTempDir('classroompath-release-evidence-windows-monkeypatch-');
    writeWindowsCanaryArtifact(windowsArtifactDir);
    const artifactPath = resolve(
      windowsArtifactDir,
      'production-windows-ajax-auto-allow-canary.json'
    );
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      blockedPageUnblockRequest?: Record<string, unknown>;
    };
    artifact.blockedPageUnblockRequest = {
      ...(artifact.blockedPageUnblockRequest ?? {}),
      permissionsMonkeypatch: true,
    };
    writeJson(artifactPath, artifact);

    assert.throws(
      () => parseWindowsBootstrapCanaryArtifact(windowsArtifactDir),
      /windows\.blockedPageUnblockRequest\.permissionsMonkeypatch must be false/
    );
  });

  test('rejects Windows canary evidence without the required data-collection strategy', () => {
    const windowsArtifactDir = createTempDir('classroompath-release-evidence-windows-permission-');
    writeWindowsCanaryArtifact(windowsArtifactDir);
    const artifactPath = resolve(
      windowsArtifactDir,
      'production-windows-ajax-auto-allow-canary.json'
    );
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
      blockedPageUnblockRequest?: Record<string, unknown>;
    };
    artifact.blockedPageUnblockRequest = {
      ...(artifact.blockedPageUnblockRequest ?? {}),
      permissionStrategy: 'runtime-optional-prompt',
    };
    writeJson(artifactPath, artifact);

    assert.throws(
      () => parseWindowsBootstrapCanaryArtifact(windowsArtifactDir),
      /windows\.blockedPageUnblockRequest\.permissionStrategy must be required-data-collection/
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
          preproductionWindowsBootstrapCanary: 'success',
          windowsProductionBootstrapCanary: null,
          linuxProductionBootstrapCanary: 'failure',
          productionClientUpdateCanary: 'live-tested',
          deployProduction: 'success',
          smokeTestProduction: 'success',
          rollbackProduction: 'skipped',
        },
      }),
      preproductionWindowsBootstrapCanary: {
        listed: true,
        artifactDir: windowsArtifactDir,
      },
      linuxProductionBootstrapCanary: {
        listed: false,
        artifactDir: null,
      },
    });

    assert.equal(integrity.preproductionWindowsBootstrapCanary.status, 'missing');
    assert.equal(integrity.linuxProductionBootstrapCanary.status, 'missing');
  });

  test('marks malformed canary evidence invalid before release bundle publication', () => {
    const windowsArtifactDir = createTempDir('classroompath-release-evidence-invalid-');

    writeJson(resolve(windowsArtifactDir, 'production-windows-ajax-auto-allow-canary.json'), {
      success: false,
      failureBoundary: {
        id: 'provisioning',
      },
      diagnosticPhases: [{ id: 'provisioning', status: 'failed' }],
    });

    const integrity = verifyArtifactIntegrity({
      releaseEvidence: buildReleaseEvidenceInput(),
      preproductionWindowsBootstrapCanary: {
        listed: true,
        artifactDir: windowsArtifactDir,
      },
    });

    assert.equal(integrity.preproductionWindowsBootstrapCanary.status, 'invalid');
    assert.match(integrity.preproductionWindowsBootstrapCanary.message, /failureBoundary\.message/);
  });

  test('validates release evidence checklist fields used by production promotion dry runs', () => {
    const complete = validateReleaseEvidenceChecklist(buildReleaseEvidenceInput());
    assert.equal(complete.ok, true);

    const missing = validateReleaseEvidenceChecklist(
      buildReleaseEvidenceInput({
        release: {
          outcome: 'released',
          tagName: 'v1.2.99',
          classroomPathSha: '',
          openPathSha: 'op-sha',
        },
        stagingVerification: {
          smokeResult: 'success',
          smokeStatus: 'PASS',
          releaseGateResult: 'success',
          windowsFirefoxHighRisk: 'true',
        },
      })
    );

    assert.equal(missing.ok, false);
    assert.ok(missing.failures.includes('release.classroomPathSha missing'));
    assert.ok(missing.failures.includes('stagingVerification.verifiedAt missing'));
  });

  test('does not require a canary artifact before a high-risk post-release canary has produced evidence', () => {
    const integrity = verifyArtifactIntegrity({
      releaseEvidence: buildReleaseEvidenceInput({
        jobs: {
          verifyOpenPathUpstream: 'success',
          resolveReleaseImages: 'success',
          verifyStagingReleaseState: 'success',
          windowsFirefoxCanary: 'success',
          preproductionWindowsBootstrapCanary: 'pending-post-release',
          windowsProductionBootstrapCanary: null,
          linuxProductionBootstrapCanary: 'pending-post-release',
          productionClientUpdateCanary: 'pending-post-release',
          deployProduction: 'success',
          smokeTestProduction: 'success',
          rollbackProduction: 'skipped',
        },
      }),
      preproductionWindowsBootstrapCanary: {
        listed: false,
        artifactDir: null,
      },
      linuxProductionBootstrapCanary: {
        listed: false,
        artifactDir: null,
      },
    });

    assert.equal(integrity.preproductionWindowsBootstrapCanary.status, 'not_applicable');
    assert.equal(integrity.linuxProductionBootstrapCanary.status, 'not_applicable');
  });

  test('builds a complete bundle without production canary run IDs when preproduction evidence is authoritative', async () => {
    const workspace = createTempDir('classroompath-release-evidence-preproduction-authority-');
    const outputDir = resolve(workspace, 'bundle-output');

    writeJson(
      resolve(workspace, 'release-evidence.json'),
      buildReleaseEvidenceInput({
        jobs: {
          verifyOpenPathUpstream: 'success',
          resolveReleaseImages: 'success',
          verifyStagingReleaseState: 'success',
          windowsFirefoxCanary: 'success',
          windowsProductionBootstrapCanary: 'not_run_preproduction_authoritative',
          linuxProductionBootstrapCanary: 'not_run_preproduction_authoritative',
          productionClientUpdateCanary: 'advisory-only',
          deployProduction: 'success',
          smokeTestProduction: 'success',
          rollbackProduction: 'skipped',
        },
        diagnostics: {
          windowsProductionBootstrapFailureBoundary: {
            id: 'preproduction-installed-client-evidence',
            message: 'Functional installed-client evidence is gated before production promotion.',
          },
          linuxProductionBootstrapFailureBoundary: {
            id: 'preproduction-installed-client-evidence',
            message: 'Functional installed-client evidence is gated before production promotion.',
          },
        },
        artifacts: {
          releaseImageMetadata: 'release-image-metadata-v1.2.99',
          stagingReleaseState: 'staging-release-state-v1.2.99',
          productionSmokeResults: 'smoke-test-results-production',
          releaseEvidence: 'release-evidence-v1.2.99',
        },
      })
    );

    const originalCwd = process.cwd();
    const originalFetch = globalThis.fetch;

    try {
      process.chdir(workspace);
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

      const bundle = await runReleaseEvidenceBundle({
        repo: 'balejosg/ClassroomPath',
        deployRun: '123',
        tag: 'v1.2.99',
        outputDir,
        productionUrl: 'https://classroompath.example.invalid',
        windowsCanaryRun: null,
        linuxCanaryRun: null,
      });

      assert.equal(
        bundle.artifactIntegrity.preproductionWindowsBootstrapCanary.status,
        'not_applicable'
      );
      assert.equal(
        bundle.artifactIntegrity.linuxProductionBootstrapCanary.status,
        'not_applicable'
      );
      assert.equal(
        bundle.canaries.windows.failureBoundary.id,
        'preproduction-installed-client-evidence'
      );
      assert.equal(
        bundle.canaries.linux.failureBoundary.id,
        'preproduction-installed-client-evidence'
      );
      assert.deepEqual(
        bundle.canaries.windows.diagnosticPhases.map((phase: { id: string; status: string }) => [
          phase.id,
          phase.status,
        ]),
        [
          ['preproduction-installed-client-evidence', 'not_applicable'],
          ['artifact-written', 'passed'],
        ]
      );
      assert.equal(
        JSON.parse(readFileSync(resolve(outputDir, 'artifact-integrity.json'), 'utf8'))
          .preproductionWindowsBootstrapCanary.status,
        'not_applicable'
      );
    } finally {
      process.chdir(originalCwd);
      globalThis.fetch = originalFetch;
    }
  });

  test('uses the deploy run as the default canary artifact run', async () => {
    const workspace = createTempDir('classroompath-release-evidence-deploy-run-workspace-');
    const fakeBinDir = createTempDir('classroompath-release-evidence-deploy-run-bin-');
    const windowsSourceDir = createTempDir('classroompath-release-evidence-deploy-run-windows-');
    const linuxSourceDir = createTempDir('classroompath-release-evidence-deploy-run-linux-');
    const outputDir = resolve(workspace, 'bundle-output');
    const fakeGhPath = resolve(fakeBinDir, 'gh');
    const ghLogPath = resolve(workspace, 'gh.log');

    writeWindowsCanaryArtifact(windowsSourceDir);
    writeLinuxCanaryArtifact(linuxSourceDir);
    writeJson(resolve(workspace, 'release-evidence.json'), buildReleaseEvidenceInput());

    writeFileSync(
      fakeGhPath,
      `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "${ghLogPath}"
if [ "$1" = "api" ]; then
  case "$2" in
    *"/runs/deploy-456/artifacts")
      printf '%s\\n' '{"artifacts":[{"name":"preproduction-windows-bootstrap-canary"},{"name":"linux-production-bootstrap-canary"}]}'
      exit 0
      ;;
  esac
fi
if [ "$1" = "run" ] && [ "$2" = "download" ] && [ "$3" = "deploy-456" ]; then
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
  if [ "$artifact_name" = "preproduction-windows-bootstrap-canary" ]; then
    mkdir -p "$output_dir/ClassroomPath/ClassroomPath"
    cp -R "$TEST_WINDOWS_ARTIFACT_DIR"/. "$output_dir/ClassroomPath/ClassroomPath"/
    exit 0
  fi
  if [ "$artifact_name" = "linux-production-bootstrap-canary" ]; then
    mkdir -p "$output_dir/ClassroomPath/ClassroomPath"
    cp -R "$TEST_LINUX_ARTIFACT_DIR"/. "$output_dir/ClassroomPath/ClassroomPath"/
    exit 0
  fi
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`,
      'utf8'
    );
    chmodSync(fakeGhPath, 0o755);

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

      const bundle = await runReleaseEvidenceBundle({
        repo: 'balejosg/ClassroomPath',
        deployRun: 'deploy-456',
        tag: 'v1.2.99',
        outputDir,
        productionUrl: 'https://classroompath.example.invalid',
        windowsCanaryRun: null,
        linuxCanaryRun: null,
      });

      assert.equal(bundle.artifactIntegrity.preproductionWindowsBootstrapCanary.status, 'ok');
      assert.equal(bundle.artifactIntegrity.linuxProductionBootstrapCanary.status, 'ok');
      assert.match(
        bundle.canaries.windows.artifactPath,
        /ClassroomPath\/ClassroomPath\/production-windows-ajax-auto-allow-canary\.json/
      );
      assert.match(readFileSync(ghLogPath, 'utf8'), /run download deploy-456/);
    } finally {
      process.chdir(originalCwd);
      process.env.PATH = originalPath;
      process.env.TEST_WINDOWS_ARTIFACT_DIR = originalWindowsArtifactDir;
      process.env.TEST_LINUX_ARTIFACT_DIR = originalLinuxArtifactDir;
      globalThis.fetch = originalFetch;
    }
  });

  test('accepts the legacy Windows production artifact as preproduction evidence', async () => {
    const workspace = createTempDir('classroompath-release-evidence-legacy-workspace-');
    const fakeBinDir = createTempDir('classroompath-release-evidence-legacy-bin-');
    const windowsSourceDir = createTempDir('classroompath-release-evidence-legacy-windows-');
    const outputDir = resolve(workspace, 'bundle-output');
    const fakeGhPath = resolve(fakeBinDir, 'gh');
    const ghLogPath = resolve(workspace, 'gh.log');
    const baseEvidence = buildReleaseEvidenceInput();

    writeWindowsCanaryArtifact(windowsSourceDir);
    writeJson(
      resolve(workspace, 'release-evidence.json'),
      buildReleaseEvidenceInput({
        jobs: {
          ...baseEvidence.jobs,
          linuxProductionBootstrapCanary: 'not_run_preproduction_authoritative',
        },
      })
    );

    writeFileSync(
      fakeGhPath,
      `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "${ghLogPath}"
if [ "$1" = "api" ]; then
  case "$2" in
    *"/runs/deploy-legacy/artifacts")
      printf '%s\\n' '{"artifacts":[{"name":"windows-production-bootstrap-canary"}]}'
      exit 0
      ;;
  esac
fi
if [ "$1" = "run" ] && [ "$2" = "download" ] && [ "$3" = "deploy-legacy" ]; then
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
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`,
      'utf8'
    );
    chmodSync(fakeGhPath, 0o755);

    const originalCwd = process.cwd();
    const originalPath = process.env.PATH;
    const originalWindowsArtifactDir = process.env.TEST_WINDOWS_ARTIFACT_DIR;
    const originalFetch = globalThis.fetch;

    try {
      process.chdir(workspace);
      process.env.PATH = `${fakeBinDir}:${originalPath ?? ''}`;
      process.env.TEST_WINDOWS_ARTIFACT_DIR = windowsSourceDir;
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

      const bundle = await runReleaseEvidenceBundle({
        repo: 'balejosg/ClassroomPath',
        deployRun: 'deploy-legacy',
        tag: 'v1.2.99',
        outputDir,
        productionUrl: 'https://classroompath.example.invalid',
        windowsCanaryRun: null,
        linuxCanaryRun: null,
      });

      assert.equal(bundle.artifactIntegrity.preproductionWindowsBootstrapCanary.status, 'ok');
      assert.match(readFileSync(ghLogPath, 'utf8'), /--name windows-production-bootstrap-canary/);
    } finally {
      process.chdir(originalCwd);
      process.env.PATH = originalPath;
      process.env.TEST_WINDOWS_ARTIFACT_DIR = originalWindowsArtifactDir;
      globalThis.fetch = originalFetch;
    }
  });

  test('collects Linux canary evidence artifact when the functional canary failed', () => {
    const linuxArtifactDir = createTempDir('classroompath-release-evidence-linux-failure-');
    const outputDir = createTempDir('classroompath-release-evidence-linux-failure-output-');

    writeJson(resolve(linuxArtifactDir, 'production-linux-ajax-auto-allow-canary.json'), {
      success: false,
      failureBoundary: {
        id: 'linux-install-openpath',
        message: 'Linux install-openpath failed before explicit AJAX/page-resource verification.',
      },
      diagnosticPhases: [
        { id: 'linux-install-openpath', status: 'failed' },
        { id: 'artifact-written', status: 'passed' },
      ],
    });

    const bundle = buildReleaseEvidenceBundle({
      releaseEvidence: buildReleaseEvidenceInput({
        jobs: {
          verifyOpenPathUpstream: 'success',
          resolveReleaseImages: 'success',
          verifyStagingReleaseState: 'success',
          windowsFirefoxCanary: 'success',
          preproductionWindowsBootstrapCanary: 'success',
          windowsProductionBootstrapCanary: null,
          linuxProductionBootstrapCanary: 'failure',
          productionClientUpdateCanary: 'live-tested',
          deployProduction: 'success',
          smokeTestProduction: 'success',
          rollbackProduction: 'skipped',
        },
        diagnostics: {
          windowsProductionBootstrapFailureBoundary: {
            id: 'none',
            message:
              'Windows page-resource observation completed without automatic rule creation and explicit allowlist probes succeeded.',
          },
          linuxProductionBootstrapFailureBoundary: {
            id: 'linux-install-openpath',
            message:
              'Linux install-openpath failed before explicit AJAX/page-resource verification.',
          },
        },
      }),
      productionHealth: {
        checkedAt: '2026-04-30T10:05:00.000Z',
        productionUrl: 'https://classroompath.example.invalid',
        health: { status: 'ok' },
        ready: { ready: true },
      },
      outputDir,
      linuxProductionBootstrapCanary: {
        listed: true,
        artifactDir: linuxArtifactDir,
      },
    });

    assert.equal(bundle.jobs.linuxProductionBootstrapCanary, 'failure');
    assert.equal(bundle.artifactIntegrity.linuxProductionBootstrapCanary.status, 'ok');
    assert.equal(bundle.canaries.linux.failureBoundary.id, 'linux-install-openpath');
    assert.ok(existsSync(resolve(outputDir, 'canary-evidence/linux-production-bootstrap.json')));
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
  printf '%s\n' '{"artifacts":[{"name":"preproduction-windows-bootstrap-canary"},{"name":"linux-production-bootstrap-canary"}]}'
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
  if [ "$artifact_name" = "preproduction-windows-bootstrap-canary" ]; then
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
          staging: { publicUrl: 'https://staging.classroompath.example.invalid' },
          production: { publicUrl: 'https://classroompath.example.invalid' },
        },
      }),
      productionHealth: {
        checkedAt: '2026-04-30T10:05:00.000Z',
        productionUrl: 'https://classroompath.example.invalid',
        health: { status: 'ok' },
        ready: { ready: true },
      },
      outputDir: bundleOutputDir,
      preproductionWindowsBootstrapCanary: {
        listed: true,
        artifactDir: windowsSourceDir,
      },
      linuxProductionBootstrapCanary: {
        listed: true,
        artifactDir: linuxSourceDir,
      },
    });

    assert.equal(bundle.artifactIntegrity.preproductionWindowsBootstrapCanary.status, 'missing');
    assert.equal(bundle.artifactIntegrity.linuxProductionBootstrapCanary.status, 'ok');
    assert.equal(bundle.canaries.linux.targetSha, 'cp-sha');
    assert.equal(bundle.canaries.linux.targetTag, 'v1.2.99');
    assert.equal(bundle.canaries.linux.targetUrl, 'https://classroompath.example.invalid');
    assert.match(
      bundle.canaries.linux.artifactPath,
      /production-linux-ajax-auto-allow-canary\.json/
    );
    assert.equal(
      JSON.parse(readFileSync(resolve(bundleOutputDir, 'artifact-integrity.json'), 'utf8'))
        .preproductionWindowsBootstrapCanary.status,
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
          productionUrl: 'https://classroompath.example.invalid',
          windowsCanaryRun: null,
          linuxCanaryRun: null,
        }),
        /preproduction-windows-bootstrap-canary.*missing/
      );
      assert.equal(
        JSON.parse(readFileSync(resolve(cliOutputDir, 'artifact-integrity.json'), 'utf8'))
          .preproductionWindowsBootstrapCanary.status,
        'missing'
      );
      assert.equal(
        JSON.parse(readFileSync(resolve(cliOutputDir, 'production-health.json'), 'utf8')).health
          .status,
        'ok'
      );
      assert.equal(
        JSON.parse(readFileSync(resolve(cliOutputDir, 'release-evidence.json'), 'utf8'))
          .artifactIntegrity.preproductionWindowsBootstrapCanary.status,
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

describe('deploy brief module', () => {
  test('formats a passing release into less than 120 Markdown lines', () => {
    const brief = buildDeployBrief({
      releaseEvidence: buildReleaseEvidenceInput(),
      sourceArtifacts: ['release-evidence.json'],
    });
    const markdown = renderDeployBriefMarkdown(brief);

    assert.equal(brief.status, 'pass');
    assert.equal(brief.promotionEligibility, 'eligible');
    assert.equal(brief.failureBoundary.id, 'none');
    assert.equal(brief.nextCommand, 'No action required');
    assert.ok(markdown.split('\n').length < 120);
    assert.match(markdown, /^# Deploy Brief/);
    assert.match(markdown, /Status: pass/);
    assert.match(markdown, /\| Gate \| Result \| Boundary \| Evidence \|/);
  });

  test('accepts staging Windows bootstrap evidence when prepromotion rehearsal is unset', () => {
    const brief = buildDeployBrief({
      releaseEvidence: buildReleaseEvidenceInput({
        stagingVerification: {
          windowsFirefoxHighRisk: 'true',
          windowsBootstrapResult: 'success',
          firefoxPolicyResult: 'success',
          prepromotionRehearsalResult: null,
        },
      }),
      sourceArtifacts: ['release-evidence.json'],
    });

    const preproductionGate = brief.gates.find(
      (gate) => gate.id === 'preproduction-installed-client-evidence'
    );

    assert.equal(preproductionGate?.result, 'success');
    assert.equal(preproductionGate?.boundary, 'none');
    assert.equal(brief.status, 'pass');
  });

  test('formats failed preproduction installed-client evidence with boundary and next action', () => {
    const brief = buildDeployBrief({
      releaseEvidence: buildReleaseEvidenceInput({
        jobs: {
          verifyOpenPathUpstream: 'success',
          resolveReleaseImages: 'success',
          verifyStagingReleaseState: 'failure',
          windowsFirefoxCanary: 'success',
          windowsProductionBootstrapCanary: 'not_run_preproduction_authoritative',
          linuxProductionBootstrapCanary: 'not_run_preproduction_authoritative',
          productionClientUpdateCanary: 'live-tested',
          deployProduction: 'success',
          smokeTestProduction: 'success',
          rollbackProduction: 'skipped',
        },
        stagingVerification: {
          windowsFirefoxHighRisk: 'true',
          prepromotionRehearsalResult: 'failed',
        },
      }),
      sourceArtifacts: ['release-evidence.json'],
    });

    assert.equal(brief.status, 'fail');
    assert.equal(brief.failureBoundary.id, 'preproduction-installed-client-evidence');
    assert.equal(
      brief.failureBoundary.message,
      'Preproduction installed-client evidence failed before production promotion.'
    );
    assert.equal(brief.failureBoundary.safeToRetry, 'after-cleanup');
    assert.match(brief.nextCommand, /gh run rerun 123 --failed/);
  });

  test('formats missing artifact as unknown with no crash', () => {
    const brief = buildDeployBrief({
      releaseEvidence: null,
      sourceArtifacts: [{ path: 'missing-release-evidence.json', status: 'missing' }],
    });
    const markdown = renderDeployBriefMarkdown(brief);

    assert.equal(brief.status, 'unknown');
    assert.equal(brief.failureBoundary.id, 'unknown');
    assert.equal(brief.failureBoundary.safeToRetry, 'unknown');
    assert.match(markdown, /Status: unknown/);
    assert.match(markdown, /missing-release-evidence\.json/);
  });

  test('preserves advisory versus post-release canary distinction', () => {
    const brief = buildDeployBrief({
      releaseEvidence: buildReleaseEvidenceInput({
        jobs: {
          verifyOpenPathUpstream: 'success',
          resolveReleaseImages: 'success',
          verifyStagingReleaseState: 'success',
          windowsFirefoxCanary: 'failure',
          preproductionWindowsBootstrapCanary: 'success',
          windowsProductionBootstrapCanary: null,
          linuxProductionBootstrapCanary: 'skipped',
          productionClientUpdateCanary: 'advisory-only',
          deployProduction: 'success',
          smokeTestProduction: 'success',
          rollbackProduction: 'skipped',
        },
      }),
      sourceArtifacts: ['release-evidence.json'],
    });

    const advisoryGate = brief.gates.find((gate) => gate.id === 'windows-firefox-canary');
    const postReleaseGate = brief.gates.find(
      (gate) => gate.id === 'windows-production-bootstrap-canary'
    );
    const clientUpdateGate = brief.gates.find(
      (gate) => gate.id === 'production-client-update-canary'
    );

    assert.equal(brief.status, 'partial');
    assert.equal(advisoryGate?.category, 'advisory');
    assert.equal(postReleaseGate?.category, 'post-release-advisory');
    assert.equal(clientUpdateGate?.category, 'post-release-advisory');
  });
});
