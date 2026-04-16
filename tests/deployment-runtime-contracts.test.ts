import { describe, test } from 'node:test';
import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');

describe('Deployment runtime contracts', () => {
  const migrationsImageScriptPath = resolve(projectRoot, 'scripts/run-migrations-image.sh');
  const gatewayDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.cp-api');
  const gatewayDockerignorePath = resolve(projectRoot, 'docker/Dockerfile.cp-api.dockerignore');
  const spaDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.spa');
  const spaDockerignorePath = resolve(projectRoot, 'docker/Dockerfile.spa.dockerignore');
  const verifierDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.release-verifier');
  const stagingDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
  const stagingLocalReleaseHelperPath = resolve(
    projectRoot,
    'scripts/lib/staging-deploy-local-release.sh'
  );
  const stagingLocalRuntimeHelperPath = resolve(
    projectRoot,
    'scripts/lib/staging-deploy-local-runtime.sh'
  );
  const stagingLocalVerifyHelperPath = resolve(
    projectRoot,
    'scripts/lib/staging-deploy-local-verify.sh'
  );
  const stagingDeployRemoteScriptPath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
  const deployProductionContextHelperPath = resolve(
    projectRoot,
    'scripts/lib/deploy-production-context.sh'
  );
  const deployProductionRuntimeHelperPath = resolve(
    projectRoot,
    'scripts/lib/deploy-production-runtime.sh'
  );
  const githubActionsRemoteHelperPath = resolve(
    projectRoot,
    'scripts/lib/github-actions-remote.sh'
  );
  const deployHostPreflightHelperPath = resolve(
    projectRoot,
    'scripts/lib/deploy-host-preflight.sh'
  );
  const doctorScriptPath = resolve(projectRoot, 'scripts/doctor.sh');
  const releaseCandidateWorkflowPath = resolve(
    projectRoot,
    '.github/workflows/release-candidate-images.yml'
  );

  test('release images package the migration entrypoint and narrow Docker build inputs', () => {
    const migrationsDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.migrations');
    const openPathDbEnvHelperPath = resolve(projectRoot, 'scripts/derive-openpath-db-env.mjs');
    const migrationsDockerfile = readFileSync(migrationsDockerfilePath, 'utf-8');
    const migrationsImageScript = readFileSync(migrationsImageScriptPath, 'utf-8');
    const gatewayDockerfile = readFileSync(gatewayDockerfilePath, 'utf-8');
    const gatewayDockerignore = readFileSync(gatewayDockerignorePath, 'utf-8');
    const spaDockerfile = readFileSync(spaDockerfilePath, 'utf-8');
    const spaDockerignore = readFileSync(spaDockerignorePath, 'utf-8');
    const verifierDockerfile = readFileSync(verifierDockerfilePath, 'utf-8');

    assert.ok(existsSync(migrationsDockerfilePath));
    assert.ok(existsSync(migrationsImageScriptPath));
    assert.ok(existsSync(openPathDbEnvHelperPath));
    assert.ok(!migrationsDockerfile.includes('COPY . .'));
    assert.ok(migrationsDockerfile.includes('COPY api/drizzle ./api/drizzle'));
    assert.ok(migrationsDockerfile.includes('COPY api/scripts ./api/scripts'));
    assert.ok(migrationsDockerfile.includes('COPY api/src ./api/src'));
    assert.ok(migrationsDockerfile.includes('COPY scripts ./scripts'));
    assert.ok(
      migrationsDockerfile.includes(
        'COPY upstream/openpath/api/drizzle.config.ts ./upstream/openpath/api/drizzle.config.ts'
      )
    );
    assert.ok(
      migrationsDockerfile.includes('ENTRYPOINT ["sh", "scripts/run-migrations-image.sh"]')
    );
    assert.ok(migrationsImageScript.includes('node --import tsx api/scripts/cleanup-cp-schema.ts'));
    assert.ok(migrationsImageScript.includes('npm run db:migrate -w @classroompath/api'));
    assert.ok(migrationsImageScript.includes('npm run db:migrate -w @openpath/api'));
    assert.ok(migrationsImageScript.includes('node scripts/derive-openpath-db-env.mjs'));

    assert.ok(!gatewayDockerfile.includes('COPY . .'));
    assert.ok(gatewayDockerfile.includes('COPY api/src ./api/src'));
    assert.ok(gatewayDockerfile.includes('COPY react-spa/src ./react-spa/src'));
    assert.ok(
      gatewayDockerfile.includes(
        'COPY upstream/openpath/react-spa/src ./upstream/openpath/react-spa/src'
      )
    );
    assert.ok(gatewayDockerfile.includes('COPY contracts/package*.json ./contracts/'));
    assert.ok(gatewayDockerfile.includes('COPY presenters/package*.json ./presenters/'));
    assert.ok(gatewayDockerfile.includes('COPY contracts/src ./contracts/src'));
    assert.ok(gatewayDockerfile.includes('COPY presenters/src ./presenters/src'));
    assert.ok(
      gatewayDockerfile.includes('/app/contracts/dist ./node_modules/@classroompath/contracts/dist')
    );
    assert.ok(
      gatewayDockerfile.includes(
        '/app/presenters/dist ./node_modules/@classroompath/presenters/dist'
      )
    );
    assert.ok(gatewayDockerignore.includes('tests/**'));
    assert.ok(gatewayDockerignore.includes('react-spa/src/**/__tests__/**'));
    assert.ok(gatewayDockerignore.includes('upstream/openpath/react-spa/src/**/__tests__/**'));

    assert.ok(!spaDockerfile.includes('COPY . .'));
    assert.ok(spaDockerfile.includes('COPY react-spa/src ./react-spa/src'));
    assert.ok(
      spaDockerfile.includes(
        'COPY upstream/openpath/react-spa/src ./upstream/openpath/react-spa/src'
      )
    );
    assert.ok(spaDockerfile.includes('COPY contracts/package*.json ./contracts/'));
    assert.ok(spaDockerfile.includes('COPY contracts/src ./contracts/src'));
    assert.ok(spaDockerignore.includes('tests/**'));
    assert.ok(spaDockerignore.includes('react-spa/src/**/__tests__/**'));
    assert.ok(spaDockerignore.includes('upstream/openpath/react-spa/src/**/__tests__/**'));

    assert.ok(existsSync(verifierDockerfilePath));
    assert.ok(verifierDockerfile.includes('COPY . .'));
    assert.ok(verifierDockerfile.includes('npm ci'));
    assert.ok(verifierDockerfile.includes('--mount=type=cache,target=/root/.npm'));
    assert.ok(
      verifierDockerfile.includes('tests/release-gate.test.ts') ||
        verifierDockerfile.includes('tests/smoke.test.ts') ||
        verifierDockerfile.includes('WORKDIR /app')
    );
  });

  test('release candidate workflow publishes verifier and OpenPath version pins in the manifest artifact', () => {
    const content = readFileSync(releaseCandidateWorkflowPath, 'utf-8');

    assert.ok(content.includes('build-verifier-release-candidate'));
    assert.ok(content.includes('docker/Dockerfile.release-verifier'));
    assert.ok(content.includes('CLASSROOMPATH_VERIFIER_IMAGE='));
    assert.ok(content.includes('OPENPATH_LINUX_AGENT_VERSION='));
    assert.ok(content.includes('OPENPATH_VERSION='));
    assert.ok(content.includes('resolve-openpath-linux-agent-version.mjs'));
  });

  test('release manifest flows through staging and production as a single payload contract', () => {
    const stagingLocal = readFileSync(stagingDeployScriptPath, 'utf-8');
    const stagingLocalRelease = readFileSync(stagingLocalReleaseHelperPath, 'utf-8');
    const stagingLocalRuntime = readFileSync(stagingLocalRuntimeHelperPath, 'utf-8');
    const stagingRemote = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const productionRemote = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const workflow = readFileSync(resolve(projectRoot, '.github/workflows/deploy.yml'), 'utf-8');
    const manifestHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/release-manifest.sh'),
      'utf-8'
    );
    const deployPayloadHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/deploy-payload.mjs'),
      'utf-8'
    );
    const deployProductionContextHelper = readFileSync(deployProductionContextHelperPath, 'utf-8');
    const deployProductionRuntimeHelper = readFileSync(deployProductionRuntimeHelperPath, 'utf-8');

    assert.ok(manifestHelper.includes('decode_release_manifest_base64()'));
    assert.ok(manifestHelper.includes('export_release_manifest_runtime_env()'));
    assert.ok(manifestHelper.includes('release_manifest_validate_contract()'));
    assert.ok(manifestHelper.includes('release_manifest_is_canonical_contract()'));
    assert.ok(deployPayloadHelper.includes('export function buildDeployPayload'));
    assert.ok(deployPayloadHelper.includes('export function encodeDeployPayloadBase64'));
    assert.ok(deployPayloadHelper.includes('export function decodeDeployPayloadBase64'));
    assert.ok(
      stagingLocalRelease.includes('STAGING_RELEASE_MANIFEST_FILE=') &&
        stagingLocalRelease.includes('--output-file "$STAGING_RELEASE_MANIFEST_FILE"')
    );
    assert.ok(
      stagingLocalRelease.includes('STAGING_DEPLOY_PAYLOAD_B64=') &&
        stagingLocalRelease.includes('STAGING_DEPLOY_PAYLOAD_B64="${DEPLOY_PAYLOAD_B64:-}"') &&
        stagingLocalRuntime.includes('remote_assignment STAGING_DEPLOY_PAYLOAD_B64')
    );
    assert.ok(
      stagingRemote.includes('decode_deploy_payload_base64 "$STAGING_DEPLOY_PAYLOAD_B64"') &&
        stagingRemote.includes(
          'payload_image_source="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" image_source)"'
        ) &&
        stagingRemote.includes(
          'payload_deployment_mode="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" deployment_mode)"'
        ) &&
        stagingRemote.includes(
          'release_manifest_b64="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" manifest_base64)"'
        ) &&
        stagingRemote.includes('source "$RELEASE_MANIFEST_HELPER_PATH"') &&
        stagingRemote.includes('load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"') &&
        stagingRemote.includes('ensure_staging_release_candidate_runtime_env || return 1')
    );
    assert.ok(
      workflow.includes('payload_base64: ${{ steps.deploy-payload.outputs.payload_base64 }}')
    );
    assert.ok(
      workflow.includes(
        'DEPLOY_PAYLOAD_B64: ${{ needs.resolve-release-images.outputs.payload_base64 }}'
      ) && workflow.includes('envs: GHCR_USERNAME,GHCR_TOKEN,DEPLOY_PAYLOAD_B64')
    );
    assert.ok(
      productionRemote.includes('decode_deploy_payload_base64 "$DEPLOY_PAYLOAD_B64"') &&
        productionRemote.includes(
          'payload_image_source="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" image_source)"'
        ) &&
        productionRemote.includes(
          'payload_deployment_mode="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" deployment_mode)"'
        ) &&
        productionRemote.includes(
          'release_manifest_b64="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" manifest_base64)"'
        ) &&
        productionRemote.includes(
          'Production deploy payload must resolve immutable release-candidate images'
        ) &&
        productionRemote.includes('source "$RELEASE_MANIFEST_HELPER_PATH"') &&
        deployProductionContextHelper.includes(
          'load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"'
        ) &&
        deployProductionRuntimeHelper.includes(
          'ensure_production_release_candidate_runtime_env || return 1'
        ) &&
        deployProductionRuntimeHelper.includes('RELEASE_MANIFEST_B64_FROM_PAYLOAD') &&
        deployProductionRuntimeHelper.includes(
          'decode_release_manifest_base64 "$release_manifest_b64" "$RELEASE_MANIFEST_FILE"'
        ) &&
        deployProductionRuntimeHelper.includes(
          'OPENPATH_VERSION="$(release_manifest_require_key "$RELEASE_MANIFEST_FILE" openpath_version)"'
        ) &&
        deployProductionRuntimeHelper.includes(
          'OPENPATH_LINUX_AGENT_VERSION="$(release_manifest_require_key "$RELEASE_MANIFEST_FILE" linux_agent_version)"'
        )
    );
  });

  test('release runtime and state helpers stay centralized behind shared scaffold and contract helpers', () => {
    const releaseStateHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/release-state.sh'),
      'utf-8'
    );
    const releaseStateContract = readFileSync(
      resolve(projectRoot, 'scripts/lib/release-state-contract.mjs'),
      'utf-8'
    );
    const remoteDeployScaffoldHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/remote-deploy-scaffold.sh'),
      'utf-8'
    );
    const remoteHelperContracts = readFileSync(
      resolve(projectRoot, 'scripts/lib/remote-helper-contracts.sh'),
      'utf-8'
    );
    const deploymentStateHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/deployment-state.sh'),
      'utf-8'
    );
    const releaseRuntimeHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/release-runtime.sh'),
      'utf-8'
    );
    const stagingRemote = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const productionRemote = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const persistVerification = readFileSync(
      resolve(projectRoot, 'scripts/persist-staging-verification-remote.sh'),
      'utf-8'
    );
    const verifyState = readFileSync(
      resolve(projectRoot, 'scripts/verify-staging-release-state.sh'),
      'utf-8'
    );
    const rollbackRemote = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );
    const githubActionsRemoteHelper = readFileSync(githubActionsRemoteHelperPath, 'utf-8');

    assert.ok(
      releaseStateHelper.includes('load_release_state_env()') &&
        releaseStateHelper.includes('write_release_state_snapshot()') &&
        releaseStateHelper.includes('write_current_release_state()') &&
        releaseStateHelper.includes('write_deploy_context_state()') &&
        releaseStateHelper.includes('write_staging_verification_state()') &&
        !releaseStateHelper.includes('release_state_fields()') &&
        releaseStateHelper.includes('release_state_cli_available()')
    );
    assert.ok(
      releaseStateContract.includes('RELEASE_STATE_SNAPSHOT_DEFINITIONS') &&
        releaseStateContract.includes('validateCurrentReleaseState(') &&
        releaseStateContract.includes('validateStagingVerification(') &&
        releaseStateContract.includes('buildStagingReleaseEvidenceOutputs(')
    );
    assert.ok(
      remoteDeployScaffoldHelper.includes('remote_deploy_init_base_helper_paths()') &&
        remoteDeployScaffoldHelper.includes('remote_deploy_init_production_helper_paths()') &&
        remoteDeployScaffoldHelper.includes('remote_deploy_reload_checked_out_helpers()')
    );
    assert.ok(
      remoteHelperContracts.includes('remote_helper_contract_version()') &&
        remoteHelperContracts.includes('remote_helper_contract_version_at_least()') &&
        remoteHelperContracts.includes('RELEASE_MANIFEST_HELPER_MIN_CONTRACT_VERSION=') &&
        remoteHelperContracts.includes('RELEASE_STATE_RUNTIME_MIN_CONTRACT_VERSION=') &&
        remoteHelperContracts.includes(
          'RELEASE_STATE_STAGING_VERIFICATION_MIN_CONTRACT_VERSION='
        ) &&
        remoteHelperContracts.includes('DEPLOYMENT_STATE_HELPER_MIN_CONTRACT_VERSION=') &&
        remoteHelperContracts.includes('RELEASE_RUNTIME_HELPER_MIN_CONTRACT_VERSION=')
    );
    assert.ok(
      deploymentStateHelper.includes('deployment_state_init_paths()') &&
        deploymentStateHelper.includes('DEPLOYMENT_STATE_HELPER_CONTRACT_VERSION=') &&
        deploymentStateHelper.includes('deployment_state_capture_previous_release()') &&
        deploymentStateHelper.includes('deployment_state_activate_previous_release()')
    );
    assert.ok(
      releaseRuntimeHelper.includes('RELEASE_RUNTIME_HELPER_CONTRACT_VERSION=') &&
        releaseRuntimeHelper.includes('load_release_manifest_runtime()') &&
        releaseRuntimeHelper.includes('write_release_runtime_state()')
    );
    assert.ok(
      githubActionsRemoteHelper.includes('github_actions_remote_write_resolved_host_outputs()') &&
        githubActionsRemoteHelper.includes('github_actions_remote_install_ssh_key()') &&
        githubActionsRemoteHelper.includes('github_actions_remote_read_env_key()') &&
        githubActionsRemoteHelper.includes('github_actions_remote_read_file()')
    );
    assert.ok(
      stagingRemote.includes('REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH') &&
        stagingRemote.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        stagingRemote.includes(
          'release_manifest_helper_supports_contract "$RELEASE_MANIFEST_HELPER_PATH"'
        ) &&
        stagingRemote.includes(
          'release_state_helper_supports_runtime_contract "$RELEASE_STATE_HELPER_PATH"'
        ) &&
        stagingRemote.includes('remote_deploy_reload_checked_out_helpers')
    );
    assert.ok(
      productionRemote.includes('REMOTE_DEPLOY_SCAFFOLD_HELPER_PATH') &&
        productionRemote.includes('DEPLOYMENT_STATE_HELPER_PATH') &&
        productionRemote.includes(
          'deployment_state_helper_supports_contract "$DEPLOYMENT_STATE_HELPER_PATH"'
        ) &&
        productionRemote.includes('write_release_runtime_state')
    );
    assert.ok(
      persistVerification.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        persistVerification.includes(
          'release_state_helper_supports_staging_verification_contract "$RELEASE_STATE_HELPER_PATH"'
        ) &&
        persistVerification.includes('STAGING_VERIFICATION_RUNNER_PATH') &&
        persistVerification.includes('persist-evidence')
    );
    assert.ok(
      readFileSync(stagingLocalVerifyHelperPath, 'utf-8').includes(
        'remote_assignment STAGING_SMOKE_RESULT "$STAGING_SMOKE_RESULT"'
      ) &&
        readFileSync(stagingLocalVerifyHelperPath, 'utf-8').includes(
          'remote_assignment STAGING_RELEASE_GATE_RESULT "$STAGING_RELEASE_GATE_RESULT"'
        )
    );
    assert.ok(
      rollbackRemote.includes('DEPLOYMENT_STATE_HELPER_PATH') &&
        rollbackRemote.includes('deployment_state_activate_previous_release') &&
        rollbackRemote.includes('deployment_state_load_context') &&
        rollbackRemote.includes('remote_deploy_reload_checked_out_helpers') &&
        !rollbackRemote.includes('upsert_env_file_var() {')
    );
    assert.ok(
      verifyState.includes('release-state-cli.mjs') &&
        verifyState.includes('--current ./staging-release-state.env') &&
        verifyState.includes('--verification ./staging-verification.env') &&
        verifyState.includes('--report-json ./staging-promotion-eligibility.json')
    );
  });

  test('staging and production remote deploys keep explicit phase order and split planning from side effects', () => {
    const stagingRemote = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const productionRemote = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const deployHostPreflightHelper = readFileSync(deployHostPreflightHelperPath, 'utf-8');
    const doctor = readFileSync(doctorScriptPath, 'utf-8');
    const productionContextHelper = readFileSync(deployProductionContextHelperPath, 'utf-8');
    const productionRuntimeHelper = readFileSync(deployProductionRuntimeHelperPath, 'utf-8');
    const productionPhaseSequence = [
      'run_remote_deploy_phases \\',
      '  load_production_deploy_payload \\',
      '  prepare_production_checkout \\',
      '  load_production_release_manifest \\',
      '  classify_production_migration_risk \\',
      '  cleanup_production_disk_if_needed \\',
      '  run_production_database_migrations \\',
      '  start_production_runtime \\',
      '  wait_for_production_runtime_readiness',
    ].join('\n');

    assert.ok(existsSync(deployHostPreflightHelperPath));
    assert.ok(deployHostPreflightHelper.includes('cleanup_docker_disk_if_needed()'));
    assert.ok(
      stagingRemote.includes('source "$DEPLOY_HOST_PREFLIGHT_HELPER_PATH"') &&
        productionRemote.includes('source "$DEPLOY_HOST_PREFLIGHT_HELPER_PATH"')
    );
    assert.ok(
      doctor.includes('source "$SCRIPT_DIR/lib/deploy-host-preflight.sh"') &&
        doctor.includes('Remote disk usage:')
    );

    assert.ok(
      stagingRemote.includes('prepare_staging_checkout()') &&
        stagingRemote.includes('run_staging_runtime_validation()') &&
        stagingRemote.includes('run_staging_email_delivery_preflight()') &&
        stagingRemote.includes('run_staging_preflight_checks()') &&
        stagingRemote.includes(
          'run_remote_deploy_phase_group staging-preflight run_staging_runtime_validation run_staging_email_delivery_preflight'
        ) &&
        stagingRemote.includes('cleanup_staging_disk_if_needed()') &&
        stagingRemote.includes('run_staging_database_migrations()') &&
        stagingRemote.includes('start_staging_runtime()') &&
        stagingRemote.includes('wait_for_staging_runtime_readiness()')
    );
    assert.ok(
      stagingRemote.includes('plan_staging_runtime_deploy()') &&
        stagingRemote.includes('apply_staging_runtime_deploy()') &&
        stagingRemote.indexOf('plan_staging_runtime_deploy') <
          stagingRemote.indexOf('apply_staging_runtime_deploy')
    );
    assert.ok(
      stagingRemote.includes('compose_up_force_recreate_no_build()') &&
        stagingRemote.includes(
          'docker compose reported a stale container reference; retrying once after cleanup...'
        )
    );

    assert.ok(
      productionRemote.includes('DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH') &&
        productionRemote.includes('DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH') &&
        productionRemote.includes('source "$DEPLOY_PRODUCTION_CONTEXT_HELPER_PATH"') &&
        productionRemote.includes('source "$DEPLOY_PRODUCTION_RUNTIME_HELPER_PATH"')
    );
    assert.ok(
      productionContextHelper.includes('classify_production_migration_risk_impl()') &&
        productionContextHelper.includes('load_production_release_manifest_impl()')
    );
    assert.ok(
      productionRemote.includes('run_production_database_migrations()') &&
        productionRuntimeHelper.includes('wait_for_production_runtime_readiness_impl()')
    );
    assert.ok(productionRemote.includes(productionPhaseSequence));
  });
});
