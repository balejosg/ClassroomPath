import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');
const scriptPath = resolve(projectRoot, 'scripts/write-release-evidence.mjs');
const evidenceHelperPath = resolve(projectRoot, 'scripts/lib/release-evidence.mjs');

type ReleaseEvidence = {
  release: {
    outcome: string;
  };
  jobs: {
    windowsFirefoxCanary: string;
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
    execFileSync('node', [scriptPath], {
      cwd: outputDir,
      env: {
        ...process.env,
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
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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

  test('renders advisory canary success for high-risk promotions', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      STAGING_WINDOWS_BOOTSTRAP_RESULT: 'success',
      STAGING_FIREFOX_POLICY_RESULT: 'success',
      WINDOWS_FIREFOX_CANARY_RESULT: 'success',
    });

    assert.equal(json.jobs.windowsFirefoxCanary, 'success');
    assert.equal(json.stagingVerification.windowsFirefoxHighRisk, 'true');
    assert.equal(json.stagingVerification.windowsBootstrapResult, 'success');
    assert.equal(json.stagingVerification.firefoxPolicyResult, 'success');
    assert.match(markdown, /\| Windows\/Firefox canary \(advisory\) \| success \|/);
    assert.match(markdown, /Windows\/Firefox high risk: `true`/);
  });

  test('keeps a failed advisory canary visible without changing release outcome', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'true',
      STAGING_WINDOWS_BOOTSTRAP_RESULT: 'success',
      STAGING_FIREFOX_POLICY_RESULT: 'success',
      WINDOWS_FIREFOX_CANARY_RESULT: 'failure',
    });

    assert.equal(json.release.outcome, 'released');
    assert.equal(json.jobs.windowsFirefoxCanary, 'failure');
    assert.match(markdown, /\| Windows\/Firefox canary \(advisory\) \| failure \|/);
  });

  test('marks the advisory canary as not applicable for low-risk promotions', () => {
    const { json, markdown } = generateEvidence({
      STAGING_WINDOWS_FIREFOX_HIGH_RISK: 'false',
    });

    assert.equal(json.jobs.windowsFirefoxCanary, 'not_applicable');
    assert.equal(json.stagingVerification.windowsFirefoxHighRisk, 'false');
    assert.match(markdown, /\| Windows\/Firefox canary \(advisory\) \| not_applicable \|/);
  });
});
