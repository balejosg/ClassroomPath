import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  findWorkflowJob,
  findWorkflowStepByName,
  readProjectText,
  readProjectWorkflow,
  type WorkflowDefinition,
} from './helpers/ops-contracts.ts';

type WorkflowJob = {
  needs?: string | string[];
  uses?: string;
  outputs?: Record<string, string>;
  steps?: Array<{
    name?: string;
    if?: string;
    run?: string;
    with?: Record<string, unknown>;
  }>;
};

function readWorkflow(relativePath: string): WorkflowDefinition {
  return readProjectWorkflow(relativePath);
}

function readText(relativePath: string): string {
  return readProjectText(relativePath);
}

function normalizeNeeds(needs: WorkflowJob['needs']): string[] {
  if (!needs) {
    return [];
  }

  return Array.isArray(needs) ? needs : [needs];
}

describe('Deploy workflow contracts', () => {
  test('deploy and smoke workflows reuse shared transport, verifier, and concurrency helpers', () => {
    const deployWorkflow = readWorkflow('.github/workflows/deploy.yml');
    const deployWorkflowText = readText('.github/workflows/deploy.yml');
    const rollbackProductionScript = readText('scripts/rollback-production-remote.sh');
    const verifyStagingJob = findWorkflowJob(deployWorkflow, 'verify-staging-release-state');
    const deployProductionJob = findWorkflowJob(deployWorkflow, 'deploy-production');
    const resolveReleaseImagesJob = findWorkflowJob(deployWorkflow, 'resolve-release-images');
    const smokeWorkflowText = readText('.github/workflows/smoke-tests.yml');
    const reusableSmokeWorkflowText = readText('.github/workflows/reusable-smoke-test.yml');
    const cleanupWorkflow = readText('.github/workflows/cleanup-staging.yml');
    const canaryWorkflow = readText('.github/workflows/windows-firefox-canary.yml');
    const canaryReusableWorkflow = readWorkflow('.github/workflows/windows-firefox-canary.yml');
    const canaryReusableJob = findWorkflowJob(canaryReusableWorkflow, 'windows-firefox-canary');
    const productionClientUpdateCanaryWorkflowText = readText(
      '.github/workflows/production-client-update-canary.yml'
    );
    const windowsProductionBootstrapCanaryWorkflowText = readText(
      '.github/workflows/windows-production-bootstrap-canary.yml'
    );
    const concurrency = deployWorkflow.concurrency;
    const jobs = deployWorkflow.jobs ?? {};

    assert.ok(smokeWorkflowText.includes('./.github/workflows/reusable-smoke-test.yml'));
    assert.ok(smokeWorkflowText.includes('resolve-latest-verifier-image.mjs'));
    assert.ok(reusableSmokeWorkflowText.includes('run-smoke-in-verifier.sh'));
    assert.ok(reusableSmokeWorkflowText.includes('verifier_image:'));
    assert.ok(reusableSmokeWorkflowText.includes('wait-for-ready.sh'));
    assert.ok(!reusableSmokeWorkflowText.includes('npm ci'));
    assert.ok(deployWorkflowText.includes('source scripts/lib/github-actions-remote.sh'));
    assert.ok(
      String(findWorkflowStepByName(verifyStagingJob, 'Resolve staging host').run ?? '').includes(
        'github_actions_remote_write_resolved_host_outputs'
      )
    );
    assert.ok(
      String(findWorkflowStepByName(deployProductionJob, 'Resolve deploy host').run ?? '').includes(
        'github_actions_remote_write_resolved_host_outputs'
      )
    );
    assert.ok(canaryWorkflow.includes('bash scripts/resolve-ssh-host.sh'));
    assert.ok(cleanupWorkflow.includes('bash scripts/resolve-ssh-host.sh'));
    assert.ok(
      productionClientUpdateCanaryWorkflowText.includes(
        'source scripts/lib/github-actions-remote.sh'
      )
    );
    assert.ok(
      windowsProductionBootstrapCanaryWorkflowText.includes(
        'source scripts/lib/github-actions-remote.sh'
      )
    );
    assert.ok(!deployWorkflowText.includes('DEPLOY_HOST not configured. Skipping deployment.'));
    assert.ok(deployWorkflowText.includes('verify-staging-release-state.sh'));
    assert.ok(deployWorkflowText.includes('Extract staging evidence from production tag'));
    assert.ok(deployWorkflowText.includes('promotion-evidence-cli.mjs extract-tag-message'));
    assert.ok(deployWorkflowText.includes('Resolve OpenPath required-check base'));
    assert.ok(deployWorkflowText.includes('OPENPATH_BASE_SHA'));
    assert.ok(!deployWorkflowText.includes('OPENPATH_REQUIRED_CHECKS: CI Success'));
    assert.ok(
      String(
        findWorkflowStepByName(verifyStagingJob, 'Read staging release state')?.if ?? ''
      ).includes("steps.tag-evidence.outputs.source != 'tag'")
    );
    assert.ok(
      String(
        findWorkflowStepByName(verifyStagingJob, 'Read staging verification evidence')?.if ?? ''
      ).includes("steps.tag-evidence.outputs.source != 'tag'")
    );
    assert.ok(deployWorkflowText.includes('detect-windows-firefox-risk.sh'));
    assert.ok(deployWorkflowText.includes('staging-promotion-eligibility.json'));
    assert.ok(deployWorkflowText.includes('PROMOTION_ELIGIBLE'));
    assert.ok(deployWorkflowText.includes('Verify production release image platforms'));
    assert.ok(deployWorkflowText.includes('verify-release-manifest-platforms.mjs verify'));
    assert.ok(
      String(
        findWorkflowStepByName(resolveReleaseImagesJob, 'Verify production release image platforms')
          ?.run ?? ''
      ).includes('--target-platform "$PRODUCTION_CONTAINER_PLATFORM"')
    );
    assert.equal(typeof concurrency, 'object');
    assert.match((concurrency as { group?: string }).group ?? '', /production/i);
    assert.equal((concurrency as { 'cancel-in-progress'?: boolean })['cancel-in-progress'], false);
    assert.ok(jobs['resolve-release-images']);
    assert.ok((jobs['resolve-release-images']?.outputs ?? {})['payload_base64']);
    assert.ok(jobs['verify-staging-release-state']);
    assert.ok(jobs['deploy-production']);
    assert.ok(jobs['smoke-test-production']);
    const productionSmokeJob = jobs['smoke-test-production'];
    assert.equal(
      productionSmokeJob?.['timeout-minutes'],
      25,
      'production smoke job must not be able to hang the deploy workflow indefinitely'
    );
    assert.ok(
      String(
        findWorkflowStepByName(productionSmokeJob, 'Read production billing mode')?.run ?? ''
      ).includes('github_actions_remote_read_env_key'),
      'production smoke should read the live billing mode from production before provisioning canaries'
    );
    assert.ok(
      String(
        findWorkflowStepByName(productionSmokeJob, 'Read production client canary admin token')
          ?.run ?? ''
      ).includes('CP_CLIENT_CANARY_ADMIN_TOKEN'),
      'manual-only production smoke should read the canary admin token from production'
    );
    assert.ok(
      String(
        findWorkflowStepByName(productionSmokeJob, 'Read production Stripe webhook secret')?.run ??
          ''
      ).includes('STRIPE_WEBHOOK_SECRET'),
      'stripe production smoke should read the webhook secret from production'
    );
    const linuxEnrollmentStepIndex =
      productionSmokeJob?.steps?.findIndex((step) =>
        String(step.name ?? '').includes('Download and run live Linux enrollment script')
      ) ?? -1;
    const enrollmentStep =
      linuxEnrollmentStepIndex >= 0
        ? productionSmokeJob?.steps?.[linuxEnrollmentStepIndex]
        : undefined;
    assert.ok(enrollmentStep, 'production smoke must download a live Linux enrollment script');
    assert.match(String(enrollmentStep?.run ?? ''), /\/api\/enroll\/\$CLASSROOM_ID/);
    assert.match(String(enrollmentStep?.run ?? ''), /Authorization: Bearer \$ENROLLMENT_TOKEN/);
    assert.match(String(enrollmentStep?.run ?? ''), /OPENPATH_LINUX_AGENT_VERSION/);
    assert.match(String(enrollmentStep?.run ?? ''), /production-linux-enrollment-download\.json/);
    assert.match(String(enrollmentStep?.run ?? ''), /body\.slice\(0, 4000\)/);
    assert.match(String(enrollmentStep?.run ?? ''), /for attempt in 1 2 3/);
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /Linux enrollment attempt \$attempt failed with status \$enrollment_status/
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /sudo timeout --kill-after=30s 10m bash "\$enroll_script"/
    );
    assert.equal(
      enrollmentStep?.['timeout-minutes'],
      12,
      'production Linux enrollment must not hang the deploy smoke indefinitely'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /sudo timeout --kill-after=30s 10m bash "\$enroll_script"/,
      'production Linux enrollment must hard-bound the root installer process tree and preserve diagnostics'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /openpath status/,
      'production Linux enrollment diagnostics should include OpenPath status when available'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /production-linux-firefox-state/,
      'production Linux enrollment should capture Firefox state snapshots before the workflow can hang'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /source scripts\/lib\/github-actions-remote\.sh/,
      'production Linux enrollment should load the shared remote helper before attempting early diagnostic persistence'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /\/opt\/classroompath\/release-state\/production-smoke-diagnostics/,
      'production Linux enrollment should know the remote diagnostics root while the failing step is still alive'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /mirror-status\.txt/,
      'production Linux enrollment should write a minimal remote marker file from inside the failing step'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /github_actions_remote_ssh/,
      'production Linux enrollment should reuse the shared SSH helper for early remote persistence'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /extensions\.json/,
      'production Linux enrollment diagnostics should snapshot Firefox extensions state'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /prefs\.js/,
      'production Linux enrollment diagnostics should snapshot Firefox profile prefs'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /firefox --version/,
      'production Linux enrollment diagnostics should record the Firefox runtime version'
    );
    assert.match(
      String(enrollmentStep?.run ?? ''),
      /head -n 1 "\$enroll_script" \| grep -Eq '\^#!.*bash'/
    );
    const ensureEnrollmentArtifactsStep = productionSmokeJob?.steps?.find(
      (step) => step.name === 'Ensure Linux enrollment diagnostic artifacts'
    );
    assert.equal(
      ensureEnrollmentArtifactsStep?.if,
      'always()',
      'Linux enrollment diagnostics must be materialized even when the enrollment step fails'
    );
    assert.ok(
      String(ensureEnrollmentArtifactsStep?.run ?? '').includes(
        'production-linux-enrollment-diagnostics.tar.gz'
      ),
      'Linux enrollment diagnostics should be packaged immediately after the enrollment step'
    );
    assert.ok(
      String(ensureEnrollmentArtifactsStep?.run ?? '').includes('production-linux-firefox-state'),
      'Linux enrollment diagnostic archive must include the Firefox state snapshot directory'
    );
    const uploadEnrollmentDiagnosticsStep = productionSmokeJob?.steps?.find(
      (step) => step.name === 'Upload Linux enrollment diagnostics'
    );
    const mirrorEnrollmentDiagnosticsStep = productionSmokeJob?.steps?.find(
      (step) => step.name === 'Mirror Linux enrollment diagnostics to production release state'
    );
    const summarizeEnrollmentDiagnosticsStep = productionSmokeJob?.steps?.find(
      (step) => step.name === 'Summarize Linux enrollment diagnostics'
    );
    assert.equal(uploadEnrollmentDiagnosticsStep?.if, 'always()');
    assert.equal(uploadEnrollmentDiagnosticsStep?.uses, 'actions/upload-artifact@v7');
    assert.equal(uploadEnrollmentDiagnosticsStep?.['continue-on-error'], true);
    assert.equal(uploadEnrollmentDiagnosticsStep?.['timeout-minutes'], 10);
    assert.equal(
      mirrorEnrollmentDiagnosticsStep?.if,
      'always()',
      'Linux enrollment diagnostics should be mirrored even when the smoke step fails'
    );
    assert.equal(mirrorEnrollmentDiagnosticsStep?.['continue-on-error'], true);
    assert.equal(mirrorEnrollmentDiagnosticsStep?.['timeout-minutes'], 5);
    assert.match(
      String(mirrorEnrollmentDiagnosticsStep?.run ?? ''),
      /\/opt\/classroompath\/release-state\/production-smoke-diagnostics/,
      'Linux enrollment diagnostics should be mirrored to production release-state for out-of-band retrieval'
    );
    assert.match(
      String(mirrorEnrollmentDiagnosticsStep?.run ?? ''),
      /production-linux-enrollment-diagnostics\.tar\.gz/,
      'Linux enrollment diagnostic mirror should copy the tarball that the workflow packaged locally'
    );
    assert.match(
      String(mirrorEnrollmentDiagnosticsStep?.run ?? ''),
      /remote_write_from_file[\s\S]*production-linux-enrollment-diagnostics\.tar\.gz/,
      'Linux enrollment diagnostic mirror should stream the tarball through the shared SSH helper'
    );
    assert.match(
      String(mirrorEnrollmentDiagnosticsStep?.run ?? ''),
      /mirror_status=/,
      'Linux enrollment diagnostic mirror should record whether the remote write actually succeeded'
    );
    assert.match(
      String(mirrorEnrollmentDiagnosticsStep?.run ?? ''),
      /github_actions_remote_ssh/,
      'Linux enrollment diagnostic mirror should reuse the shared remote helper for all remote writes'
    );
    assert.equal(
      summarizeEnrollmentDiagnosticsStep?.if,
      'always()',
      'Linux enrollment diagnostics summary should be emitted even when the smoke step fails'
    );
    assert.match(
      String(summarizeEnrollmentDiagnosticsStep?.run ?? ''),
      /\$GITHUB_STEP_SUMMARY/,
      'Linux enrollment diagnostics summary should be written to the GitHub step summary'
    );
    assert.match(
      String(summarizeEnrollmentDiagnosticsStep?.run ?? ''),
      /MIRROR_STATUS/,
      'Linux enrollment diagnostics summary should surface the remote mirror status inline'
    );
    assert.match(
      String(summarizeEnrollmentDiagnosticsStep?.run ?? ''),
      /production-linux-enrollment-download\.json/,
      'Linux enrollment diagnostics summary should surface the download metadata inline'
    );
    assert.match(
      String(summarizeEnrollmentDiagnosticsStep?.run ?? ''),
      /tar -tzf production-linux-enrollment-diagnostics\.tar\.gz/,
      'Linux enrollment diagnostics summary should list the packaged tarball contents inline'
    );
    assert.equal(
      uploadEnrollmentDiagnosticsStep?.with?.path,
      'production-linux-enrollment-diagnostics.tar.gz'
    );
    assert.equal(uploadEnrollmentDiagnosticsStep?.with?.['if-no-files-found'], 'error');
    assert.equal(uploadEnrollmentDiagnosticsStep?.with?.overwrite, true);
    const uploadResultsStep = findWorkflowStepByName(
      productionSmokeJob,
      'Upload smoke test results'
    );
    assert.ok(
      String(uploadResultsStep?.with?.path ?? '').includes(
        'production-linux-enrollment-diagnostics.tar.gz'
      )
    );
    assert.ok(
      String(uploadResultsStep?.with?.path ?? '').includes(
        'production-linux-enrollment-download.json'
      )
    );
    assert.ok(
      String(uploadResultsStep?.with?.path ?? '').includes(
        'production-linux-enrollment-download.headers'
      )
    );
    assert.ok(
      String(uploadResultsStep?.with?.path ?? '').includes(
        'production-linux-enrollment-download.body'
      )
    );
    assert.ok(
      String(uploadResultsStep?.with?.path ?? '').includes('production-linux-firefox-state')
    );
    const linuxFirefoxCanaryStepIndex =
      productionSmokeJob?.steps?.findIndex(
        (step) => step.name === 'Verify production Linux Firefox blocked page canary'
      ) ?? -1;
    const ensureEnrollmentArtifactsStepIndex =
      productionSmokeJob?.steps?.findIndex(
        (step) => step.name === 'Ensure Linux enrollment diagnostic artifacts'
      ) ?? -1;
    const uploadEnrollmentDiagnosticsStepIndex =
      productionSmokeJob?.steps?.findIndex(
        (step) => step.name === 'Upload Linux enrollment diagnostics'
      ) ?? -1;
    const mirrorEnrollmentDiagnosticsStepIndex =
      productionSmokeJob?.steps?.findIndex(
        (step) => step.name === 'Mirror Linux enrollment diagnostics to production release state'
      ) ?? -1;
    const summarizeEnrollmentDiagnosticsStepIndex =
      productionSmokeJob?.steps?.findIndex(
        (step) => step.name === 'Summarize Linux enrollment diagnostics'
      ) ?? -1;
    const linuxFirefoxCanaryStep =
      linuxFirefoxCanaryStepIndex >= 0
        ? productionSmokeJob?.steps?.[linuxFirefoxCanaryStepIndex]
        : undefined;
    assert.ok(
      linuxFirefoxCanaryStepIndex > linuxEnrollmentStepIndex,
      'production smoke must verify Linux Firefox after live Linux enrollment'
    );
    assert.ok(
      ensureEnrollmentArtifactsStepIndex > linuxEnrollmentStepIndex,
      'Linux enrollment diagnostics must be materialized immediately after the live enrollment step'
    );
    assert.ok(
      mirrorEnrollmentDiagnosticsStepIndex > ensureEnrollmentArtifactsStepIndex,
      'Linux enrollment diagnostics should be mirrored to production release-state immediately after packaging'
    );
    assert.ok(
      summarizeEnrollmentDiagnosticsStepIndex > mirrorEnrollmentDiagnosticsStepIndex,
      'Linux enrollment diagnostics summary should be emitted after the remote mirror step'
    );
    assert.ok(
      uploadEnrollmentDiagnosticsStepIndex > ensureEnrollmentArtifactsStepIndex &&
        uploadEnrollmentDiagnosticsStepIndex < linuxFirefoxCanaryStepIndex,
      'Linux enrollment diagnostics should upload before the Firefox blocked-page canary runs'
    );
    assert.ok(
      String(linuxFirefoxCanaryStep?.run ?? '').includes(
        'scripts/linux-firefox-block-page-canary.mjs'
      )
    );
    assert.ok(
      String(linuxFirefoxCanaryStep?.run ?? '').includes(
        'production-linux-firefox-block-page-canary.json'
      )
    );
    const windowsEnrollmentStep = productionSmokeJob?.steps?.find((step) =>
      String(step.name ?? '').includes('Download live Windows enrollment script')
    );
    assert.ok(
      windowsEnrollmentStep,
      'production smoke must download a live Windows enrollment script'
    );
    assert.match(
      String(windowsEnrollmentStep?.run ?? ''),
      /\/api\/enroll\/\$CLASSROOM_ID\/windows\.ps1/
    );
    assert.match(
      String(windowsEnrollmentStep?.run ?? ''),
      /Authorization: Bearer \$ENROLLMENT_TOKEN/
    );
    assert.match(
      String(windowsEnrollmentStep?.run ?? ''),
      /api\/agent\/windows\/bootstrap\/manifest/
    );
    assert.match(String(windowsEnrollmentStep?.run ?? ''), /\$env:OPENPATH_VERSION/);
    const uploadSmokeResultsStep = productionSmokeJob?.steps?.find(
      (step) => step.name === 'Upload smoke test results'
    );
    assert.equal(
      uploadSmokeResultsStep?.['continue-on-error'],
      true,
      'production smoke artifact upload must not keep a failed canary job stuck'
    );
    assert.ok(jobs['rollback-production']);
    assert.ok(
      normalizeNeeds(jobs['rollback-production']?.needs).includes('resolve-release-images'),
      'rollback must receive the resolved production container platform'
    );
    assert.ok(
      String(
        jobs['rollback-production']?.steps?.find((step) => step.name === 'Roll back via SSH')?.with
          ?.envs ?? ''
      ).includes('PRODUCTION_CONTAINER_PLATFORM'),
      'rollback SSH step must forward PRODUCTION_CONTAINER_PLATFORM'
    );
    assert.ok(
      rollbackProductionScript.includes('deploy-container-platform.sh') &&
        rollbackProductionScript.includes(
          'configure_deploy_container_platform "${PRODUCTION_CONTAINER_PLATFORM:-linux/arm64}"'
        ) &&
        rollbackProductionScript.includes('verify_deploy_container_platform'),
      'rollback must force the production container platform before docker compose pull/up'
    );
    assert.ok(jobs['release-evidence']);
    assert.ok(jobs['windows-firefox-canary']);
    assert.equal(
      jobs['windows-firefox-canary']?.uses,
      './.github/workflows/windows-firefox-canary.yml'
    );
    assert.ok(
      !('continue-on-error' in jobs['windows-firefox-canary']),
      'reusable workflow jobs cannot use continue-on-error in the caller'
    );
    assert.equal(
      canaryReusableJob.outputs?.canary_result,
      '${{ steps.result.outputs.canary_result }}'
    );
    assert.equal(
      findWorkflowStepByName(
        canaryReusableJob,
        'Download staging Firefox release evidence and assets'
      )?.['continue-on-error'],
      true
    );
    assert.equal(
      findWorkflowStepByName(canaryReusableJob, 'Run Firefox policy canary')?.['continue-on-error'],
      true
    );
    assert.match(
      deployWorkflowText,
      /"WINDOWS_FIREFOX_CANARY_RESULT": "\$\{\{ needs\.windows-firefox-canary\.outputs\.canary_result \|\| needs\.windows-firefox-canary\.result \}\}"/
    );
    assert.ok(!jobs['production-client-update-canary']);
    const deployNeeds = normalizeNeeds(jobs['deploy-production']?.needs);
    assert.ok(deployNeeds.includes('resolve-release-images'));
    assert.ok(deployNeeds.includes('verify-staging-release-state'));
    assert.ok(deployNeeds.includes('windows-firefox-canary'));
    assert.match(String(jobs['deploy-production']?.if ?? ''), /^always\(\) && /);
    assert.match(
      String(jobs['deploy-production']?.if ?? ''),
      /needs\.windows-firefox-canary\.result == 'success' \|\| needs\.windows-firefox-canary\.result == 'skipped'/
    );
    assert.ok(!deployNeeds.includes('release-gate-staging'));
  });
});
