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
  const verifierDockerignorePath = resolve(
    projectRoot,
    'docker/Dockerfile.release-verifier.dockerignore'
  );
  const stagingDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
  const commonHelperPath = resolve(projectRoot, 'scripts/lib/common.sh');
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
  const deployContainerPlatformHelperPath = resolve(
    projectRoot,
    'scripts/lib/deploy-container-platform.sh'
  );
  const doctorScriptPath = resolve(projectRoot, 'scripts/doctor.sh');
  const releaseCandidateWorkflowPath = resolve(
    projectRoot,
    '.github/workflows/release-candidate-images.yml'
  );
  const productionDeployWorkflowPath = resolve(projectRoot, '.github/workflows/deploy.yml');
  const productionPromotionReadyScriptPath = resolve(
    projectRoot,
    'scripts/verify-production-promotion-ready.sh'
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
    const verifierDockerignore = readFileSync(verifierDockerignorePath, 'utf-8');

    assert.ok(existsSync(migrationsDockerfilePath));
    assert.ok(existsSync(migrationsImageScriptPath));
    assert.ok(existsSync(openPathDbEnvHelperPath));
    assert.ok(!migrationsDockerfile.includes('COPY . .'));
    assert.ok(migrationsDockerfile.includes('COPY --chown=node:node api/drizzle ./api/drizzle'));
    assert.ok(migrationsDockerfile.includes('COPY --chown=node:node api/scripts ./api/scripts'));
    assert.ok(migrationsDockerfile.includes('COPY --chown=node:node api/src ./api/src'));
    assert.ok(migrationsDockerfile.includes('COPY --chown=node:node scripts ./scripts'));
    assert.ok(
      migrationsDockerfile.includes(
        'COPY --chown=node:node upstream/openpath/api/drizzle.config.ts ./upstream/openpath/api/drizzle.config.ts'
      )
    );
    assert.ok(
      migrationsDockerfile.includes('ENTRYPOINT ["sh", "scripts/run-migrations-image.sh"]')
    );
    assert.ok(migrationsImageScript.includes('node --import tsx api/scripts/cleanup-cp-schema.ts'));
    assert.ok(migrationsImageScript.includes('npm run db:migrate -w @classroompath/api'));
    assert.ok(migrationsImageScript.includes('npm run db:migrate -w @openpath/api'));
    assert.ok(migrationsImageScript.includes('node scripts/derive-openpath-db-env.mjs'));
    assert.ok(
      migrationsImageScript.includes('--confirm-windows-offline-installer-legacy-retirement'),
      'the migrations image must expose the explicit legacy-retirement confirmation'
    );

    assert.ok(!gatewayDockerfile.includes('COPY . .'));
    assert.ok(gatewayDockerfile.includes('COPY api/src ./api/src'));
    assert.ok(gatewayDockerfile.includes('COPY react-spa/src ./react-spa/src'));
    assert.doesNotMatch(gatewayDockerfile, /windows-offline-installer/u);
    assert.doesNotMatch(gatewayDockerfile, /OpenPath-Windows-Setup-Template\.exe/);
    assert.ok(
      gatewayDockerfile.includes(
        'HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:3001/cp/ready || exit 1'
      )
    );
    assert.ok(
      gatewayDockerfile.includes(
        'COPY upstream/openpath/react-spa/src ./upstream/openpath/react-spa/src'
      )
    );
    assert.ok(
      gatewayDockerfile.includes(
        'COPY upstream/openpath/react-spa/public-i18n.ts ./upstream/openpath/react-spa/public-i18n.ts'
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
    assert.ok(
      gatewayDockerfile.includes(
        'COPY config/runtime-environment-policy.catalog.json ./config/runtime-environment-policy.catalog.json'
      )
    );
    assert.ok(gatewayDockerignore.includes('tests/**'));
    assert.ok(gatewayDockerignore.includes('react-spa/src/**/__tests__/**'));
    assert.ok(gatewayDockerignore.includes('upstream/openpath/react-spa/src/**/__tests__/**'));

    assert.ok(!spaDockerfile.includes('COPY . .'));
    assert.ok(
      spaDockerfile.includes(
        'HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1'
      )
    );
    assert.ok(spaDockerfile.includes('COPY react-spa/src ./react-spa/src'));
    assert.ok(
      spaDockerfile.includes(
        'COPY upstream/openpath/react-spa/src ./upstream/openpath/react-spa/src'
      )
    );
    assert.ok(
      spaDockerfile.includes(
        'COPY upstream/openpath/react-spa/public-i18n.ts ./upstream/openpath/react-spa/public-i18n.ts'
      )
    );
    assert.ok(spaDockerfile.includes('COPY contracts/package*.json ./contracts/'));
    assert.ok(spaDockerfile.includes('COPY contracts/src ./contracts/src'));
    assert.ok(spaDockerignore.includes('tests/**'));
    assert.ok(spaDockerignore.includes('react-spa/src/**/__tests__/**'));
    assert.ok(spaDockerignore.includes('upstream/openpath/react-spa/src/**/__tests__/**'));

    assert.ok(existsSync(verifierDockerfilePath));
    assert.ok(verifierDockerfile.includes('ARG NODE_IMAGE=node:20-bookworm-slim@sha256:'));
    assert.ok(verifierDockerfile.includes('COPY --chown=node:node . .'));
    assert.ok(!verifierDockerfile.includes('chown -R node:node /app'));
    assert.ok(!verifierDockerfile.includes('/ms-playwright /app'));
    assert.ok(verifierDockerfile.includes('npm ci'));
    assert.ok(verifierDockerfile.includes('--mount=type=cache,target=/root/.npm'));
    assert.ok(verifierDockerfile.includes('npx playwright install --with-deps chromium'));
    assert.ok(verifierDockerignore.includes('scripts/**'));
    assert.ok(verifierDockerignore.includes('tests/**'));
    assert.ok(verifierDockerignore.includes('!tests/smoke.test.ts'));
    assert.ok(verifierDockerignore.includes('!tests/release-gate.test.ts'));
    assert.ok(verifierDockerignore.includes('!tests/release-gate-policy.ts'));
    assert.ok(verifierDockerignore.includes('!tests/helpers/resolved-fetch.ts'));
    assert.ok(verifierDockerignore.includes('!tests/helpers/release-gate-client.ts'));
    assert.ok(verifierDockerignore.includes('!tests/helpers/trpc-envelope.ts'));
    assert.ok(
      verifierDockerfile.includes('tests/release-gate.test.ts') ||
        verifierDockerfile.includes('tests/smoke.test.ts') ||
        verifierDockerfile.includes('WORKDIR /app')
    );
  });

  test('release candidate workflow publishes the verifier and exact Release Bundle v2 artifact', () => {
    const content = readFileSync(releaseCandidateWorkflowPath, 'utf-8');

    assert.ok(content.includes('build-verifier-release-candidate'));
    assert.ok(content.includes('build-openpath-firefox-assets-release-candidate'));
    assert.ok(content.includes('docker/Dockerfile.openpath-firefox-assets'));
    assert.ok(content.includes('OPENPATH_FIREFOX_ASSETS_IMAGE:'));
    assert.ok(content.includes('docker/Dockerfile.release-verifier'));
    assert.ok(content.includes('CLASSROOMPATH_VERIFIER_IMAGE:'));
    assert.ok(content.includes('node scripts/release-bundle.mjs build'));
    assert.ok(content.includes('node scripts/release-bundle.mjs verify'));
    assert.ok(content.includes('release-bundle-${{ github.sha }}'));
    assert.ok(content.includes('openpath-promotion-contract-${{ github.sha }}'));
    assert.ok(!content.includes('resolve-openpath-linux-agent-version.mjs'));
  });

  test('release manifest flows through staging and production as a single payload contract', () => {
    const stagingLocal = readFileSync(stagingDeployScriptPath, 'utf-8');
    const commonHelper = readFileSync(commonHelperPath, 'utf-8');
    const stagingLocalRelease = readFileSync(stagingLocalReleaseHelperPath, 'utf-8');
    const stagingLocalRuntime = readFileSync(stagingLocalRuntimeHelperPath, 'utf-8');
    const stagingRemote = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const productionRemote = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const workflow = readFileSync(productionDeployWorkflowPath, 'utf-8');
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
    const deployHostPreflightHelper = readFileSync(deployHostPreflightHelperPath, 'utf-8');
    const releaseRuntimeHelper = readFileSync(
      resolve(projectRoot, 'scripts/lib/release-runtime.sh'),
      'utf-8'
    );
    const dockerCompose = readFileSync(resolve(projectRoot, 'docker/docker-compose.yml'), 'utf-8');
    const deployContainerPlatformHelper = readFileSync(deployContainerPlatformHelperPath, 'utf-8');
    const verifyProductionPromotionReadyScript = readFileSync(
      productionPromotionReadyScriptPath,
      'utf-8'
    );
    const syncBillingEnvScript = readFileSync(
      resolve(projectRoot, 'scripts/sync-billing-env.sh'),
      'utf-8'
    );

    assert.ok(manifestHelper.includes('decode_release_manifest_base64()'));
    assert.ok(manifestHelper.includes('export_release_manifest_runtime_env()'));
    assert.ok(manifestHelper.includes('openpath_firefox_assets_image'));
    assert.ok(manifestHelper.includes('OPENPATH_FIREFOX_ASSETS_IMAGE'));
    assert.ok(manifestHelper.includes('release_manifest_validate_contract()'));
    assert.ok(manifestHelper.includes('release_manifest_is_canonical_contract()'));
    for (const pinName of [
      'OPENPATH_LINUX_AGENT_APT_SUITE',
      'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION',
      'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT',
      'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_RELEASE_TAG',
      'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256',
    ]) {
      assert.ok(
        stagingRemote.includes(pinName),
        `staging runtime must preserve ${pinName} from the release manifest`
      );
      assert.ok(
        productionRemote.includes(pinName) || deployProductionRuntimeHelper.includes(pinName),
        `production runtime must preserve ${pinName} from the release manifest`
      );
    }
    assert.ok(
      dockerCompose.includes(
        'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION=${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_VERSION:?'
      ) &&
        dockerCompose.includes(
          'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT=${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_COMMIT:?'
        ) &&
        dockerCompose.includes(
          'OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256=${OPENPATH_WINDOWS_OFFLINE_TEMPLATE_SHA256:?'
        ),
      'OpenPath runtime must receive all template pin fields explicitly'
    );
    assert.ok(
      !deployHostPreflightHelper.includes('provision_windows_offline_installer_template') &&
        !deployHostPreflightHelper.includes('windows-offline-installer-template-path'),
      'ClassroomPath deploy preflight must not own OpenPath template provisioning'
    );
    assert.ok(deployPayloadHelper.includes('export function buildDeployPayload'));
    assert.ok(deployPayloadHelper.includes('export function encodeDeployPayloadBase64'));
    assert.ok(deployPayloadHelper.includes('export function decodeDeployPayloadBase64'));
    assert.ok(
      stagingLocalRelease.includes('STAGING_RELEASE_MANIFEST_FILE=') &&
        stagingLocalRelease.includes('STAGING_RELEASE_BUNDLE_FILE=') &&
        stagingLocalRelease.includes('--output-file "$STAGING_RELEASE_BUNDLE_RUNTIME_FILE"') &&
        stagingLocalRelease.includes('--output-dir "$STAGING_RELEASE_BUNDLE_DIR"') &&
        stagingLocalRelease.includes('resolve-bundle')
    );
    assert.ok(
      stagingLocalRelease.includes('STAGING_DEPLOY_PAYLOAD_B64=') &&
        stagingLocalRelease.includes('STAGING_DEPLOY_PAYLOAD_B64="${DEPLOY_PAYLOAD_B64:-}"') &&
        commonHelper.includes('remote_assignment()') &&
        stagingLocalRuntime.includes('remote_assignment STAGING_DEPLOY_PAYLOAD_B64') &&
        stagingLocalRuntime.includes('remote_assignment STAGING_RELEASE_BUNDLE_B64') &&
        stagingLocalRuntime.includes('remote_assignment STAGING_OPENPATH_CONTRACT_B64') &&
        !stagingLocalRuntime.includes('remote_assignment() {') &&
        stagingLocalRuntime.includes('remote_assignment STAGING_CONTAINER_PLATFORM') &&
        stagingLocalRuntime.includes('remote_assignment STAGING_PUBLIC_URL')
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
          'release_bundle_b64="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" release_bundle_base64 || true)"'
        ) &&
        stagingRemote.includes(
          'openpath_contract_b64="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" openpath_contract_base64 || true)"'
        ) &&
        stagingRemote.includes('upsert_env_file_var "$APP_DIR/config/.env" PUBLIC_URL') &&
        stagingRemote.includes('upsert_env_file_var "$APP_DIR/config/.env" CORS_ORIGINS') &&
        stagingRemote.includes(
          'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_FIREFOX_EXTENSION_INSTALL_URL'
        ) &&
        stagingRemote.includes('deploy-targets.mjs" get staging canaryPublicUrl') &&
        stagingRemote.includes('node "$APP_DIR/scripts/release-bundle.mjs" verify') &&
        stagingRemote.includes('Promotion-eligible staging requires an exact Release Bundle v2') &&
        stagingRemote.includes('ensure_staging_release_candidate_runtime_env || return 1') &&
        stagingRemote.includes('prepare_openpath_firefox_assets_from_image') &&
        releaseRuntimeHelper.includes('docker pull "$image_ref"') &&
        releaseRuntimeHelper.includes('chmod 755 "$tmp_dir"') &&
        releaseRuntimeHelper.includes('chmod 644 "$tmp_dir/metadata.json"') &&
        releaseRuntimeHelper.includes('chmod 644 "$tmp_dir/openpath-firefox-extension.xpi"') &&
        releaseRuntimeHelper.includes(
          'docker cp "$assets_container:/openpath-firefox-release/metadata.json"'
        ) &&
        stagingRemote.includes('source "$DEPLOY_CONTAINER_PLATFORM_HELPER_PATH"') &&
        stagingRemote.includes(
          'configure_deploy_container_platform "${STAGING_CONTAINER_PLATFORM:-linux/amd64}"'
        ) &&
        stagingRemote.includes('verify_deploy_container_platform')
    );
    assert.ok(
      workflow.includes('payload_base64: ${{ steps.deploy-payload.outputs.payload_base64 }}')
    );
    assert.ok(
      workflow.includes(
        'DEPLOY_PAYLOAD_B64: ${{ needs.resolve-release-images.outputs.payload_base64 }}'
      ) &&
        workflow.includes(
          'PRODUCTION_CONTAINER_PLATFORM: ${{ needs.resolve-release-images.outputs.production_container_platform }}'
        ) &&
        workflow.includes('VAPID_PUBLIC_KEY: ${{ secrets.VAPID_PUBLIC_KEY }}') &&
        workflow.includes('VAPID_PRIVATE_KEY: ${{ secrets.VAPID_PRIVATE_KEY }}') &&
        workflow.includes('VAPID_CONTACT: ${{ secrets.VAPID_CONTACT }}') &&
        workflow.includes('envs: GHCR_USERNAME,GHCR_TOKEN,DEPLOY_PAYLOAD_B64') &&
        workflow.includes('PRODUCTION_CONTAINER_PLATFORM') &&
        workflow.includes('VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY,VAPID_CONTACT') &&
        workflow.includes("SMOKE_REQUIRE_PUSH: '1'")
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
          'release_bundle_b64="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" release_bundle_base64 || true)"'
        ) &&
        productionRemote.includes(
          'openpath_contract_b64="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" openpath_contract_base64 || true)"'
        ) &&
        productionRemote.includes(
          'Production deploy payload must resolve immutable release-candidate images'
        ) &&
        deployProductionContextHelper.includes('release-bundle.mjs" verify') &&
        deployProductionContextHelper.includes('Verified Release Bundle OpenPath SHA') &&
        deployProductionRuntimeHelper.includes(
          'ensure_production_release_candidate_runtime_env || return 1'
        ) &&
        deployProductionRuntimeHelper.includes('prepare_openpath_firefox_assets_from_image') &&
        releaseRuntimeHelper.includes('docker pull "$image_ref"') &&
        releaseRuntimeHelper.includes(
          '${OPENPATH_FIREFOX_RELEASE_HOST_ROOT:-${CLASSROOMPATH_DEPLOY_ROOT:-/srv/classroompath}/openpath-firefox-release}'
        ) &&
        releaseRuntimeHelper.includes(
          'docker cp "$assets_container:/openpath-firefox-release/openpath-firefox-extension.xpi"'
        ) &&
        deployProductionRuntimeHelper.includes('RELEASE_ID') &&
        deployProductionRuntimeHelper.includes('deployment_state_persist_v2_release') &&
        workflow.includes('node scripts/verify-openpath-promotion-contract.mjs') &&
        verifyProductionPromotionReadyScript.includes(
          'node "$SCRIPT_DIR/verify-openpath-promotion-contract.mjs"'
        ) &&
        productionRemote.includes('source "$DEPLOY_CONTAINER_PLATFORM_HELPER_PATH"') &&
        deployProductionRuntimeHelper.includes(
          'configure_deploy_container_platform "${PRODUCTION_CONTAINER_PLATFORM:-linux/amd64}"'
        ) &&
        deployProductionRuntimeHelper.includes('verify_deploy_container_platform') &&
        deployProductionRuntimeHelper.includes('CP_REQUIRE_PUSH_NOTIFICATIONS=1') &&
        syncBillingEnvScript.includes('runtime_policy_names push-env-names') &&
        syncBillingEnvScript.includes('readarray -t push_vars') &&
        syncBillingEnvScript.includes('for name in "${push_vars[@]}"') &&
        syncBillingEnvScript.includes('upsert_env_var "$ENV_FILE" "$name" "${!name}"') &&
        syncBillingEnvScript.includes('VAPID_SUBJECT')
    );
    assert.ok(
      dockerCompose.includes('OPENPATH_FIREFOX_RELEASE_ROOT=/openpath-firefox-release') &&
        dockerCompose.includes(
          'OPENPATH_FIREFOX_EXTENSION_INSTALL_URL=${OPENPATH_FIREFOX_EXTENSION_INSTALL_URL:-}'
        ) &&
        dockerCompose.includes(
          '${OPENPATH_FIREFOX_RELEASE_DIR:-/srv/classroompath/openpath-firefox-release/current}:/openpath-firefox-release:ro'
        ),
      'OpenPath API runtime should consume the separately published Firefox assets image through a read-only mount'
    );
    assert.ok(
      deployContainerPlatformHelper.includes('configure_deploy_container_platform()') &&
        deployContainerPlatformHelper.includes('verify_deploy_container_platform()') &&
        deployContainerPlatformHelper.includes('DOCKER_DEFAULT_PLATFORM') &&
        deployContainerPlatformHelper.includes('CLASSROOMPATH_CONTAINER_PLATFORM')
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
    const productionRuntimeHelper = readFileSync(deployProductionRuntimeHelperPath, 'utf-8');

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
      productionRemote.includes(
        'CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA="${CP_EMAIL_PREFLIGHT_ALLOW_DAILY_QUOTA:-0}"'
      ) &&
        productionRemote.includes(
          'CP_EMAIL_PREFLIGHT_MODE="${CP_EMAIL_PREFLIGHT_MODE:-required}"'
        ) &&
        productionRemote.includes('bash scripts/check-email-delivery-docker.sh'),
      'production email delivery preflight must propagate the risk-gated quota policy into Docker'
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
        releaseRuntimeHelper.includes('write_release_runtime_state()') &&
        releaseRuntimeHelper.includes('require_openpath_linux_agent_runtime_pin()') &&
        releaseRuntimeHelper.includes('CLASSROOMPATH_VERIFIER_IMAGE="$verifier_image"') &&
        releaseRuntimeHelper.includes('RC_RUN_ID="$rc_run_id"') &&
        releaseStateHelper.includes('STAGING_VERIFIED_VERIFIER_IMAGE')
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
        productionRemote.includes('write_release_runtime_state') &&
        productionRuntimeHelper.includes('"$CLASSROOMPATH_VERIFIER_IMAGE"') &&
        productionRuntimeHelper.includes('"$RC_RUN_ID"')
    );
    assert.ok(
      persistVerification.includes('REMOTE_HELPER_CONTRACTS_PATH') &&
        persistVerification.includes(
          'release_state_helper_supports_staging_verification_contract "$RELEASE_STATE_HELPER_PATH"'
        ) &&
        persistVerification.includes('STAGING_VERIFICATION_RUNNER_PATH') &&
        persistVerification.includes('persist-evidence') &&
        persistVerification.includes('STAGING_SMOKE_RESULT=${STAGING_SMOKE_RESULT:-}') &&
        persistVerification.includes('STAGING_SMOKE_STATUS=${STAGING_SMOKE_STATUS:-}') &&
        persistVerification.includes('STAGING_RELEASE_GATE_RESULT=${STAGING_RELEASE_GATE_RESULT:-}')
    );
    assert.ok(
      readFileSync(stagingLocalVerifyHelperPath, 'utf-8').includes(
        'remote_assignment STAGING_SMOKE_RESULT "${STAGING_SMOKE_RESULT:-}"'
      ) &&
        readFileSync(stagingLocalVerifyHelperPath, 'utf-8').includes(
          'remote_assignment STAGING_RELEASE_GATE_RESULT "${STAGING_RELEASE_GATE_RESULT:-}"'
        )
    );
    assert.ok(
      !readFileSync(stagingLocalVerifyHelperPath, 'utf-8').includes(
        'STAGING_FIREFOX_XPI_SHA256 "${STAGING_FIREFOX_XPI_SHA256:-}")\n$(remote_assignment STAGING_LINUX_BOOTSTRAP_RESULT'
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
    assert.doesNotMatch(deployHostPreflightHelper, /provision_windows_offline_installer_template/u);
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
        stagingRemote.includes('login_staging_registry()') &&
        stagingRemote.includes('preflight_staging_release_candidate_images()') &&
        stagingRemote.includes('preflight_staging_release_candidate_image()') &&
        stagingRemote.includes('run_staging_runtime_validation()') &&
        stagingRemote.includes('run_staging_email_delivery_preflight()') &&
        stagingRemote.includes('run_staging_preflight_checks()') &&
        stagingRemote.includes(
          'run_remote_deploy_phase_group staging-preflight run_staging_runtime_validation run_staging_email_delivery_preflight'
        ) &&
        stagingRemote.includes('login_staging_release_candidate_registry()') &&
        stagingRemote.includes('cleanup_staging_disk_if_needed()') &&
        stagingRemote.includes('run_staging_database_migrations()') &&
        stagingRemote.includes('start_staging_runtime()') &&
        stagingRemote.includes('wait_for_staging_runtime_readiness()')
    );
    const prepareStagingCheckout = stagingRemote.slice(
      stagingRemote.indexOf('prepare_staging_checkout()'),
      stagingRemote.indexOf('run_staging_runtime_validation()')
    );
    assert.ok(
      prepareStagingCheckout.indexOf('load_staging_release_manifest') <
        prepareStagingCheckout.indexOf('login_staging_registry') &&
        prepareStagingCheckout.indexOf('login_staging_registry') <
          prepareStagingCheckout.indexOf('preflight_staging_release_candidate_images'),
      'staging should log into GHCR and pull every release image while preparing the checkout'
    );
    assert.ok(
      stagingRemote.indexOf('prepare_staging_checkout') <
        stagingRemote.indexOf('run_staging_runtime_validation') &&
        stagingRemote.indexOf('prepare_staging_checkout') <
          stagingRemote.indexOf('run_staging_database_migrations'),
      'staging image preflight should happen before runtime validation or migrations'
    );
    for (const token of [
      'preflight_staging_release_candidate_image "verifier" "$CLASSROOMPATH_VERIFIER_IMAGE"',
      'preflight_staging_release_candidate_image "migrations" "$CLASSROOMPATH_MIGRATIONS_IMAGE"',
      'preflight_staging_release_candidate_image "gateway" "$CLASSROOMPATH_GATEWAY_IMAGE"',
      'preflight_staging_release_candidate_image "OpenPath API" "$OPENPATH_API_IMAGE"',
      'preflight_staging_release_candidate_image "SPA" "$CLASSROOMPATH_SPA_IMAGE"',
      'preflight_staging_release_candidate_image "OpenPath Firefox assets" "$OPENPATH_FIREFOX_ASSETS_IMAGE"',
      'GHCR preflight failed for ${label} image: ${image_ref}',
    ]) {
      assert.ok(stagingRemote.includes(token), `missing staging GHCR preflight token: ${token}`);
    }
    assert.ok(
      stagingRemote.includes(
        [
          '  load_staging_release_manifest',
          '  if [ "${STAGING_USE_RELEASE_CANDIDATE:-0}" = "1" ]; then',
          '    deployment_state_capture_previous_release || exit 1',
          '  fi',
          '  login_staging_registry',
          '  preflight_staging_release_candidate_images',
          '  classify_migration_risk',
        ].join('\n')
      )
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
