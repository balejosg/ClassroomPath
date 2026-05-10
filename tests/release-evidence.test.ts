import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runProjectCommand } from './helpers/ops-contracts.ts';
import { buildDeployBrief, renderDeployBriefMarkdown } from '../scripts/lib/deploy-brief.mjs';
import { renderCanaryBoundarySummary } from '../scripts/lib/release-evidence.mjs';
import {
  PROMOTION_ELIGIBILITY_POLICY,
  RELEASE_JOB_RESULT_POLICY,
  buildReleaseTimingEvidence,
  createReleaseEvidenceSnapshot,
  deriveAdvisoryCanaryResult,
  derivePostReleaseCanaryResult,
  deriveProductionBootstrapCanaryResult,
  derivePromotionEligibility,
  deriveReleaseOutcome,
  includesArtifactEvidence,
  projectReleaseEvidenceSnapshotToWorkflowOutputs,
  serializeReleaseEvidenceSnapshot,
  validateReleaseEvidenceSnapshot,
} from '../scripts/lib/release-evidence-snapshot.mjs';
import {
  RELEASE_EVIDENCE_CANARY_ARTIFACTS,
  collectProductionPromotionDryRunFailures,
  evaluateCanaryArtifactIntegrity,
  shouldRequireCanaryArtifact,
  validateReleaseEvidenceChecklist,
  verifyArtifactIntegrity,
} from '../scripts/lib/release-evidence-contract.mjs';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');
const scriptPath = resolve(projectRoot, 'scripts/write-release-evidence.mjs');
const evidenceBundleScriptPath = resolve(projectRoot, 'scripts/release-evidence-bundle.mjs');
const deployBriefScriptPath = resolve(projectRoot, 'scripts/deploy-brief.mjs');
const promotionDryValidateScriptPath = resolve(
  projectRoot,
  'scripts/production-promotion-dry-validate.mjs'
);
const evidenceHelperPath = resolve(projectRoot, 'scripts/lib/release-evidence.mjs');
const evidenceSnapshotHelperPath = resolve(
  projectRoot,
  'scripts/lib/release-evidence-snapshot.mjs'
);

type ReleaseEvidence = {
  release: {
    outcome: string;
  };
  promotionEligibility: {
    status: string;
    deploymentMode: string | null;
  };
  jobs: {
    windowsFirefoxCanary: string;
    windowsProductionBootstrapCanary: string;
    productionClientUpdateCanary: string;
  };
  diagnostics: {
    windowsProductionBootstrapFailureBoundary: {
      id: string | null;
      message: string | null;
    };
  };
  artifacts: {
    windowsProductionBootstrapCanary: string | null;
    linuxProductionBootstrapCanary?: string | null;
  };
  artifactIntegrity?: {
    windowsProductionBootstrapCanary?: {
      status: string;
    };
    linuxProductionBootstrapCanary?: {
      status: string;
    };
  };
  stagingVerification: {
    windowsFirefoxHighRisk: string;
    windowsBootstrapResult: string | null;
    firefoxPolicyResult: string | null;
  };
};

