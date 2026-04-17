import { describe, test } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');

describe('Deployment staging and promotion contracts', () => {
  const stagingDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
  const stagingLocalReleaseHelperPath = resolve(
    projectRoot,
    'scripts/lib/staging-deploy-local-release.sh'
  );
  const stagingLocalVerifyHelperPath = resolve(
    projectRoot,
    'scripts/lib/staging-deploy-local-verify.sh'
  );
  const stagingDeployRemoteScriptPath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
  const stagingHealthCheckScriptPath = resolve(projectRoot, 'scripts/check-staging-health.sh');
  const stagingReleaseGateScriptPath = resolve(projectRoot, 'scripts/run-staging-release-gate.sh');
  const stagingSmokeScriptPath = resolve(projectRoot, 'scripts/run-staging-smoke.sh');
  const stagingVerificationRunnerPath = resolve(projectRoot, 'scripts/run-staging-verification.sh');
  const stagingVerifyStateScriptPath = resolve(
    projectRoot,
    'scripts/persist-staging-verification-remote.sh'
  );
  const stagingGatesHelperPath = resolve(projectRoot, 'scripts/lib/staging-gates.sh');
  const releaseImagesScriptPath = resolve(projectRoot, 'scripts/release-images.mjs');
  const releasePlanScriptPath = resolve(projectRoot, 'scripts/lib/release-plan.mjs');
  const waitForReleaseCandidateScriptPath = resolve(
    projectRoot,
    'scripts/wait-for-release-candidate.mjs'
  );
  const deployWorkflowPath = resolve(projectRoot, '.github/workflows/deploy.yml');
  const promotionReadyScriptPath = resolve(
    projectRoot,
    'scripts/verify-production-promotion-ready.sh'
  );
  const productionHostReadinessScriptPath = resolve(
    projectRoot,
    'scripts/verify-production-host-readiness.sh'
  );
  const deployProductionContextHelperPath = resolve(
    projectRoot,
    'scripts/lib/deploy-production-context.sh'
  );
  const deployProductionRuntimeHelperPath = resolve(
    projectRoot,
    'scripts/lib/deploy-production-runtime.sh'
  );

  test('staging deploy requires a successful release-candidate manifest for origin main', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const releaseHelperContent = readFileSync(stagingLocalReleaseHelperPath, 'utf-8');
    const releasePlanContent = readFileSync(releasePlanScriptPath, 'utf-8');
    const remoteContent = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');

    assert.ok(existsSync(releaseImagesScriptPath));
    assert.ok(existsSync(waitForReleaseCandidateScriptPath));
    assert.ok(
      localContent.includes('prepare_staging_local_release_context') &&
        releaseHelperContent.includes(
          'node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest'
        )
    );
    assert.ok(remoteContent.includes('deploy_with_release_candidates'));
    assert.ok(remoteContent.includes('docker compose pull gateway api spa'));
    assert.ok(localContent.includes('Allowed value: release-candidate'));
    assert.ok(localContent.includes('does not support source-build staging deploys'));
    assert.ok(
      releaseHelperContent.includes('STAGING_RELEASE_MANIFEST_FILE') &&
        releaseHelperContent.includes('STAGING_RELEASE_MANIFEST_B64')
    );
    assert.ok(releasePlanContent.includes('release-candidate manifest APP_SHA'));
    assert.ok(
      releaseHelperContent.includes('STAGING_RELEASE_RUN_ID') &&
        releaseHelperContent.includes('STAGING_RELEASE_REPOSITORY')
    );
    assert.ok(releaseHelperContent.includes('STAGING_RELEASE_WAIT_TIMEOUT_SECONDS'));
    assert.ok(
      remoteContent.includes('decode_release_manifest_base64 "$STAGING_RELEASE_MANIFEST_B64"') &&
        remoteContent.includes('load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"')
    );
    assert.ok(
      remoteContent.includes(
        'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"'
      ) &&
        remoteContent.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE "${OPENPATH_LINUX_AGENT_APT_SUITE:-}"'
        )
    );
    assert.ok(
      !localContent.includes('node "$SCRIPT_DIR/release-images.mjs" outputs --sha "$REMOTE_SHA"')
    );
    assert.ok(!localContent.includes('Falling back to source build for staging'));
    assert.ok(!localContent.includes('source-build|'));
  });

  test('staging deploy records reusable smoke, release-gate, and Windows/Firefox evidence', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const releaseHelperContent = readFileSync(stagingLocalReleaseHelperPath, 'utf-8');
    const verifyHelperContent = readFileSync(stagingLocalVerifyHelperPath, 'utf-8');
    const releaseGateHelperContent = readFileSync(stagingReleaseGateScriptPath, 'utf-8');
    const persistHelperContent = readFileSync(stagingVerifyStateScriptPath, 'utf-8');
    const runnerContent = readFileSync(stagingVerificationRunnerPath, 'utf-8');
    const stagingGatesHelper = readFileSync(stagingGatesHelperPath, 'utf-8');

    assert.ok(existsSync(stagingVerifyStateScriptPath));
    assert.ok(existsSync(stagingVerificationRunnerPath));
    assert.ok(localContent.includes('STAGING_RUN_RELEASE_GATE="${STAGING_RUN_RELEASE_GATE:-1}"'));
    assert.ok(
      releaseHelperContent.includes('STAGING_DEPLOYMENT_MODE') &&
        releaseHelperContent.includes('cannot produce promotion evidence')
    );
    assert.ok(existsSync(stagingReleaseGateScriptPath));
    assert.ok(
      releaseGateHelperContent.includes(
        'exec bash "$SCRIPT_DIR/run-staging-verification.sh" release-gate "$@"'
      )
    );
    assert.ok(stagingGatesHelper.includes('RELEASE_GATE_URL=$canonical_staging_url'));
    assert.ok(
      runnerContent.includes('source "$SCRIPT_DIR/lib/staging-gates.sh"') &&
        stagingGatesHelper.includes('run_gate_command()')
    );
    assert.ok(
      verifyHelperContent.includes('build_staging_verify_state_env_cmd()') &&
        verifyHelperContent.includes('run_staging_local_verification()')
    );
    assert.ok(
      stagingGatesHelper.includes('run_gate_command smoke') &&
        stagingGatesHelper.includes('run_gate_command release-gate') &&
        stagingGatesHelper.includes('run_gate_command windows-bootstrap-gate')
    );
    assert.ok(
      stagingGatesHelper.includes('print_staging_public_ingress_diagnostics()') &&
        stagingGatesHelper.includes('https://api.ipify.org') &&
        stagingGatesHelper.includes('dig @1.1.1.1') &&
        stagingGatesHelper.includes('curl --max-time'),
      'staging smoke failures should include public DNS and ingress diagnostics'
    );
    assert.ok(
      persistHelperContent.includes('staging-verification.env') &&
        persistHelperContent.includes(
          'STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=$STAGING_FIREFOX_RELEASE_ARTIFACTS'
        ) &&
        persistHelperContent.includes(
          'STAGING_WINDOWS_BOOTSTRAP_RESULT=$STAGING_WINDOWS_BOOTSTRAP_RESULT'
        ) &&
        persistHelperContent.includes(
          'STAGING_FIREFOX_POLICY_RESULT=$STAGING_FIREFOX_POLICY_RESULT'
        )
    );
    assert.ok(
      persistHelperContent.includes('STAGING_FIREFOX_EXTENSION_ID=') &&
        persistHelperContent.includes('STAGING_FIREFOX_RELEASE_VERSION=') &&
        persistHelperContent.includes('STAGING_FIREFOX_METADATA_SHA256=') &&
        persistHelperContent.includes('STAGING_FIREFOX_XPI_SHA256=')
    );
    assert.ok(
      stagingGatesHelper.includes(
        'classroompath-api test -f /app/firefox-extension/build/firefox-release/metadata.json'
      ) &&
        stagingGatesHelper.includes(
          'classroompath-api test -f /app/firefox-extension/build/firefox-release/openpath-firefox-extension.xpi'
        ) &&
        stagingGatesHelper.includes(
          'classroompath-api test -f /app/runtime/browser-policy-spec.json'
        )
    );
    assert.ok(
      stagingGatesHelper.includes('STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE') &&
        stagingGatesHelper.includes(
          'Release-candidate staging deploys must prove the live Windows bootstrap contract'
        )
    );
    assert.ok(
      localContent.includes(
        'STAGING_VERIFY_STATE_SCRIPT_PATH="$SCRIPT_DIR/persist-staging-verification-remote.sh"'
      ) &&
        localContent.includes(
          'STAGING_VERIFICATION_RUNNER_PATH="$SCRIPT_DIR/run-staging-verification.sh"'
        )
    );
    assert.ok(
      verifyHelperContent.includes(
        'bash "$STAGING_VERIFICATION_RUNNER_PATH" collect "$VERIFICATION_STATE_FILE" "$STAGING_HOST" "$STAGING_SMOKE_URL" "$CANONICAL_STAGING_URL" "$STAGING_USE_RELEASE_CANDIDATE" "${SSH_CMD[@]}"'
      )
    );
    assert.ok(
      verifyHelperContent.includes('mark_staging_local_verification_failed()') &&
        verifyHelperContent.includes('DEPLOY_FAILURE_STAGE="verification"') &&
        verifyHelperContent.includes('FAILURE_STAGE="verification"') &&
        verifyHelperContent.includes('write_deploy_context_state "$DEPLOY_CONTEXT_FILE"'),
      'staging deploy should overwrite the remote deploy context when post-deploy verification fails'
    );
  });

  test('staging deploy delegates health polling and smoke execution to dedicated helpers', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const verifyHelperContent = readFileSync(stagingLocalVerifyHelperPath, 'utf-8');
    const healthHelperContent = readFileSync(stagingHealthCheckScriptPath, 'utf-8');
    const smokeHelperContent = readFileSync(stagingSmokeScriptPath, 'utf-8');
    const stagingGatesHelper = readFileSync(stagingGatesHelperPath, 'utf-8');

    assert.ok(existsSync(stagingHealthCheckScriptPath));
    assert.ok(existsSync(stagingSmokeScriptPath));
    assert.ok(
      localContent.includes(
        'STAGING_HEALTH_CHECK_SCRIPT_PATH="$SCRIPT_DIR/check-staging-health.sh"'
      )
    );
    assert.ok(localContent.includes('run_staging_local_health_checks'));
    assert.ok(
      verifyHelperContent.includes(
        'bash "$STAGING_HEALTH_CHECK_SCRIPT_PATH" "$STAGING_HOST" "${SSH_CMD[@]}"'
      )
    );
    assert.ok(healthHelperContent.includes('curl -sf http://localhost:3000/cp/ready 2>/dev/null'));
    assert.ok(healthHelperContent.includes('curl -sf http://localhost:3000/health 2>/dev/null'));
    assert.ok(
      smokeHelperContent.includes('exec bash "$SCRIPT_DIR/run-staging-verification.sh" smoke "$@"')
    );
    assert.ok(
      localContent.includes(
        'STAGING_VERIFICATION_RUNNER_PATH="$SCRIPT_DIR/run-staging-verification.sh"'
      )
    );
    assert.ok(
      stagingGatesHelper.includes(
        'bash "$STAGING_GATES_RESOLVE_HOST_SCRIPT_PATH" "$target_host"'
      ) &&
        stagingGatesHelper.includes('run_gate_command smoke') &&
        stagingGatesHelper.includes('SMOKE_TEST_RESOLVED_ADDRESS=')
    );
  });

  test('production deploy uses release-candidate migrations and verifies staging evidence first', () => {
    const workflowContent = readFileSync(deployWorkflowPath, 'utf-8');
    const deployRemoteScript = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const deployContextHelper = readFileSync(deployProductionContextHelperPath, 'utf-8');
    const deployRuntimeHelper = readFileSync(deployProductionRuntimeHelperPath, 'utf-8');
    const remoteDeployScaffoldHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/remote-deploy-scaffold.sh'),
      'utf-8'
    );
    const rollbackRemoteScript = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );
    const releaseStateHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/release-state.sh'),
      'utf-8'
    );

    assert.ok(
      workflowContent.includes(
        'RELEASE_MANIFEST_B64: ${{ needs.resolve-release-images.outputs.manifest_base64 }}'
      )
    );
    assert.ok(workflowContent.includes('OPENPATH_LINUX_AGENT_VERSION'));
    assert.ok(workflowContent.includes('OPENPATH_LINUX_AGENT_APT_SUITE'));
    assert.ok(workflowContent.includes('verify-staging-release-state'));
    assert.ok(
      deployRemoteScript.includes(
        'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"'
      )
    );
    assert.ok(workflowContent.includes('staging-verification.env'));
    assert.ok(releaseStateHelper.includes('STAGING_RELEASE_GATE_RESULT'));
    assert.ok(
      releaseStateHelper.includes('STAGING_WINDOWS_BOOTSTRAP_RESULT') &&
        releaseStateHelper.includes('STAGING_FIREFOX_POLICY_RESULT') &&
        releaseStateHelper.includes('PASS_WITH_FALLBACK')
    );
    assert.ok(!workflowContent.includes('name: Release Gate Staging'));
    assert.ok(workflowContent.includes('Verify production release image platforms'));
    assert.ok(workflowContent.includes('verify-release-manifest-platforms.mjs'));
    assert.ok(workflowContent.includes('PRODUCTION_CONTAINER_PLATFORM'));
    assert.ok(!workflowContent.includes('run: sleep 30'));
    assert.ok(
      deployRuntimeHelper.includes('write_release_runtime_state') &&
        deployRuntimeHelper.includes('"${OPENPATH_LINUX_AGENT_VERSION:-}"') &&
        deployRuntimeHelper.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "${OPENPATH_LINUX_AGENT_VERSION:-}"'
        ) &&
        deployRuntimeHelper.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_APT_SUITE "${OPENPATH_LINUX_AGENT_APT_SUITE:-}"'
        )
    );
    assert.ok(
      deployContextHelper.includes('decode_release_manifest_base64 "$RELEASE_MANIFEST_B64"') &&
        deployContextHelper.includes(
          'release_manifest_is_canonical_contract "$RELEASE_MANIFEST_FILE"'
        ) &&
        deployContextHelper.includes(
          'load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"'
        )
    );
    assert.ok(
      deployRemoteScript.includes('REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH') &&
        deployRemoteScript.includes(
          'remote_deploy_init_base_helper_paths "$SCRIPT_DIR" "$APP_DIR"'
        ) &&
        remoteDeployScaffoldHelper.includes(
          'COMMON_SH_PATH="$(resolve_remote_helper_path "$script_dir" "$app_dir" "lib/common.sh")"'
        )
    );
    assert.ok(deployContextHelper.includes('classify_migration_risk() {'));
    assert.ok(
      deployContextHelper.includes(
        'classify_migration_risk "$APP_DIR" "$PREVIOUS_APP_SHA" "$TARGET_SHA"'
      )
    );
    assert.ok(!deployRemoteScript.includes('upsert_env_file_var() {'));
    assert.ok(
      deployRemoteScript.includes('git submodule update --init --recursive --force') &&
        deployRemoteScript.includes('remote_deploy_reload_checked_out_helpers')
    );
    assert.ok(!rollbackRemoteScript.includes('upsert_env_file_var() {'));
  });

  test('production runbook exposes an explicit pre-tag promotion-ready gate', () => {
    const runbook = readFileSync(
      resolve(projectRoot, 'docs/runbooks/deploy-production.md'),
      'utf-8'
    );
    const secretsDoc = readFileSync(resolve(projectRoot, 'docs/SECRETS.md'), 'utf-8');
    const packageJson = readFileSync(resolve(projectRoot, 'package.json'), 'utf-8');
    const promotionReadyScript = readFileSync(promotionReadyScriptPath, 'utf-8');
    const tagProductionScript = readFileSync(
      resolve(projectRoot, 'scripts/tag-production-release.sh'),
      'utf-8'
    );
    const productionHostReadinessScript = readFileSync(productionHostReadinessScriptPath, 'utf-8');

    assert.ok(existsSync(promotionReadyScriptPath));
    assert.ok(existsSync(productionHostReadinessScriptPath));
    assert.ok(
      promotionReadyScript.includes('release-state-cli.mjs') &&
        promotionReadyScript.includes('verify-promotion-ready') &&
        promotionReadyScript.includes('wait-for-release-candidate.mjs') &&
        promotionReadyScript.includes('resolve-manifest') &&
        promotionReadyScript.includes('source "$SCRIPT_DIR/lib/deploy-container-platform.sh"') &&
        promotionReadyScript.includes('verify_production_container_platform_ready') &&
        promotionReadyScript.includes('configure_deploy_container_platform "$target_platform"')
    );
    assert.ok(!promotionReadyScript.includes('qemu-x86_64'));
    assert.ok(promotionReadyScript.includes('PROMOTION_EVIDENCE_DIR'));
    assert.ok(tagProductionScript.includes('promotion-evidence-cli.mjs'));
    assert.ok(
      tagProductionScript.includes('git tag -a "$TAG_NAME" "$main_sha" -F "$tag_message_file"')
    );
    assert.ok(runbook.includes('npm run verify:promotion-ready'));
    assert.ok(runbook.includes('npm run promote:production -- v1.2.4'));
    assert.ok(runbook.includes('Production server images support linux/arm64'));
    assert.ok(runbook.includes('npm run verify:production-host -- <candidate-host>'));
    assert.ok(secretsDoc.includes('npm run verify:production-host -- <candidate-host>'));
    assert.ok(packageJson.includes('"verify:production-host"'));
    assert.ok(
      productionHostReadinessScript.includes('verify_host_arch_matches_target_platform') &&
        productionHostReadinessScript.includes('linux/arm64') &&
        productionHostReadinessScript.includes('test -d /opt/classroompath/app/.git') &&
        productionHostReadinessScript.includes('docker compose version') &&
        productionHostReadinessScript.includes('docker info') &&
        productionHostReadinessScript.includes('current-images.env') &&
        !productionHostReadinessScript.includes('qemu-x86_64')
    );
    assert.ok(
      productionHostReadinessScript.includes(
        'DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"'
      ) && productionHostReadinessScript.includes('-F "$DEPLOY_SSH_CONFIG"'),
      'production host readiness should not depend on /etc/ssh/ssh_config.d'
    );
    assert.ok(
      promotionReadyScript.includes('STAGING_SSH_CONFIG="${STAGING_SSH_CONFIG:-/dev/null}"') &&
        promotionReadyScript.includes('DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"') &&
        promotionReadyScript.includes('-F "$STAGING_SSH_CONFIG"') &&
        promotionReadyScript.includes('-F "$DEPLOY_SSH_CONFIG"'),
      'promotion readiness should isolate both staging and production SSH clients'
    );
  });
});
