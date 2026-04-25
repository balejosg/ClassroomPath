import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runProjectCommand } from './helpers/ops-contracts.ts';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');
const scriptPath = resolve(projectRoot, 'scripts/write-release-evidence.mjs');
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
  artifacts: {
    windowsProductionBootstrapCanary: string | null;
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

  test('renders advisory canary success for high-risk promotions', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      PROMOTION_ELIGIBLE: 'true',
      PROMOTION_DEPLOYMENT_MODE: 'promotion-eligible',
      STAGING_WINDOWS_BOOTSTRAP_RESULT: 'success',
      STAGING_FIREFOX_POLICY_RESULT: 'success',
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
    assert.match(markdown, /\| Windows\/Firefox canary \(advisory\) \| success \|/);
    assert.match(markdown, /\| Windows production bootstrap canary \| success \|/);
    assert.match(markdown, /\| Production client update canary \(post-release\) \| live-tested \|/);
    assert.match(markdown, /Windows\/Firefox high risk: `true`/);
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

  test('does not trust a bootstrap canary success output when the reusable job failed later', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_RESULT: 'success',
      WINDOWS_PRODUCTION_BOOTSTRAP_CANARY_JOB_RESULT: 'failure',
    });

    assert.equal(json.jobs.windowsProductionBootstrapCanary, 'failure');
    assert.equal(json.artifacts.windowsProductionBootstrapCanary, null);
    assert.match(markdown, /\| Windows production bootstrap canary \| failure \|/);
    assert.match(markdown, /Windows production bootstrap canary: `n\/a`/);
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
