import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runProjectCommand } from './helpers/ops-contracts.ts';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');
const scriptPath = resolve(projectRoot, 'scripts/write-release-evidence.mjs');
const evidenceBundleScriptPath = resolve(projectRoot, 'scripts/release-evidence-bundle.mjs');
const promotionDryValidateScriptPath = resolve(
  projectRoot,
  'scripts/production-promotion-dry-validate.mjs'
);
const evidenceHelperPath = resolve(projectRoot, 'scripts/lib/release-evidence.mjs');

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

describe('release evidence rendering', () => {
  test('release evidence bundle CLI is exposed for incident handoffs', () => {
    const packageJson = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    assert.ok(existsSync(evidenceBundleScriptPath));
    assert.equal(
      packageJson.scripts?.['release:evidence-bundle'],
      'node scripts/release-evidence-bundle.mjs'
    );
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
  });

  test('release evidence rendering is delegated to the typed helper module', () => {
    const wrapper = readFileSync(scriptPath, 'utf8');
    const helper = readFileSync(evidenceHelperPath, 'utf8');

    assert.match(wrapper, /from '\.\/lib\/release-evidence\.mjs'/);
    assert.match(helper, /export function buildReleaseEvidence/);
    assert.match(helper, /export function renderReleaseEvidenceMarkdown/);
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
          message: 'Windows AJAX auto-allow canary completed successfully.',
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
        staging: { publicUrl: 'https://classroompath-staging.duckdns.org' },
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
            message: 'Windows AJAX auto-allow canary completed successfully.',
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
    assert.match(markdown, /Total wall time: `8m25s`/);
    assert.match(markdown, /Terminal job: `Release Evidence`/);
    assert.match(markdown, /Longest queue wait: `Release Evidence`/);
    assert.match(markdown, /Longest execution: `Linux Production Bootstrap Canary`/);
    assert.match(
      markdown,
      /Critical path jobs: `Deploy to Production -> Linux Production Bootstrap Canary -> Release Evidence`/
    );
    assert.match(markdown, /Windows canary artifact integrity: `ok`/);
    assert.match(markdown, /Linux canary artifact integrity: `missing`/);
    assert.match(markdown, /Windows bootstrap failure boundary: `none`/);
    assert.match(markdown, /Linux bootstrap failure boundary: `page-resource-candidates`/);
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
      WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_ID: 'local-whitelist-apply',
      WINDOWS_PRODUCTION_BOOTSTRAP_FAILURE_BOUNDARY_MESSAGE:
        'Remote whitelist contains expected hosts but local Windows whitelist did not.',
    });

    assert.equal(json.jobs.windowsProductionBootstrapCanary, 'failure');
    assert.deepEqual(json.diagnostics.windowsProductionBootstrapFailureBoundary, {
      id: 'local-whitelist-apply',
      message: 'Remote whitelist contains expected hosts but local Windows whitelist did not.',
    });
    assert.equal(
      json.artifacts.windowsProductionBootstrapCanary,
      'windows-production-bootstrap-canary'
    );
    assert.match(markdown, /Windows bootstrap failure boundary: `local-whitelist-apply`/);
    assert.match(
      markdown,
      /Windows production bootstrap canary: `windows-production-bootstrap-canary`/
    );
    assert.match(
      markdown,
      /Remote whitelist contains expected hosts but local Windows whitelist did not\./
    );
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
