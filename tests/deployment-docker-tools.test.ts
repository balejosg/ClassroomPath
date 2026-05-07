/**
 * Deployment Docker Tool Tests
 *
 * Contracts for deploy-time helper containers used by staging and production.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');

void describe('Deploy Docker Tool Helpers', () => {
  const deployImagesHelperPath = resolve(projectRoot, 'scripts/lib/deploy-images.sh');
  const migrationsScriptPath = resolve(projectRoot, 'scripts/run-migrations-docker.sh');
  const validationScriptPath = resolve(projectRoot, 'scripts/validate-runtime-config-docker.sh');
  const emailCheckScriptPath = resolve(projectRoot, 'scripts/check-email-delivery-docker.sh');
  const smokeScriptPath = resolve(projectRoot, 'scripts/run-smoke-in-verifier.sh');
  const deploymentTestPath = resolve(projectRoot, 'tests/deployment.test.ts');

  void test('dockerized runtime validation executes the TypeScript runtime contract check', () => {
    const content = readFileSync(validationScriptPath, 'utf-8');
    const helperContent = readFileSync(deployImagesHelperPath, 'utf-8');

    assert.ok(
      content.includes('docker_run_node_tool_with_verifier_fallback') &&
        content.includes('"api/scripts/validate-runtime-config.ts"'),
      'validate-runtime-config-docker.sh should execute the runtime config validation entrypoint through the shared helper'
    );
    assert.ok(
      helperContent.includes('npm ci --silent -w @classroompath/api'),
      'shared Docker tool helper should install the ClassroomPath API workspace before validating'
    );
  });

  void test('staging deploy reuses the release verifier image for remote runtime validation', () => {
    const localDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
    const localRuntimeHelperPath = resolve(
      projectRoot,
      'scripts/lib/staging-deploy-local-runtime.sh'
    );
    const localReleaseHelperPath = resolve(
      projectRoot,
      'scripts/lib/staging-deploy-local-release.sh'
    );
    const remoteDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');

    const localDeploy = readFileSync(localDeployScriptPath, 'utf-8');
    const localRuntimeHelper = readFileSync(localRuntimeHelperPath, 'utf-8');
    const localReleaseHelper = readFileSync(localReleaseHelperPath, 'utf-8');
    const remoteDeploy = readFileSync(remoteDeployScriptPath, 'utf-8');
    const validationScript = readFileSync(validationScriptPath, 'utf-8');

    assert.ok(
      localDeploy.includes('source "$SCRIPT_DIR/lib/staging-deploy-local-runtime.sh"') &&
        localDeploy.includes('source "$SCRIPT_DIR/lib/staging-deploy-local-release.sh"') &&
        localReleaseHelper.includes(
          'export_release_manifest_runtime_env "$STAGING_RELEASE_MANIFEST_FILE"'
        ) &&
        localRuntimeHelper.includes(
          'remote_assignment STAGING_RELEASE_MANIFEST_B64 "$STAGING_RELEASE_MANIFEST_B64"'
        ) &&
        localRuntimeHelper.includes(
          'remote_assignment STAGING_DEPLOY_PAYLOAD_B64 "$STAGING_DEPLOY_PAYLOAD_B64"'
        ),
      'staging local runtime helper should expose the release manifest locally and forward the shared release manifest and deploy payload to the remote staging deploy'
    );
    assert.ok(
      remoteDeploy.includes('CLASSROOMPATH_VERIFIER_IMAGE="${CLASSROOMPATH_VERIFIER_IMAGE:-}"') &&
        remoteDeploy.includes('bash scripts/validate-runtime-config-docker.sh'),
      'deploy-staging-remote.sh should reuse the staged verifier image during runtime validation'
    );
    assert.ok(
      validationScript.includes('docker_run_node_tool_with_verifier_fallback') &&
        !validationScript.includes('if [ -n "${CLASSROOMPATH_VERIFIER_IMAGE:-}" ]; then'),
      'validate-runtime-config-docker.sh should delegate verifier image fallback to the shared helper'
    );
  });

  void test('deploy shell helpers centralize tool-image resolution for migrations, validation, email, and smoke', () => {
    const helperContent = readFileSync(deployImagesHelperPath, 'utf-8');
    const migrationsContent = readFileSync(migrationsScriptPath, 'utf-8');
    const validationContent = readFileSync(validationScriptPath, 'utf-8');
    const emailContent = readFileSync(emailCheckScriptPath, 'utf-8');
    const smokeContent = readFileSync(smokeScriptPath, 'utf-8');
    const stagingGatesContent = readFileSync(
      resolve(projectRoot, 'scripts/lib/staging-gates.sh'),
      'utf-8'
    );

    assert.ok(existsSync(deployImagesHelperPath), 'scripts/lib/deploy-images.sh should exist');
    assert.ok(
      helperContent.includes('docker_require_image()') &&
        helperContent.includes('docker_select_image_with_fallback()') &&
        helperContent.includes('docker_run_node_tool_with_verifier_fallback()') &&
        helperContent.includes('no space left on device'),
      'deploy image helper should centralize required-image logic, fallback selection, verifier execution, and actionable disk-space diagnostics'
    );
    assert.ok(
      migrationsContent.includes('source "$SCRIPT_DIR/lib/deploy-images.sh"'),
      'run-migrations-docker.sh should source the shared deploy-images helper'
    );
    assert.ok(
      validationContent.includes('source "$SCRIPT_DIR/lib/deploy-images.sh"') &&
        validationContent.includes('docker_run_node_tool_with_verifier_fallback'),
      'validate-runtime-config-docker.sh should source and use the shared deploy-images helper'
    );
    assert.ok(
      emailContent.includes('source "$SCRIPT_DIR/lib/deploy-images.sh"') &&
        emailContent.includes('docker_run_node_tool_with_verifier_fallback') &&
        emailContent.includes('CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA=%s') &&
        emailContent.includes('CP_EMAIL_PREFLIGHT_MODE=%s') &&
        emailContent.includes('"code":"skipped-low-risk"') &&
        emailContent.includes('"$EMAIL_CHECK_ENV_FILE"'),
      'check-email-delivery-docker.sh should source and use the shared deploy-images helper while preserving deploy policy env only for email checks'
    );
    assert.ok(
      smokeContent.includes('source "$SCRIPT_DIR/lib/deploy-images.sh"'),
      'run-smoke-in-verifier.sh should source the shared deploy-images helper'
    );
    assert.ok(
      stagingGatesContent.includes('bash scripts/run-smoke-in-verifier.sh'),
      'staging smoke gates should use the release verifier image when it is available instead of requiring Playwright browsers on the runner'
    );
    assert.ok(
      smokeContent.includes('-e SMOKE_SKIP_CORS') &&
        smokeContent.includes('-e SMOKE_ALLOW_MUTATIONS') &&
        smokeContent.includes('-e SMOKE_TEST_RESOLVED_ADDRESS'),
      'dockerized smoke should preserve staging smoke environment knobs'
    );
  });

  void test('deployment.test.ts does not own Docker tool helper contracts', () => {
    const content = readFileSync(deploymentTestPath, 'utf-8');

    assert.ok(
      !content.includes(
        'dockerized runtime validation executes the TypeScript runtime contract check'
      ) && !content.includes('deploy shell helpers centralize tool-image resolution'),
      'Docker tool helper contracts should live in deployment-docker-tools.test.ts'
    );
  });
});