function generateEvidence(envOverrides: Record<string, string | undefined>) {
  const outputDir = mkdtempSync(resolve(tmpdir(), 'classroompath-release-evidence-'));

  try {
    const result = runProjectCommand(process.execPath, [scriptPath], {
      cwd: outputDir,
      env: {
        GITHUB_REPOSITORY: 'balejosg/ClassroomPath',
        GITHUB_RUN_ID: '123456789',
        GITHUB_SERVER_URL: 'https://github.com',
        TAG_NAME: 'v1.2.99',
        APP_SHA: 'cp-sha',
        OPENPATH_SHA: 'op-sha',
        VERIFY_OPENPATH_RESULT: 'success',
        RESOLVE_IMAGES_RESULT: 'success',
        VERIFY_STAGING_RESULT: 'success',
        STAGING_SMOKE_RESULT: 'success',
        STAGING_SMOKE_STATUS: 'PASS',
        STAGING_RELEASE_GATE_RESULT: 'success',
        STAGING_ENROLLMENT_DOWNLOAD_RESULT: 'success',
        STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT: 'success',
        STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT: 'success',
        STAGING_VERIFIED_AT: '2026-03-27T10:00:00Z',
        DEPLOY_RESULT: 'success',
        PRODUCTION_SMOKE_RESULT: 'success',
        ROLLBACK_RESULT: 'skipped',
        ...envOverrides,
      },
    });
    assert.equal(result.status, 0, result.stderr);

    return {
      json: JSON.parse(
        readFileSync(resolve(outputDir, 'release-evidence.json'), 'utf8')
      ) as ReleaseEvidence,
      markdown: readFileSync(resolve(outputDir, 'release-evidence.md'), 'utf8'),
    };
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function generateEvidenceFromInputFile(input: Record<string, string | undefined>) {
  const outputDir = mkdtempSync(resolve(tmpdir(), 'classroompath-release-evidence-input-'));
  const inputPath = resolve(outputDir, 'release-evidence-input.json');

  try {
    writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`, 'utf8');

    const result = runProjectCommand(process.execPath, [scriptPath], {
      cwd: outputDir,
      env: {
        RELEASE_EVIDENCE_INPUT_PATH: inputPath,
      },
    });
    assert.equal(result.status, 0, result.stderr);

    return {
      json: JSON.parse(
        readFileSync(resolve(outputDir, 'release-evidence.json'), 'utf8')
      ) as ReleaseEvidence,
      markdown: readFileSync(resolve(outputDir, 'release-evidence.md'), 'utf8'),
    };
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

function buildContractEvidence() {
  return {
    release: {
      outcome: 'released',
      tagName: 'v1.2.99',
      classroomPathSha: 'cp-sha',
      openPathSha: 'op-sha',
    },
    jobs: {
      windowsProductionBootstrapCanary: 'success',
      linuxProductionBootstrapCanary: 'success',
    },
    stagingVerification: {
      smokeResult: 'success',
      smokeStatus: 'PASS',
      releaseGateResult: 'success',
      windowsFirefoxHighRisk: 'true',
      verifiedAt: '2026-04-30T09:59:00.000Z',
    },
    targets: {
      staging: {
        publicUrl: 'http://192.168.1.114:3000',
      },
      production: {
        publicUrl: 'https://classroompath.eu',
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
      windowsProductionBootstrapCanary: RELEASE_EVIDENCE_CANARY_ARTIFACTS.windows.artifactName,
      linuxProductionBootstrapCanary: RELEASE_EVIDENCE_CANARY_ARTIFACTS.linux.artifactName,
      releaseEvidence: 'release-evidence-v1.2.99',
    },
  };
}

describe('release evidence contract', () => {
  test('centralizes checklist fields and canary artifact names', () => {
    const complete = validateReleaseEvidenceChecklist(buildContractEvidence());
    assert.equal(complete.ok, true);
    assert.equal(
      RELEASE_EVIDENCE_CANARY_ARTIFACTS.windows.artifactName,
      'windows-production-bootstrap-canary'
    );
    assert.equal(
      RELEASE_EVIDENCE_CANARY_ARTIFACTS.linux.artifactName,
      'linux-production-bootstrap-canary'
    );

    const missing = buildContractEvidence();
    missing.release.classroomPathSha = '';
    missing.artifacts.releaseEvidence = '';

    const result = validateReleaseEvidenceChecklist(missing);
    assert.equal(result.ok, false);
    assert.ok(result.failures.includes('release.classroomPathSha missing'));
    assert.ok(result.failures.includes('artifacts.releaseEvidence missing'));
  });

  test('keeps canary artifact applicability tied to high-risk release evidence', () => {
    const lowRisk = buildContractEvidence();
    lowRisk.stagingVerification.windowsFirefoxHighRisk = 'false';

    const lowRiskIntegrity = verifyArtifactIntegrity({ releaseEvidence: lowRisk });
    assert.equal(lowRiskIntegrity.windowsProductionBootstrapCanary.status, 'not_applicable');
    assert.equal(lowRiskIntegrity.linuxProductionBootstrapCanary.status, 'not_applicable');

    const pending = buildContractEvidence();
    pending.jobs.windowsProductionBootstrapCanary = 'pending-post-release';
    pending.jobs.linuxProductionBootstrapCanary = 'pending-post-release';

    const pendingIntegrity = verifyArtifactIntegrity({ releaseEvidence: pending });
    assert.equal(pendingIntegrity.windowsProductionBootstrapCanary.status, 'not_applicable');
    assert.equal(pendingIntegrity.linuxProductionBootstrapCanary.status, 'not_applicable');

    const missing = verifyArtifactIntegrity({ releaseEvidence: buildContractEvidence() });
    assert.equal(missing.windowsProductionBootstrapCanary.status, 'missing');
    assert.equal(missing.linuxProductionBootstrapCanary.status, 'missing');
  });

  test('exposes canary artifact integrity as a named policy boundary', () => {
    assert.equal(shouldRequireCanaryArtifact({ highRisk: false, result: 'success' }), false);
    assert.equal(shouldRequireCanaryArtifact({ highRisk: true, result: 'pending' }), false);
    assert.equal(shouldRequireCanaryArtifact({ highRisk: true, result: 'failed' }), true);

    const integrity = evaluateCanaryArtifactIntegrity({
      highRisk: true,
      result: 'failed',
      listed: false,
      artifactDir: null,
      downloadError: false,
      parser: () => {
        throw new Error('should not parse missing artifacts');
      },
    });

    assert.equal(integrity.status, 'missing');
  });

  test('collects production promotion dry-run comparisons through the contract', () => {
    const validation = collectProductionPromotionDryRunFailures({
      releaseEvidence: buildContractEvidence(),
      expectedClassroomSha: 'other-cp-sha',
      expectedOpenPathSha: 'op-sha',
      tag: 'v1.2.99',
    });

    assert.equal(validation.ok, false);
    assert.ok(
      validation.failures.includes(
        'release.classroomPathSha expected other-cp-sha but found cp-sha'
      )
    );
    assert.ok(validation.failures.includes('windowsProductionBootstrapCanary missing'));
    assert.ok(validation.failures.includes('linuxProductionBootstrapCanary missing'));
  });
});

describe('release evidence rendering', () => {
  test('names snapshot policy boundaries without changing release evidence shape', () => {
    assert.equal(PROMOTION_ELIGIBILITY_POLICY.requiredDeploymentMode, 'promotion-eligible');
    assert.equal(PROMOTION_ELIGIBILITY_POLICY.requiredImageSource, 'release-candidate');
    assert.deepEqual(RELEASE_JOB_RESULT_POLICY.evidenceBearingResults, [
      'success',
      'failure',
      'failed',
    ]);

    assert.equal(
      deriveAdvisoryCanaryResult({ highRisk: false, canaryResult: 'success' }),
      'not_applicable'
    );
    assert.equal(deriveAdvisoryCanaryResult({ highRisk: true, canaryResult: '' }), 'not_run');
    assert.equal(
      derivePostReleaseCanaryResult({ highRisk: true, canaryResult: 'success' }),
      'live-tested'
    );
    assert.equal(
      derivePostReleaseCanaryResult({ highRisk: true, canaryResult: 'failure' }),
      'failed'
    );
    assert.equal(
      derivePostReleaseCanaryResult({ highRisk: true, canaryResult: 'toString' }),
      'toString'
    );
    assert.equal(
      deriveProductionBootstrapCanaryResult({
        highRisk: true,
        canaryResult: 'success',
        jobResult: 'failure',
      }),
      'failure'
    );
    assert.equal(includesArtifactEvidence('failed'), true);
    assert.equal(includesArtifactEvidence('pending-post-release'), false);
    assert.equal(
      deriveReleaseOutcome({
        deployResult: 'success',
        smokeResult: 'failure',
        rollbackResult: 'success',
      }),
      'rolled_back_after_failed_smoke'
    );
    assert.deepEqual(derivePromotionEligibility({ PROMOTION_ELIGIBLE: 'true' }), {
      status: 'eligible',
      deploymentMode: null,
    });
  });

  test('builds release timing evidence through the named timing policy', () => {
    const timing = buildReleaseTimingEvidence({
      totals: { wallSeconds: 505 },
      criticalPath: {
        jobs: [{ name: 'Deploy to Production' }, { name: 'Release Evidence' }],
      },
      jobs: [
        { name: 'Deploy to Production', executionSeconds: 88 },
        { name: 'Linux Production Bootstrap Canary', executionSeconds: 321 },
        { name: 'Ignored Job', executionSeconds: 999 },
      ],
    });

    assert.equal(timing.totalWallSeconds, 505);
    assert.deepEqual(timing.criticalPath?.jobs, [
      { name: 'Deploy to Production' },
      { name: 'Release Evidence' },
    ]);
    assert.deepEqual(timing.jobs.deployProduction, { durationMs: 88000 });
    assert.deepEqual(timing.jobs.linuxProductionBootstrapCanary, { durationMs: 321000 });
    assert.equal(timing.jobs.ignoredJob, undefined);
  });

  test('release evidence module owns the promotion readiness interface', async () => {
    const releaseEvidence = await import('../scripts/lib/release-evidence.mjs');

    assert.equal(typeof releaseEvidence.evaluatePromotionEligibility, 'function');
    assert.equal(typeof releaseEvidence.buildPromotionEligibilityOutputs, 'function');
  });

  test('release evidence snapshot module creates validates serializes and projects evidence', () => {
    const snapshot = createReleaseEvidenceSnapshot({
      GITHUB_REPOSITORY: 'balejosg/ClassroomPath',
      GITHUB_RUN_ID: '123456789',
      GITHUB_SERVER_URL: 'https://github.com',
      TAG_NAME: 'v1.2.99',
      APP_SHA: 'cp-sha',
      OPENPATH_SHA: 'op-sha',
      VERIFY_STAGING_RESULT: 'success',
      STAGING_SMOKE_RESULT: 'success',
      STAGING_RELEASE_GATE_RESULT: 'success',
      STAGING_ENROLLMENT_DOWNLOAD_RESULT: 'success',
      STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT: 'success',
      STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT: 'success',
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      DEPLOY_RESULT: 'success',
      PRODUCTION_SMOKE_RESULT: 'success',
      ROLLBACK_RESULT: 'skipped',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT: 'success',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT: 'success',
    });

    assert.equal(snapshot.release.outcome, 'released');
    assert.equal(snapshot.jobs.windowsProductionBootstrapCanary, 'success');
    assert.equal(validateReleaseEvidenceSnapshot(snapshot).ok, true);

    const serialized = serializeReleaseEvidenceSnapshot(snapshot);
    assert.equal(JSON.parse(serialized).release.classroomPathSha, 'cp-sha');

    assert.deepEqual(projectReleaseEvidenceSnapshotToWorkflowOutputs(snapshot), {
      release_outcome: 'released',
      release_tag_name: 'v1.2.99',
      release_classroompath_sha: 'cp-sha',
      release_openpath_sha: 'op-sha',
      release_promotion_eligibility: 'eligible',
      release_promotion_deployment_mode: 'promotion-eligible',
    });
  });

  test('release evidence renders compact canary failure boundary summary', () => {
    const summary = renderCanaryBoundarySummary({
      linux: {
        result: 'failure',
        boundaryId: 'linux-install-openpath',
        message: 'Linux enrollment script failed before AJAX canary.',
      },
      windows: {
        result: 'success',
        boundaryId: 'none',
        message:
          'Windows page-resource observation completed without automatic rule creation and explicit allowlist probes succeeded.',
      },
    });

    assert.match(summary, /## Release Canary Boundary/);
    assert.match(summary, /Linux bootstrap\/AJAX/);
    assert.match(summary, /linux-install-openpath/);
    assert.match(
      summary,
      /Windows page-resource observation completed without automatic rule creation and explicit allowlist probes succeeded\./
    );
    assert.doesNotMatch(summary, /Bearer|token|secret/i);
  });

  test('release evidence boundary summary renders unknowns and redacts credentials', () => {
    const summary = renderCanaryBoundarySummary({
      linux: {
        message: 'failed with Bearer abc123 and token=secret-value\nsecond line',
      },
    });

    assert.match(summary, /\| Linux bootstrap\/AJAX \| unknown \| unknown \|/);
    assert.match(summary, /Bearer \[redacted\]/);
    assert.match(summary, /token=\[redacted\]/);
    assert.doesNotMatch(summary, /abc123|secret-value|second line\n/);
  });

  test('release evidence bundle CLI is exposed for incident handoffs', () => {
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    assert.ok(existsSync(evidenceBundleScriptPath));
    assert.equal(
      packageJson.scripts?.['release:evidence-bundle'],
      'node scripts/release-evidence-bundle.mjs'
    );
    assert.equal(packageJson.scripts?.['ops:deploy-brief'], 'node scripts/deploy-brief.mjs');
    assert.equal(
      packageJson.scripts?.['verify:production-promotion-dry'],
      'node scripts/production-promotion-dry-validate.mjs'
    );

    const result = runProjectCommand(process.execPath, [evidenceBundleScriptPath, '--help']);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: npm run release:evidence-bundle --/);
    assert.match(result.stdout, /--deploy-run <id>/);
    assert.match(result.stdout, /--tag <vX\.Y\.Z>/);
    assert.match(result.stdout, /--canary-run <id>/);
    assert.match(result.stdout, /--windows-canary-run <id>/);
    assert.match(result.stdout, /--linux-canary-run <id>/);
    assert.match(result.stdout, /artifact-integrity\.json/);
    assert.match(result.stdout, /canary-evidence\/windows-production-bootstrap\.json/);
    assert.match(result.stdout, /production-health\.json/);

    const dryResult = runProjectCommand(process.execPath, [
      promotionDryValidateScriptPath,
      '--help',
    ]);

    assert.equal(dryResult.status, 0, dryResult.stderr);
    assert.match(dryResult.stdout, /verify:production-promotion-dry/);
    assert.match(dryResult.stdout, /--release-evidence <path>/);
    assert.match(dryResult.stdout, /without deploying, tagging, or reading production/);

    const deployBriefResult = runProjectCommand(process.execPath, [
      deployBriefScriptPath,
      '--help',
    ]);

    assert.equal(deployBriefResult.status, 0, deployBriefResult.stderr);
    assert.match(deployBriefResult.stdout, /ops:deploy-brief/);
    assert.match(deployBriefResult.stdout, /--run <github-run-id>/);
    assert.match(deployBriefResult.stdout, /--release-evidence <path>/);
    assert.match(deployBriefResult.stdout, /deploy-brief\.json/);
  });

  test('release evidence rendering is delegated to the typed helper module', () => {
    const wrapper = readFileSync(scriptPath, 'utf8');
    const helper = readFileSync(evidenceHelperPath, 'utf8');
    const snapshotHelper = readFileSync(evidenceSnapshotHelperPath, 'utf8');

    assert.match(wrapper, /from '\.\/lib\/release-evidence\.mjs'/);
    assert.match(helper, /from '\.\/release-evidence-snapshot\.mjs'/);
    assert.match(helper, /export function buildReleaseEvidence/);
    assert.match(helper, /export function renderReleaseEvidenceMarkdown/);
    assert.match(snapshotHelper, /export function createReleaseEvidenceSnapshot/);
    assert.match(snapshotHelper, /export function serializeReleaseEvidenceSnapshot/);
    assert.match(snapshotHelper, /export function validateReleaseEvidenceSnapshot/);
    assert.match(snapshotHelper, /export function projectReleaseEvidenceSnapshotToWorkflowOutputs/);
  });

  test('release evidence wrapper accepts a single JSON input artifact', () => {
    const { json, markdown } = generateEvidenceFromInputFile({
      GITHUB_REPOSITORY: 'balejosg/ClassroomPath',
      GITHUB_RUN_ID: '123456789',
      GITHUB_SERVER_URL: 'https://github.com',
      TAG_NAME: 'v1.2.99',
      APP_SHA: 'cp-sha',
      OPENPATH_SHA: 'op-sha',
      VERIFY_OPENPATH_RESULT: 'success',
      RESOLVE_IMAGES_RESULT: 'success',
      VERIFY_STAGING_RESULT: 'success',
      STAGING_SMOKE_RESULT: 'success',
      STAGING_SMOKE_STATUS: 'PASS',
      STAGING_RELEASE_GATE_RESULT: 'success',
      STAGING_ENROLLMENT_DOWNLOAD_RESULT: 'success',
      STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT: 'success',
      STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT: 'success',
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      STAGING_VERIFIED_AT: '2026-03-27T10:00:00Z',
      DEPLOY_RESULT: 'success',
      PRODUCTION_SMOKE_RESULT: 'success',
      ROLLBACK_RESULT: 'skipped',
      WINDOWS_FIREFOX_CANARY_RESULT: 'success',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT: 'success',
    });

    assert.equal(json.release.outcome, 'released');
    assert.equal(json.promotionEligibility.status, 'eligible');
    assert.equal(json.promotionEligibility.deploymentMode, 'promotion-eligible');
    assert.equal(json.jobs.windowsFirefoxCanary, 'success');
    assert.equal(json.jobs.windowsProductionBootstrapCanary, 'success');
    assert.match(markdown, /Outcome: `released`/);
    assert.match(markdown, /Promotion eligibility: `eligible`/);
  });

  test('renders bundle artifact integrity and failure boundaries when provided by the bundle module', () => {
    const { json, markdown } = generateEvidenceFromInputFile({
      generatedAt: '2026-04-30T10:00:00.000Z',
      workflowRunUrl: 'https://github.com/balejosg/ClassroomPath/actions/runs/123456789',
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
      diagnostics: {
        windowsProductionBootstrapFailureBoundary: {
          id: 'none',
          message:
            'Windows page-resource observation completed without automatic rule creation and explicit allowlist probes succeeded.',
        },
        linuxProductionBootstrapFailureBoundary: {
          id: 'page-resource-candidates',
          message: 'The Linux page did not emit resource-candidate events for every probe.',
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
        staging: { publicUrl: 'http://192.168.1.114:3000' },
        production: { publicUrl: 'https://classroompath.eu' },
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
      artifactIntegrity: {
        windowsProductionBootstrapCanary: {
          status: 'ok',
        },
        linuxProductionBootstrapCanary: {
          status: 'missing',
        },
      },
      canaries: {
        windows: {
          failureBoundary: {
            id: 'none',
            message:
              'Windows page-resource observation completed without automatic rule creation and explicit allowlist probes succeeded.',
          },
          diagnosticPhases: [{ id: 'artifact-written', status: 'passed' }],
          redditHosts: {
            'emoji.redditmedia.com': {
              globalWhitelist: true,
              nativeWhitelist: true,
              pageEvent: true,
            },
          },
        },
        linux: {
          failureBoundary: {
            id: 'page-resource-candidates',
            message: 'The Linux page did not emit resource-candidate events for every probe.',
          },
          diagnosticPhases: [{ id: 'page-resource-candidates', status: 'failed' }],
        },
      },
      production: {
        health: { status: 'ok' },
        ready: { ready: true },
      },
      timings: {
        totalWallSeconds: 505,
        criticalPath: {
          terminalJob: {
            name: 'Release Evidence',
            queueSeconds: 495,
            executionSeconds: 10,
          },
          longestQueueJob: {
            name: 'Release Evidence',
            queueSeconds: 495,
            executionSeconds: 10,
          },
          longestExecutionJob: {
            name: 'Linux Production Bootstrap Canary',
            queueSeconds: 4,
            executionSeconds: 321,
          },
          jobs: [
            { name: 'Deploy to Production' },
            { name: 'Linux Production Bootstrap Canary' },
            { name: 'Release Evidence' },
          ],
        },
        jobs: {
          deployProduction: { durationMs: 88000 },
          smokeTestProduction: { durationMs: 49000 },
          windowsProductionBootstrapCanary: { durationMs: 195000 },
          linuxProductionBootstrapCanary: { durationMs: 321000 },
          releaseEvidence: { durationMs: 10000 },
        },
      },
    });

    assert.equal(json.artifactIntegrity?.windowsProductionBootstrapCanary?.status, 'ok');
    assert.equal(json.artifactIntegrity?.linuxProductionBootstrapCanary?.status, 'missing');
    assert.ok(
      markdown.indexOf('## Release Dashboard') < markdown.indexOf('## Release Evidence'),
      'dashboard should be the first release-evidence section'
    );
    assert.ok(
      markdown.indexOf('## Release Canary Boundary') < markdown.indexOf('## Release Evidence'),
      'canary boundary summary should be visible before the full release evidence details'
    );
    assert.match(markdown, /\| Tag \| `v1\.2\.99` \|/);
    assert.match(markdown, /\| ClassroomPath SHA \| `cp-sha` \|/);
    assert.match(markdown, /\| OpenPath SHA \| `op-sha` \|/);
    assert.match(
      markdown,
      /\| Linux production bootstrap canary \| failure \| page-resource-candidates \| 5m21s \| linux-production-bootstrap-canary \|/
    );
    assert.match(
      markdown,
      /\| Windows production bootstrap canary \| success \| none \| 3m15s \| windows-production-bootstrap-canary \|/
    );
    assert.match(markdown, /### Release Timing/);
    assert.match(markdown, /Staging-to-production duration: `8m25s`/);
    assert.match(markdown, /Top queue blocker: `Release Evidence` \(`8m15s`\)/);
    assert.match(
      markdown,
      /Top execution blocker: `Linux Production Bootstrap Canary` \(`5m21s`\)/
    );
    assert.match(
      markdown,
      /Critical path: `Deploy to Production -> Linux Production Bootstrap Canary -> Release Evidence`/
    );
    assert.match(markdown, /Windows canary artifact integrity: `ok`/);
    assert.match(markdown, /Linux canary artifact integrity: `missing`/);
    assert.match(
      markdown,
      /\| Linux bootstrap\/AJAX \| failure \| page-resource-candidates \| The Linux page did not emit resource-candidate events for every probe\. \|/
    );
    assert.match(
      markdown,
      /\| Windows bootstrap\/AJAX \| success \| none \| Windows page-resource observation completed without automatic rule creation and explicit allowlist probes succeeded\. \|/
    );
    assert.match(markdown, /Windows bootstrap failure boundary: `none`/);
    assert.match(markdown, /Linux bootstrap failure boundary: `page-resource-candidates`/);
  });

  test('deploy brief renders compact bottleneck and critical path timing', () => {
    const brief = buildDeployBrief({
      releaseEvidence: {
        release: {
          tagName: 'v1.2.99',
          classroomPathSha: 'cp-sha',
          openPathSha: 'op-sha',
        },
        promotionEligibility: {
          status: 'eligible',
        },
        jobs: {
          verifyOpenPathUpstream: 'success',
          resolveReleaseImages: 'success',
          verifyStagingReleaseState: 'success',
          deployProduction: 'success',
          smokeTestProduction: 'success',
        },
        artifacts: {
          releaseImageMetadata: 'release-image-metadata-v1.2.99',
          stagingReleaseState: 'staging-release-state-v1.2.99',
          productionSmokeResults: 'smoke-test-results-production',
          releaseEvidence: 'release-evidence-v1.2.99',
        },
        timings: {
          totalWallSeconds: 505,
          criticalPath: {
            longestQueueJob: {
              name: 'Release Evidence',
              queueSeconds: 495,
              executionSeconds: 10,
            },
            longestExecutionJob: {
              name: 'Linux Production Bootstrap Canary',
              queueSeconds: 4,
              executionSeconds: 321,
            },
            jobs: [
              { name: 'Deploy to Production' },
              { name: 'Linux Production Bootstrap Canary' },
              { name: 'Release Evidence' },
            ],
          },
        },
      },
    });

    const markdown = renderDeployBriefMarkdown(brief);

    assert.match(markdown, /## Bottleneck Summary/);
    assert.match(markdown, /Staging-to-production duration: 8m25s/);
    assert.match(markdown, /Top queue blocker: Release Evidence \(8m15s\)/);
    assert.match(markdown, /Top execution blocker: Linux Production Bootstrap Canary \(5m21s\)/);
    assert.match(
      markdown,
      /Critical path: Deploy to Production -> Linux Production Bootstrap Canary -> Release Evidence/
    );
  });

  test('renders advisory canary success for high-risk promotions', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      PROMOTION_ELIGIBLE: 'true',
      PROMOTION_DEPLOYMENT_MODE: 'promotion-eligible',
      STAGING_WINDOWS_BOOTSTRAP_RESULT: 'success',
      STAGING_FIREFOX_POLICY_RESULT: 'success',
      STAGING_LINUX_BOOTSTRAP_RESULT: 'success',
      STAGING_LINUX_BOOTSTRAP_RUN_ID: '123456',
      STAGING_LINUX_BOOTSTRAP_FAILURE_BOUNDARY_ID: 'none',
      WINDOWS_FIREFOX_CANARY_RESULT: 'success',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT: 'success',
      PRODUCTION_CLIENT_UPDATE_CANARY_RESULT: 'success',
    });

    assert.equal(json.jobs.windowsFirefoxCanary, 'success');
    assert.equal(json.jobs.windowsProductionBootstrapCanary, 'success');
    assert.equal(json.jobs.productionClientUpdateCanary, 'live-tested');
    assert.equal(json.promotionEligibility.status, 'eligible');
    assert.equal(json.stagingVerification.windowsFirefoxHighRisk, 'true');
    assert.equal(json.stagingVerification.windowsBootstrapResult, 'success');
    assert.equal(json.stagingVerification.firefoxPolicyResult, 'success');
    assert.equal(json.stagingVerification.linuxBootstrapResult, 'success');
    assert.equal(json.stagingVerification.linuxBootstrapRunId, '123456');
    assert.match(markdown, /\| Windows\/Firefox canary \(advisory\) \| success \|/);
    assert.match(markdown, /\| Windows production bootstrap canary \| success \|/);
    assert.match(markdown, /\| Production client update canary \(post-release\) \| live-tested \|/);
    assert.match(markdown, /Windows\/Firefox high risk: `true`/);
    assert.match(markdown, /Linux bootstrap result: `success`/);
  });

  test('keeps a failed advisory canary visible without changing release outcome', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      PROMOTION_ELIGIBLE: 'false',
      PROMOTION_DEPLOYMENT_MODE: 'debug',
      STAGING_WINDOWS_BOOTSTRAP_RESULT: 'success',
      STAGING_FIREFOX_POLICY_RESULT: 'success',
      WINDOWS_FIREFOX_CANARY_RESULT: 'failure',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT: 'failure',
    });

    assert.equal(json.release.outcome, 'released');
    assert.equal(json.promotionEligibility.status, 'ineligible');
    assert.equal(json.jobs.windowsFirefoxCanary, 'failure');
    assert.equal(json.jobs.windowsProductionBootstrapCanary, 'failure');
    assert.match(markdown, /\| Windows\/Firefox canary \(advisory\) \| failure \|/);
    assert.match(markdown, /\| Windows production bootstrap canary \| failure \|/);
    assert.match(markdown, /Promotion eligibility: `ineligible`/);
  });

  test('marks deploy-time post-release client update canary evidence as pending without inventing endpoint evidence', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
    });

    assert.equal(json.release.outcome, 'released');
    assert.equal(json.jobs.windowsProductionBootstrapCanary, 'pending-post-release');
    assert.equal(json.jobs.productionClientUpdateCanary, 'pending-post-release');
    assert.match(markdown, /Outcome: `released`/);
    assert.match(markdown, /\| Windows production bootstrap canary \| pending-post-release \|/);
    assert.match(
      markdown,
      /\| Production client update canary \(post-release\) \| pending-post-release \|/
    );
  });

  test('marks the advisory canary as not applicable for low-risk promotions', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'false',
    });

    assert.equal(json.jobs.windowsFirefoxCanary, 'not_applicable');
    assert.equal(json.jobs.windowsProductionBootstrapCanary, 'not_applicable');
    assert.equal(json.jobs.productionClientUpdateCanary, 'not_applicable');
    assert.equal(json.stagingVerification.windowsFirefoxHighRisk, 'false');
    assert.match(markdown, /\| Windows\/Firefox canary \(advisory\) \| not_applicable \|/);
    assert.match(markdown, /\| Windows production bootstrap canary \| not_applicable \|/);
    assert.match(
      markdown,
      /\| Production client update canary \(post-release\) \| not_applicable \|/
    );
  });

  test('keeps a failed post-release client update canary visible without changing the release outcome', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      PRODUCTION_CLIENT_UPDATE_CANARY_RESULT: 'failure',
    });

    assert.equal(json.release.outcome, 'released');
    assert.equal(json.jobs.productionClientUpdateCanary, 'failed');
    assert.match(markdown, /\| Production client update canary \(post-release\) \| failed \|/);
  });

  test('includes production bootstrap canary artifact evidence in release bundle', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT: 'success',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT: 'success',
    });

    assert.equal(json.jobs.windowsProductionBootstrapCanary, 'success');
    assert.equal(
      json.artifacts.windowsProductionBootstrapCanary,
      'windows-production-bootstrap-canary'
    );
    assert.match(
      markdown,
      /Windows production bootstrap canary: `windows-production-bootstrap-canary`/
    );
  });

  test('includes the production bootstrap failure boundary in release evidence', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT: 'failure',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT: 'failure',
      WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_ID: 'explicit-whitelist-apply',
      WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE:
        'Explicit Windows whitelist rules did not converge locally.',
    });

    assert.equal(json.jobs.windowsProductionBootstrapCanary, 'failure');
    assert.deepEqual(json.diagnostics.windowsProductionBootstrapFailureBoundary, {
      id: 'explicit-whitelist-apply',
      message: 'Explicit Windows whitelist rules did not converge locally.',
    });
    assert.equal(
      json.artifacts.windowsProductionBootstrapCanary,
      'windows-production-bootstrap-canary'
    );
    assert.match(markdown, /Windows bootstrap failure boundary: `explicit-whitelist-apply`/);
    assert.match(
      markdown,
      /Windows production bootstrap canary: `windows-production-bootstrap-canary`/
    );
    assert.match(markdown, /Explicit Windows whitelist rules did not converge locally\./);
  });

  test('includes Linux production bootstrap canary artifact and failure boundary evidence', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      LINUX_PRODUCTION_BOOTSTRAP_CANARY_RESULT: 'failure',
      LINUX_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT: 'failure',
      LINUX_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_ID: 'page-resource-candidates',
      LINUX_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE:
        'The Linux page did not emit resource-candidate events for every probe.',
    });

    assert.equal(json.jobs.linuxProductionBootstrapCanary, 'failure');
    assert.deepEqual(json.diagnostics.linuxProductionBootstrapFailureBoundary, {
      id: 'page-resource-candidates',
      message: 'The Linux page did not emit resource-candidate events for every probe.',
    });
    assert.equal(
      json.artifacts.linuxProductionBootstrapCanary,
      'linux-production-bootstrap-canary'
    );
    assert.match(markdown, /\| Linux production bootstrap canary \| failure \|/);
    assert.match(markdown, /Linux bootstrap failure boundary: `page-resource-candidates`/);
    assert.match(
      markdown,
      /Linux production bootstrap canary: `linux-production-bootstrap-canary`/
    );
  });

  test('does not trust a bootstrap canary success output when the reusable job failed later', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT: 'success',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT: 'failure',
    });

    assert.equal(json.jobs.windowsProductionBootstrapCanary, 'failure');
    assert.equal(
      json.artifacts.windowsProductionBootstrapCanary,
      'windows-production-bootstrap-canary'
    );
    assert.match(markdown, /\| Windows production bootstrap canary \| failure \|/);
    assert.match(
      markdown,
      /Windows production bootstrap canary: `windows-production-bootstrap-canary`/
    );
  });

  test('normalizes explicit post-release client evidence states', () => {
    for (const state of ['live-tested', 'skipped-by-billing-mode', 'advisory-only', 'failed']) {
      const { json, markdown } = generateEvidence({
        STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
        PRODUCTION_CLIENT_UPDATE_CANARY_RESULT: state,
      });

      assert.equal(json.jobs.productionClientUpdateCanary, state);
      assert.match(
        markdown,
        new RegExp(`\\| Production client update canary \\(post-release\\) \\| ${state} \\|`)
      );
    }
  });
});
