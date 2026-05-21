import { describe, test } from 'node:test';
import assert from 'node:assert';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProjectWorkflow } from './helpers/ops-contracts.ts';

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
  const promoteCurrentStagingWorkflowPath = resolve(
    projectRoot,
    '.github/workflows/promote-current-staging-candidate.yml'
  );
  const promoteCurrentStagingPreflightPath = resolve(
    projectRoot,
    'scripts/preflight-current-staging-promotion.sh'
  );
  const promotionReadyScriptPath = resolve(
    projectRoot,
    'scripts/verify-production-promotion-ready.sh'
  );
  const productionHostReadinessScriptPath = resolve(
    projectRoot,
    'scripts/verify-production-host-readiness.sh'
  );
  const productionTargetPreflightScriptPath = resolve(
    projectRoot,
    'scripts/preflight-production-promotion-target.sh'
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
    const releaseCandidateWorkflowContent = readFileSync(
      resolve(projectRoot, '.github/workflows/release-candidate-images.yml'),
      'utf-8'
    );
    const releaseCandidateWorkflow = readProjectWorkflow(
      '.github/workflows/release-candidate-images.yml'
    );

    assert.ok(existsSync(releaseImagesScriptPath));
    assert.ok(existsSync(waitForReleaseCandidateScriptPath));
    assert.ok(
      localContent.includes('prepare_staging_local_release_context') &&
        releaseHelperContent.includes(
          'node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest'
        )
    );
    assert.deepEqual(releaseCandidateWorkflow.on?.push?.branches, ['main']);
    assert.ok(
      !Object.hasOwn(releaseCandidateWorkflow.on?.push ?? {}, 'paths'),
      'release-candidate images should refresh on every main push, including promotion-eligible staging deploy logic changes'
    );
    assert.ok(
      releaseHelperContent.includes('warn_if_other_release_candidate_run_in_progress "$REMOTE_SHA"')
    );
    assert.ok(
      releaseHelperContent.includes('--workflow release-candidate-images.yml') &&
        releaseHelperContent.includes('--status in_progress') &&
        releaseHelperContent.includes('--json databaseId,headSha,url')
    );
    assert.ok(
      releaseHelperContent.includes(
        'Old release-candidate workflow still in progress: run_id=${runId} sha=${headSha} url=${url ||'
      )
    );
    assert.ok(releaseHelperContent.includes('Manual cleanup command: gh run cancel ${runId}'));
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
    assert.ok(releaseHelperContent.includes('git rev-parse HEAD:upstream/openpath'));
    assert.ok(
      localContent.includes(
        'STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS="${STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS:-${STAGING_RELEASE_WAIT_TIMEOUT_SECONDS:-3600}}"'
      )
    );
    assert.ok(
      localContent.includes(
        'STAGING_RELEASE_WAIT_TIMEOUT_SECONDS="${STAGING_RELEASE_WAIT_TIMEOUT_SECONDS:-$STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS}"'
      )
    );
    assert.ok(releaseHelperContent.includes('STAGING_RELEASE_CANDIDATE_TIMEOUT_SECONDS'));
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

  test('staging deploy warns about other in-progress release-candidate runs without cancelling them', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'classroompath-gh-'));
    const fakeGhPath = resolve(tempDir, 'gh');

    writeFileSync(
      fakeGhPath,
      `#!/bin/sh
case "$*" in
  *"run list"*)
    printf '%s\\n' '[{"databaseId":12345,"headSha":"other-sha","url":"https://github.com/balejosg/ClassroomPath/actions/runs/12345"},{"databaseId":67890,"headSha":"target-sha","url":"https://github.com/balejosg/ClassroomPath/actions/runs/67890"}]'
    exit 0
    ;;
  *"run cancel"*)
    echo "cancel should not be called" >&2
    exit 99
    ;;
esac
echo "unexpected gh invocation: $*" >&2
exit 2
`
    );
    chmodSync(fakeGhPath, 0o755);

    try {
      const output = execFileSync(
        'bash',
        [
          '-c',
          `
set -euo pipefail
source "$1"
log_warn() { echo "WARN:$*"; }
warn_if_other_release_candidate_run_in_progress target-sha
`,
          'bash',
          stagingLocalReleaseHelperPath,
        ],
        {
          cwd: projectRoot,
          encoding: 'utf-8',
          env: {
            ...process.env,
            PATH: `${tempDir}:${process.env.PATH ?? ''}`,
          },
        }
      );

      assert.match(
        output,
        /WARN:Old release-candidate workflow still in progress: run_id=12345 sha=other-sha url=https:\/\/github\.com\/balejosg\/ClassroomPath\/actions\/runs\/12345/
      );
      assert.match(output, /WARN:Manual cleanup command: gh run cancel 12345/);
      assert.doesNotMatch(output, /67890/);
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
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
          'STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=${STAGING_FIREFOX_RELEASE_ARTIFACTS:-}'
        ) &&
        persistHelperContent.includes(
          'STAGING_WINDOWS_BOOTSTRAP_RESULT=${STAGING_WINDOWS_BOOTSTRAP_RESULT:-}'
        ) &&
        persistHelperContent.includes(
          'STAGING_ENROLLMENT_DOWNLOAD_RESULT=${STAGING_ENROLLMENT_DOWNLOAD_RESULT:-}'
        ) &&
        persistHelperContent.includes(
          'STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT=${STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT:-}'
        ) &&
        persistHelperContent.includes(
          'STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT=${STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT:-}'
        ) &&
        persistHelperContent.includes(
          'STAGING_FIREFOX_POLICY_RESULT=${STAGING_FIREFOX_POLICY_RESULT:-}'
        )
    );
    assert.ok(
      persistHelperContent.includes('STAGING_FIREFOX_EXTENSION_ID=') &&
        persistHelperContent.includes('STAGING_FIREFOX_RELEASE_VERSION=') &&
        persistHelperContent.includes('STAGING_FIREFOX_SIGNATURE_SOURCE=') &&
        persistHelperContent.includes('STAGING_FIREFOX_SIGNATURE_STATE=') &&
        persistHelperContent.includes('STAGING_FIREFOX_METADATA_SHA256=') &&
        persistHelperContent.includes('STAGING_FIREFOX_XPI_SHA256=')
    );
    assert.ok(
      stagingGatesHelper.includes(
        'classroompath-api test -f /openpath-firefox-release/metadata.json'
      ) &&
        stagingGatesHelper.includes(
          'classroompath-api test -f /openpath-firefox-release/openpath-firefox-extension.xpi'
        ) &&
        stagingGatesHelper.includes(
          'classroompath-api test -f /app/runtime/browser-policy-spec.json'
        )
    );
    assert.ok(
      stagingGatesHelper.includes('STAGING_REQUIRE_LIVE_WINDOWS_FIREFOX_EVIDENCE') &&
        stagingGatesHelper.includes('run_staging_enrollment_download_gate') &&
        stagingGatesHelper.includes('STAGING_ENROLLMENT_DOWNLOAD_RESULT') &&
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
      runnerContent.includes('run_smoke_subcommand "$smoke_state_file"') &&
        runnerContent.includes('run_release_gate_subcommand "$release_gate_state_file"') &&
        runnerContent.includes('wait "$smoke_pid"') &&
        runnerContent.includes('wait "$release_gate_pid"') &&
        runnerContent.includes('read_staging_state_value "$smoke_state_file" STAGING_SMOKE_RESULT'),
      'staging collect should run smoke in parallel with the release-gate/windows-bootstrap chain and merge evidence'
    );
    assert.ok(
      verifyHelperContent.includes('mark_staging_local_verification_failed()') &&
        verifyHelperContent.includes('DEPLOY_FAILURE_STAGE="verification"') &&
        verifyHelperContent.includes('FAILURE_STAGE="verification"') &&
        verifyHelperContent.includes('write_deploy_context_state "$DEPLOY_CONTEXT_FILE"'),
      'staging deploy should overwrite the remote deploy context when post-deploy verification fails'
    );
  });

  test('promotion-eligible staging deploy invalidates stale verification evidence before remote deploy', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const releaseHelperContent = readFileSync(stagingLocalReleaseHelperPath, 'utf-8');
    const runnerContent = readFileSync(stagingVerificationRunnerPath, 'utf-8');

    assert.ok(
      releaseHelperContent.includes('invalidate_staging_verification_evidence_for_release()') &&
        releaseHelperContent.includes('"$STAGING_VERIFICATION_RUNNER_PATH" invalidate') &&
        releaseHelperContent.includes('STAGING_RELEASE_SHA') &&
        releaseHelperContent.includes('UPSTREAM_OPENPATH_SHA') &&
        releaseHelperContent.includes('STAGING_IMAGE_SOURCE'),
      'staging local release helper should write pending evidence for the target release'
    );
    assert.ok(
      runnerContent.includes('run_invalidate_subcommand()') &&
        runnerContent.includes('write_staging_verification_pending_state'),
      'shared staging verification runner should expose a reusable invalidate subcommand'
    );
    assert.ok(
      localContent.includes('invalidate_staging_verification_evidence_for_release') &&
        localContent.indexOf('invalidate_staging_verification_evidence_for_release') <
          localContent.indexOf('run_staging_local_remote_deploy'),
      'stale staging verification evidence should be invalidated before the remote deploy starts'
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
        releaseStateHelper.includes('STAGING_ENROLLMENT_DOWNLOAD_RESULT') &&
        releaseStateHelper.includes('STAGING_LINUX_ENROLLMENT_SCRIPT_RESULT') &&
        releaseStateHelper.includes('STAGING_WINDOWS_ENROLLMENT_SCRIPT_RESULT') &&
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
        deployRuntimeHelper.includes('OPENPATH_FIREFOX_ASSETS_IMAGE') &&
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
    assert.ok(
      deployContextHelper.includes('release_execution_classify_and_gate_production_migrations') &&
        !deployContextHelper.includes('classify_sql_migration_file()') &&
        !deployContextHelper.includes('classify_migration_risk() {')
    );
    assert.ok(!deployRemoteScript.includes('upsert_env_file_var() {'));
    assert.ok(
      deployRemoteScript.includes('git submodule update --init --recursive --force') &&
        deployRemoteScript.includes('remote_deploy_reload_checked_out_helpers')
    );
    assert.ok(
      rollbackRemoteScript.includes('OPENPATH_FIREFOX_ASSETS_IMAGE') &&
        rollbackRemoteScript.includes('release_runtime_helper_supports_runtime_contract') &&
        rollbackRemoteScript.includes('source "$RELEASE_RUNTIME_HELPER_PATH"') &&
        rollbackRemoteScript.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_FIREFOX_RELEASE_ROOT /openpath-firefox-release'
        ) &&
        rollbackRemoteScript.includes(
          'prepare_openpath_firefox_assets_from_image "$OPENPATH_FIREFOX_ASSETS_IMAGE" "$APP_SHA"'
        )
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
    const promoteCurrentScript = readFileSync(
      resolve(projectRoot, 'scripts/promote-current-staging-candidate.sh'),
      'utf-8'
    );
    const productionHostReadinessScript = readFileSync(productionHostReadinessScriptPath, 'utf-8');
    const productionTargetPreflightScript = readFileSync(
      productionTargetPreflightScriptPath,
      'utf-8'
    );

    assert.ok(existsSync(promotionReadyScriptPath));
    assert.ok(existsSync(productionHostReadinessScriptPath));
    assert.ok(existsSync(productionTargetPreflightScriptPath));
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
    assert.ok(
      runbook.includes(
        'The public repository intentionally does not document production deployment commands or live targets.'
      )
    );
    assert.ok(secretsDoc.includes('Use `npm run verify:public-surface`'));
    assert.ok(packageJson.includes('"verify:production-host"'));
    assert.ok(packageJson.includes('"verify:production-target-ready"'));
    assert.ok(packageJson.includes('bash scripts/preflight-production-promotion-target.sh'));
    assert.ok(
      packageJson.includes('"deploy:staging:assume-yes"'),
      'package.json should expose an explicit non-interactive staging deploy command'
    );
    assert.ok(
      packageJson.includes('env DEPLOY_ASSUME_YES=1 npm run deploy:staging'),
      'deploy:staging:assume-yes should use the portable env prefix form'
    );
    assert.ok(
      promotionReadyScript.includes(
        'node "$SCRIPT_DIR/deploy-targets.mjs" get production publicUrl'
      ) &&
        promotionReadyScript.includes('DEFAULT_DEPLOY_SSH_KEY="$HOME/.ssh/classroompath_deploy"') &&
        !promotionReadyScript.includes('DEPLOY_HOST must be set before production promotion'),
      'promotion-ready should derive production host and SSH key defaults from canonical local config'
    );
    assert.ok(
      productionHostReadinessScript.includes('verify_host_arch_matches_target_platform') &&
        productionHostReadinessScript.includes('linux/arm64') &&
        productionHostReadinessScript.includes(
          'CLASSROOMPATH_DEPLOY_ROOT="${CLASSROOMPATH_DEPLOY_ROOT:-/opt/classroompath}"'
        ) &&
        productionHostReadinessScript.includes('app_dir="${deploy_root%/}/app"') &&
        productionHostReadinessScript.includes('test -d "$app_dir/.git"') &&
        productionHostReadinessScript.includes('docker compose version') &&
        productionHostReadinessScript.includes('docker info') &&
        productionHostReadinessScript.includes('current-images.env') &&
        !productionHostReadinessScript.includes('qemu-x86_64')
    );
    assert.ok(
      promotionReadyScript.includes(
        'PRODUCTION_DEPLOY_ROOT="${CLASSROOMPATH_DEPLOY_ROOT:-/opt/classroompath}"'
      ) &&
        promotionReadyScript.includes(
          'PRODUCTION_CURRENT_STATE_PATH="${PRODUCTION_DEPLOY_ROOT%/}/release-state/current-images.env"'
        ) &&
        !promotionReadyScript.includes(
          'test -f /srv/classroompath/release-state/current-images.env'
        ),
      'promotion readiness should read production release state from CLASSROOMPATH_DEPLOY_ROOT'
    );
    assert.ok(
      productionTargetPreflightScript.includes(
        'CLASSROOMPATH_DEPLOY_ROOT="${CLASSROOMPATH_DEPLOY_ROOT:-/opt/classroompath}"'
      ) &&
        productionTargetPreflightScript.includes(
          'PRODUCTION_CURRENT_STATE_PATH="${CLASSROOMPATH_DEPLOY_ROOT%/}/release-state/current-images.env"'
        ) &&
        productionTargetPreflightScript.includes(
          '"$SCRIPT_DIR/deploy-targets.mjs" get production publicUrl'
        ) &&
        productionTargetPreflightScript.includes(
          '"$SCRIPT_DIR/deploy-targets.mjs" get production gatewayHealthUrl'
        ) &&
        productionTargetPreflightScript.includes(
          '"$SCRIPT_DIR/deploy-targets.mjs" get production readyUrl'
        ) &&
        productionTargetPreflightScript.includes(
          '"$SCRIPT_DIR/deploy-targets.mjs" get production containerPlatform'
        ) &&
        productionTargetPreflightScript.includes('"${PRODUCTION_SSH_CMD[@]}" "true"') &&
        productionTargetPreflightScript.includes("test -r '$PRODUCTION_CURRENT_STATE_PATH'") &&
        productionTargetPreflightScript.includes('curl --max-time 15') &&
        productionTargetPreflightScript.includes(
          'grep -q \'require_cmd node\' "$SCRIPT_DIR/deploy-production-remote.sh"'
        ) &&
        productionTargetPreflightScript.includes('classify_migration_risk_without_node()'),
      'production target preflight should verify SSH, release-state, URLs, platform, and no-host-node deploy contract'
    );
    assert.ok(
      tagProductionScript.indexOf('bash scripts/preflight-production-promotion-target.sh') >
        tagProductionScript.indexOf('bash scripts/verify-production-promotion-ready.sh') &&
        tagProductionScript.indexOf('bash scripts/preflight-production-promotion-target.sh') <
          tagProductionScript.indexOf('git tag -a "$TAG_NAME"'),
      'manual production tagging should run production target preflight before tag creation'
    );
    assert.ok(
      promoteCurrentScript.indexOf('bash "$SCRIPT_DIR/preflight-production-promotion-target.sh"') >
        promoteCurrentScript.indexOf('bash "$SCRIPT_DIR/verify-production-promotion-ready.sh"') &&
        promoteCurrentScript.indexOf(
          'bash "$SCRIPT_DIR/preflight-production-promotion-target.sh"'
        ) < promoteCurrentScript.indexOf('git tag -a "$next_tag"'),
      'latest-only production tagging should run production target preflight before tag creation'
    );
    assert.ok(
      productionHostReadinessScript.includes(
        'DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"'
      ) && productionHostReadinessScript.includes('-F "$DEPLOY_SSH_CONFIG"'),
      'production host readiness should not depend on /etc/ssh/ssh_config.d'
    );
    assert.ok(
      productionHostReadinessScript.includes(
        'DEPLOY_HOST="${1:-${DEPLOY_HOST:-$(resolve_default_deploy_host)}}"'
      ) &&
        productionHostReadinessScript.includes(
          'DEFAULT_DEPLOY_SSH_KEY="$HOME/.ssh/classroompath_deploy"'
        ),
      'production host readiness should default to canonical production host and key when available'
    );
    assert.ok(
      promotionReadyScript.includes('STAGING_SSH_CONFIG="${STAGING_SSH_CONFIG:-/dev/null}"') &&
        promotionReadyScript.includes('DEPLOY_SSH_CONFIG="${DEPLOY_SSH_CONFIG:-/dev/null}"') &&
        promotionReadyScript.includes('-F "$STAGING_SSH_CONFIG"') &&
        promotionReadyScript.includes('-F "$DEPLOY_SSH_CONFIG"'),
      'promotion readiness should isolate both staging and production SSH clients'
    );
    assert.ok(
      promotionReadyScript.includes('git rev-parse "$TARGET_SHA:upstream/openpath"') &&
        promotionReadyScript.includes('OPENPATH_SHA="$openpath_sha"') &&
        promotionReadyScript.includes('OPENPATH_BASE_SHA="$openpath_base_sha"') &&
        promotionReadyScript.includes(
          'node "$SCRIPT_DIR/openpath-required-checks.mjs" report || true'
        ) &&
        promotionReadyScript.includes('node "$SCRIPT_DIR/openpath-required-checks.mjs" wait'),
      'promotion readiness should verify required OpenPath checks for the exact staged submodule SHA'
    );
    assert.ok(
      promotionReadyScript.indexOf('node "$SCRIPT_DIR/openpath-required-checks.mjs"') <
        promotionReadyScript.indexOf(
          'log_success "Staging release for $TARGET_SHA is promotion-ready"'
        ),
      'OpenPath required checks should pass before promotion-ready can be reported'
    );
    assert.ok(
      promotionReadyScript.includes('prepromotion-runner-rehearsal.mjs" verify') &&
        promotionReadyScript.includes('--changed-files "$openpath_changed_files_file"') &&
        promotionReadyScript.includes('--target-sha "$TARGET_SHA"'),
      'promotion readiness should enforce the selective prepromotion runner rehearsal evidence'
    );
    const stagingReleaseHelper = readFileSync(stagingLocalReleaseHelperPath, 'utf8');
    assert.ok(
      stagingReleaseHelper.includes('Promotion-eligible staging requires a clean worktree') &&
        stagingReleaseHelper.includes('resolve_active_release_fence_id "$workspace_guard"') &&
        stagingReleaseHelper.includes(
          'Promotion-eligible staging requires an active release fence id'
        ) &&
        stagingReleaseHelper.includes('release-mark-staged') &&
        stagingReleaseHelper.includes('--release-id "$STAGING_RELEASE_FENCE_ID"') &&
        stagingReleaseHelper.includes('--classroompath-sha "$REMOTE_SHA"'),
      'promotion-eligible staging should reject local dirt and mark the active release fence staged'
    );
    assert.ok(
      stagingReleaseHelper.includes(
        'local requested_staging_deployment_mode="$effective_staging_deployment_mode"'
      ) &&
        stagingReleaseHelper.includes(
          'if [ "$requested_staging_deployment_mode" = "debug" ]; then'
        ) &&
        stagingReleaseHelper.includes('STAGING_DEPLOYMENT_MODE="debug"'),
      'debug staging should preserve the requested no-fence deployment mode after rendering release candidate plans'
    );
    const tagScript = readFileSync(
      resolve(projectRoot, 'scripts/tag-production-release.sh'),
      'utf8'
    );
    assert.ok(
      tagScript.includes('release-status') &&
        tagScript.includes('resolve_active_release_fence_id "$fence_json" "$main_sha"') &&
        tagScript.includes('Release fence must be staged before production tagging') &&
        tagScript.includes('release-mark-tagged') &&
        tagScript.includes('--release-id "$release_fence_id"') &&
        tagScript.includes('--tag "$TAG_NAME"'),
      'production tagging should require a staged release fence and mark it tagged after tag creation'
    );
    assert.ok(
      existsSync(resolve(projectRoot, 'scripts/lib/github-token.sh')),
      'local deployment scripts should share the GitHub token fallback helper'
    );
    for (const [scriptName, scriptContent] of [
      ['verify-production-promotion-ready.sh', promotionReadyScript],
      [
        'tag-production-release.sh',
        readFileSync(resolve(projectRoot, 'scripts/tag-production-release.sh'), 'utf8'),
      ],
      [
        'deploy-staging-local.sh',
        readFileSync(resolve(projectRoot, 'scripts/deploy-staging-local.sh'), 'utf8'),
      ],
    ] as const) {
      assert.ok(
        scriptContent.includes('source "$SCRIPT_DIR/lib/github-token.sh"'),
        `${scriptName} should source the shared GitHub token fallback helper`
      );
      assert.ok(
        scriptContent.includes('ensure_github_token_env'),
        `${scriptName} should populate GH_TOKEN from gh auth token when needed`
      );
    }
  });

  test('latest-only promotion helper tags only the live verified staging SHA', () => {
    const helper = readFileSync(
      resolve(projectRoot, 'scripts/promote-current-staging-candidate.sh'),
      'utf-8'
    );
    const packageJson = readFileSync(resolve(projectRoot, 'package.json'), 'utf-8');
    const workflow = readFileSync(promoteCurrentStagingWorkflowPath, 'utf-8');
    const preflight = readFileSync(promoteCurrentStagingPreflightPath, 'utf-8');

    assert.ok(packageJson.includes('"promote:current-staging"'));
    assert.ok(existsSync(promoteCurrentStagingPreflightPath));
    assert.ok(workflow.includes('contents: read'));
    assert.ok(workflow.includes('actions/create-github-app-token@v3'));
    assert.ok(workflow.includes('client-id: ${{ vars.CLASSROOMPATH_PROMOTION_APP_CLIENT_ID }}'));
    assert.ok(
      workflow.includes('private-key: ${{ secrets.CLASSROOMPATH_PROMOTION_APP_PRIVATE_KEY }}')
    );
    assert.ok(workflow.includes('permission-contents: write'));
    assert.ok(workflow.includes('permission-workflows: write'));
    assert.ok(workflow.includes('persist-credentials: false'));
    assert.ok(workflow.includes('STAGING_SSH_KEY_SECRET: ${{ secrets.STAGING_DEPLOY_SSH_KEY }}'));
    assert.ok(workflow.includes('DEPLOY_SSH_KEY_SECRET: ${{ secrets.DEPLOY_SSH_KEY }}'));
    assert.ok(workflow.includes('bash scripts/preflight-current-staging-promotion.sh'));
    assert.ok(
      workflow.includes('PROMOTION_TAG_PUSH_TOKEN: ${{ steps.promotion-app-token.outputs.token }}')
    );
    assert.ok(helper.includes('cat /srv/classroompath/release-state/current-images.env'));
    assert.ok(helper.includes('cat /srv/classroompath/release-state/staging-verification.env'));
    assert.ok(helper.includes('target_sha="$(read_env_value "$current_state_file" APP_SHA)"'));
    assert.ok(helper.includes('if [ "$target_sha" != "$verified_sha" ]; then'));
    assert.ok(helper.includes('STAGING_VERIFICATION_STATE=${verification_state:-unset}'));
    assert.ok(helper.includes('IMAGE_SOURCE=${current_image_source:-unset}'));
    assert.ok(helper.includes('STAGING_VERIFIED_IMAGE_SOURCE=${verified_image_source:-unset}'));
    assert.ok(
      helper.includes('node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest') &&
        helper.includes('--sha "$target_sha"')
    );
    assert.ok(
      helper.includes(
        'TARGET_SHA="$target_sha" PROMOTION_EVIDENCE_DIR="$promotion_evidence_dir"'
      ) && helper.includes('bash "$SCRIPT_DIR/verify-production-promotion-ready.sh"')
    );
    assert.ok(helper.includes('promotion-evidence-cli.mjs'));
    assert.ok(helper.includes('git tag -a "$next_tag" "$target_sha" -F "$tag_message_file"'));
    assert.ok(helper.includes('PROMOTION_TAG_PUSH_TOKEN'));
    assert.ok(helper.includes('"refs/tags/$next_tag"'));
    assert.ok(helper.includes('git push origin "$next_tag"'));
    assert.ok(preflight.includes('cat /srv/classroompath/release-state/current-images.env'));
    assert.ok(preflight.includes('cat /srv/classroompath/release-state/staging-verification.env'));
    assert.ok(preflight.includes('"${PRODUCTION_SSH_CMD[@]}" "true"'));
    assert.ok(preflight.includes('if [ "$target_sha" != "$verified_sha" ]; then'));
    assert.ok(preflight.includes('STAGING_VERIFICATION_STATE=${verification_state:-unset}'));
    assert.ok(preflight.includes('IMAGE_SOURCE=${current_image_source:-unset}'));
    assert.ok(preflight.includes('STAGING_VERIFIED_IMAGE_SOURCE=${verified_image_source:-unset}'));
  });

  test('GitHub token helper falls back to gh auth token when env tokens are absent', () => {
    const tempDir = mkdtempSync(resolve(tmpdir(), 'classroompath-gh-token-'));
    const fakeBinDir = resolve(tempDir, 'bin');

    try {
      writeFileSync(resolve(tempDir, 'script.sh'), '');
      writeFileSync(resolve(tempDir, 'output.env'), '');
      writeFileSync(resolve(tempDir, 'err.log'), '');
      writeFileSync(resolve(tempDir, 'stdout.log'), '');
      writeFileSync(resolve(tempDir, 'status'), '');
      writeFileSync(resolve(tempDir, 'token'), 'fallback-token\n');
      writeFileSync(
        resolve(tempDir, 'common.sh'),
        readFileSync(resolve(projectRoot, 'scripts/lib/common.sh'), 'utf8')
      );
      writeFileSync(
        resolve(tempDir, 'github-token.sh'),
        readFileSync(resolve(projectRoot, 'scripts/lib/github-token.sh'), 'utf8')
      );
      execFileSync('mkdir', ['-p', fakeBinDir]);
      writeFileSync(
        resolve(fakeBinDir, 'gh'),
        `#!/usr/bin/env bash\nif [ "$1 $2" = "auth token" ]; then cat "${resolve(
          tempDir,
          'token'
        )}"; exit 0; fi\nexit 2\n`
      );
      chmodSync(resolve(fakeBinDir, 'gh'), 0o755);

      const output = execFileSync(
        'bash',
        [
          '-c',
          `set -euo pipefail; source "${resolve(tempDir, 'common.sh')}"; source "${resolve(
            tempDir,
            'github-token.sh'
          )}"; unset GH_TOKEN GITHUB_TOKEN; PATH="${fakeBinDir}:$PATH"; ensure_github_token_env; printf '%s' "$GH_TOKEN"`,
        ],
        { encoding: 'utf8' }
      );

      assert.equal(output, 'fallback-token');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
