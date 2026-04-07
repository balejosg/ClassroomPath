/**
 * ClassroomPath Deployment Infrastructure Tests
 *
 * Tests SaaS-specific deployment configurations.
 * Does NOT test OpenPath business logic (that's tested in OpenPath).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const currentFilePath = fileURLToPath(import.meta.url);
const testDir = dirname(currentFilePath);
const projectRoot = resolve(testDir, '..');
const verifyFullOrchestratorPath = resolve(projectRoot, 'scripts/verify-full.ts');
const turboConfigPath = resolve(projectRoot, 'turbo.json');
const turboRunnerScriptPath = resolve(projectRoot, 'scripts/run-turbo.sh');

interface DockerComposeService {
  build?: { context: string; dockerfile: string };
  image?: string;
  ports?: Array<string | number>;
  expose?: Array<string | number>;
  env_file?: string[];
  environment?: Array<string | number>;
  extra_hosts?: string[];
  healthcheck?: {
    test: string[];
    interval: string;
    timeout: string;
    retries: number;
  };
  volumes?: string[];
  depends_on?: string[];
}

interface DockerCompose {
  services: Record<string, DockerComposeService>;
  volumes?: Record<string, unknown>;
}

void describe('Docker Compose Configuration', () => {
  const composePath = resolve(projectRoot, 'docker/docker-compose.yml');
  const apiDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.api');

  void test('docker-compose.yml exists', () => {
    assert.ok(existsSync(composePath), 'docker-compose.yml should exist');
  });

  void test('docker-compose.yml is valid YAML', () => {
    const content = readFileSync(composePath, 'utf-8');
    const parsed = parseYaml(content) as DockerCompose;
    assert.ok(parsed.services, 'Should have services section');
  });

  void test('API service is properly configured', () => {
    const content = readFileSync(composePath, 'utf-8');
    const compose = parseYaml(content) as DockerCompose;

    assert.ok(compose.services['api'], 'API service should exist');

    const api = compose.services['api'];
    assert.ok(api.build, 'API should have build configuration');
    assert.ok(
      api.image?.includes('${OPENPATH_API_IMAGE'),
      'API should support immutable image overrides via OPENPATH_API_IMAGE'
    );
    assert.ok(
      api.ports?.some((p) => String(p).includes('3000')) ||
        api.expose?.some((p) => String(p).includes('3000')),
      'API should expose or publish port 3000'
    );
    assert.ok(api.healthcheck, 'API should have healthcheck');
    assert.deepStrictEqual(
      api.healthcheck?.test,
      ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://127.0.0.1:3000/health'],
      'API healthcheck should use wget because the runtime image does not include curl'
    );
    assert.ok(api.env_file, 'API should use env_file');
    assert.ok(
      api.extra_hosts?.includes('host.docker.internal:host-gateway'),
      'API should resolve host.docker.internal for host services like PostgreSQL'
    );
  });

  void test('gateway resolves host.docker.internal for host-backed infrastructure', () => {
    const content = readFileSync(composePath, 'utf-8');
    const compose = parseYaml(content) as DockerCompose;

    assert.ok(compose.services['gateway'], 'Gateway service should exist');

    const gateway = compose.services['gateway'];
    assert.ok(
      gateway.image?.includes('${CLASSROOMPATH_GATEWAY_IMAGE'),
      'Gateway should support immutable image overrides via CLASSROOMPATH_GATEWAY_IMAGE'
    );
    assert.ok(
      gateway.extra_hosts?.includes('host.docker.internal:host-gateway'),
      'Gateway should resolve host.docker.internal for host-backed infrastructure'
    );
    assert.ok(
      gateway.volumes?.includes('/opt/classroompath/downloads:/app/react-spa/dist/downloads:ro'),
      'Gateway should mount the signed Firefox distribution directory into the public SPA asset root'
    );
  });

  void test('SPA service is properly configured', () => {
    const content = readFileSync(composePath, 'utf-8');
    const compose = parseYaml(content) as DockerCompose;

    assert.ok(compose.services['spa'], 'SPA service should exist');

    const spa = compose.services['spa'];
    assert.ok(
      spa.image?.includes('${CLASSROOMPATH_SPA_IMAGE'),
      'SPA should support immutable image overrides via CLASSROOMPATH_SPA_IMAGE'
    );
    assert.ok(
      spa.image?.includes('nginx') ||
        (spa.build && spa.build.dockerfile.includes('Dockerfile.spa')),
      'SPA should use nginx image'
    );
    assert.ok(spa.depends_on?.includes('api'), 'SPA should depend on API');
  });

  void test('services reference upstream/openpath (submodule)', () => {
    const content = readFileSync(composePath, 'utf-8');
    assert.ok(
      content.includes('upstream/openpath'),
      'Should reference OpenPath submodule for builds/volumes'
    );
  });

  void test('OpenPath API runtime image preserves Windows bootstrap assets and cwd', () => {
    const content = readFileSync(apiDockerfilePath, 'utf-8');

    assert.ok(
      content.includes('COPY package-lock.json ./'),
      'Dockerfile.api should copy the lockfile explicitly for deterministic installs'
    );
    assert.ok(
      content.includes('COPY package.docker.json ./package.json'),
      'Dockerfile.api should use the dependency-only root manifest to avoid busting install cache on script-only changes'
    );
    assert.ok(
      content.includes('COPY shared/package.docker.json ./shared/package.json'),
      'Dockerfile.api should use the dependency-only shared manifest during npm ci'
    );
    assert.ok(
      content.includes('COPY api/package.docker.json ./api/package.json'),
      'Dockerfile.api should use the dependency-only api manifest during npm ci'
    );
    assert.ok(
      content.includes('--mount=type=cache,target=/root/.npm'),
      'Dockerfile.api should cache npm downloads across image builds'
    );
    assert.ok(
      content.includes('COPY windows/ ./windows/'),
      'Builder image should copy Windows agent sources into the build context'
    );
    assert.ok(
      content.includes('COPY firefox-extension/ ./firefox-extension/'),
      'Builder image should copy Firefox/Chromium browser extension assets into the build context'
    );
    assert.ok(
      content.includes('COPY VERSION ./VERSION'),
      'Builder image should copy VERSION so runtime can report the server version'
    );
    assert.ok(
      content.includes('COPY --from=builder /app/windows ./windows'),
      'Runtime image should include the Windows bootstrap scripts'
    );
    assert.ok(
      content.includes('COPY --from=builder /app/firefox-extension ./firefox-extension'),
      'Runtime image should include browser extension assets for Windows bootstrap and Chromium rollout'
    );
    assert.ok(
      content.includes('COPY --from=builder /app/shared/package.json ./shared/package.json'),
      'Runtime image should restore the full shared package metadata after installing from the dependency-only manifest'
    );
    assert.ok(
      content.includes('COPY --from=builder /app/VERSION ./VERSION'),
      'Runtime image should include VERSION for readServerVersion()'
    );
    assert.ok(
      content.includes('WORKDIR /app/api'),
      'Runtime image should start from /app/api so ../windows resolves correctly'
    );
    assert.ok(
      content.includes('CMD ["node", "dist/src/server.js"]'),
      'Runtime image should execute the API from the /app/api working directory'
    );
  });
});

void describe('Environment Configuration', () => {
  const envExamplePath = resolve(projectRoot, 'config/.env.example');
  const deployTargetsPath = resolve(projectRoot, 'config/deploy-targets.json');

  void test('.env.example exists', () => {
    assert.ok(existsSync(envExamplePath), '.env.example should exist');
  });

  void test('.env.example contains required variables', () => {
    const content = readFileSync(envExamplePath, 'utf-8');
    const requiredVars = ['PORT', 'PUBLIC_URL', 'JWT_SECRET', 'DATABASE_URL', 'CORS_ORIGINS'];

    for (const envVar of requiredVars) {
      assert.ok(content.includes(envVar), `Required variable ${envVar} should be documented`);
    }
  });

  void test('.env.example documents the email delivery contract for deployed environments', () => {
    const content = readFileSync(envExamplePath, 'utf-8');
    const requiredVars = ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'CP_FAKE_EMAIL_DELIVERY'];

    for (const envVar of requiredVars) {
      assert.ok(content.includes(envVar), `Email delivery variable ${envVar} should be documented`);
    }
  });

  void test('.env.example documents the pinned Linux agent enrollment version', () => {
    const content = readFileSync(envExamplePath, 'utf-8');

    assert.ok(
      content.includes('OPENPATH_LINUX_AGENT_VERSION'),
      'Deploy config should document the Linux agent package version pin used by OpenPath enrollment'
    );
  });

  void test('.env.example does not contain actual secrets', () => {
    const content = readFileSync(envExamplePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (line.includes('SECRET') || line.includes('PASSWORD') || line.includes('TOKEN')) {
        const [key, value] = line.split('=');
        if (key && value && !line.startsWith('#')) {
          assert.ok(
            value.trim() === '' ||
              value.includes('your-') ||
              value.includes('generate') ||
              value.includes('example'),
            `${key} should not contain actual secret value`
          );
        }
      }
    }
  });

  void test('deploy-targets.json captures the canonical public URLs', () => {
    assert.ok(existsSync(deployTargetsPath), 'config/deploy-targets.json should exist');

    const targets = JSON.parse(readFileSync(deployTargetsPath, 'utf-8')) as {
      staging?: { publicUrl?: string };
      production?: { publicUrl?: string };
    };

    assert.strictEqual(
      targets.staging?.publicUrl,
      'https://classroompath-staging.duckdns.org',
      'Staging public URL should stay centralized in deploy-targets.json'
    );
    assert.strictEqual(
      targets.production?.publicUrl,
      'https://classroompath.eu',
      'Production public URL should stay centralized in deploy-targets.json'
    );
  });

  void test('package scripts resolve smoke and release targets from deploy-targets.mjs', () => {
    const packageJson = readFileSync(resolve(projectRoot, 'package.json'), 'utf-8');

    assert.ok(
      packageJson.includes('scripts/deploy-targets.mjs get staging publicUrl'),
      'Staging scripts should resolve the canonical URL from deploy-targets.mjs'
    );
    assert.ok(
      packageJson.includes('scripts/deploy-targets.mjs get production publicUrl'),
      'Production smoke script should resolve the canonical URL from deploy-targets.mjs'
    );
  });
});

void describe('Nginx Configuration', () => {
  const nginxPath = resolve(projectRoot, 'config/nginx.conf');

  void test('nginx.conf exists', () => {
    assert.ok(existsSync(nginxPath), 'nginx.conf should exist');
  });

  void test('nginx.conf has HTTPS redirect', () => {
    const content = readFileSync(nginxPath, 'utf-8');
    assert.ok(content.includes('return 301 https://'), 'Should redirect HTTP to HTTPS');
  });

  void test('nginx.conf has security headers', () => {
    const content = readFileSync(nginxPath, 'utf-8');
    const requiredHeaders = ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy'];

    for (const header of requiredHeaders) {
      assert.ok(content.includes(header), `Security header ${header} should be configured`);
    }
  });

  void test('nginx.conf proxies API endpoints correctly', () => {
    const content = readFileSync(nginxPath, 'utf-8');
    const requiredLocations = ['/api/', '/trpc/', '/health', '/w/'];

    for (const location of requiredLocations) {
      assert.ok(
        content.includes(`location ${location}`),
        `Should have location block for ${location}`
      );
    }
  });

  void test('nginx.conf has SPA fallback for client-side routing', () => {
    const content = readFileSync(nginxPath, 'utf-8');
    assert.ok(
      content.includes('try_files') && content.includes('/index.html'),
      'Should have SPA fallback to index.html'
    );
  });

  void test('nginx.conf reserves SEO public routes for gateway SSR before the SPA fallback', () => {
    const content = readFileSync(nginxPath, 'utf-8');

    assert.ok(
      content.includes('location = / {') && content.includes('proxy_pass http://127.0.0.1:3000;'),
      'Should proxy the landing page to the gateway for SSR'
    );
    assert.ok(
      content.includes('location = /pricing {') && content.includes('location = /pricing/ {'),
      'Should proxy pricing routes to the gateway for SSR'
    );
  });

  void test('nginx.conf has static asset caching', () => {
    const content = readFileSync(nginxPath, 'utf-8');
    assert.ok(
      content.includes('expires') && content.includes('Cache-Control'),
      'Should have cache headers for static assets'
    );
  });
});

void describe('Submodule Structure', () => {
  const submodulePath = resolve(projectRoot, 'upstream/openpath');

  void test('OpenPath submodule directory exists', () => {
    assert.ok(existsSync(submodulePath), 'upstream/openpath submodule should exist');
  });

  void test('OpenPath submodule has package.json', () => {
    const pkgPath = resolve(submodulePath, 'package.json');
    assert.ok(existsSync(pkgPath), 'OpenPath should have package.json (submodule initialized)');
  });

  void test('OpenPath submodule has required workspaces', () => {
    const pkgPath = resolve(submodulePath, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { workspaces?: string[] };

    const workspaces = pkg.workspaces ?? [];

    // OpenPath historically had a legacy `spa` workspace; it has since been replaced by `react-spa`.
    // ClassroomPath should be compatible with either layout.
    assert.ok(workspaces.includes('api'), 'OpenPath should have api workspace');
    assert.ok(workspaces.includes('shared'), 'OpenPath should have shared workspace');
    assert.ok(
      workspaces.includes('react-spa') || workspaces.includes('spa'),
      'OpenPath should have react-spa (or legacy spa) workspace'
    );
  });
});

void describe('Migration Tooling', () => {
  const migrationsScriptPath = resolve(projectRoot, 'scripts/run-migrations-docker.sh');
  const openPathDbEnvHelperPath = resolve(projectRoot, 'scripts/derive-openpath-db-env.mjs');
  const hostMigrationsScriptPath = resolve(projectRoot, 'scripts/run-migrations.sh');
  const migrationsImageScriptPath = resolve(projectRoot, 'scripts/run-migrations-image.sh');
  const migrationsDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.migrations');
  const gatewayDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.cp-api');
  const gatewayDockerignorePath = resolve(projectRoot, 'docker/Dockerfile.cp-api.dockerignore');
  const spaDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.spa');
  const spaDockerignorePath = resolve(projectRoot, 'docker/Dockerfile.spa.dockerignore');
  const verifierDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.release-verifier');
  const stagingHealthCheckScriptPath = resolve(projectRoot, 'scripts/check-staging-health.sh');
  const stagingDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
  const stagingDeployRemoteScriptPath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
  const stagingReleaseGateScriptPath = resolve(projectRoot, 'scripts/run-staging-release-gate.sh');
  const stagingSmokeScriptPath = resolve(projectRoot, 'scripts/run-staging-smoke.sh');
  const stagingVerificationRunnerPath = resolve(projectRoot, 'scripts/run-staging-verification.sh');
  const stagingVerifyStateScriptPath = resolve(
    projectRoot,
    'scripts/persist-staging-verification-remote.sh'
  );
  const verifyFullScriptPath = resolve(projectRoot, 'scripts/verify-full.sh');
  const classroomPathPackagePath = resolve(projectRoot, 'package.json');
  const preCommitHookPath = resolve(projectRoot, '.husky/pre-commit');
  const releaseImagesScriptPath = resolve(projectRoot, 'scripts/release-images.mjs');
  const waitForReleaseCandidateScriptPath = resolve(
    projectRoot,
    'scripts/wait-for-release-candidate.mjs'
  );
  const deployWorkflowPath = resolve(projectRoot, '.github/workflows/deploy.yml');
  const releaseCandidateWorkflowPath = resolve(
    projectRoot,
    '.github/workflows/release-candidate-images.yml'
  );

  void test('ClassroomPath migrations repair legacy ClassroomPath schema before db:push', () => {
    const content = readFileSync(migrationsScriptPath, 'utf-8');
    const repairStep = 'node --import tsx api/scripts/ensure-legacy-cp-schema.ts';
    const pushStep = 'npm run db:push -w @classroompath/api';

    assert.ok(
      content.includes(repairStep),
      'run-migrations-docker.sh should repair legacy ClassroomPath schema before db:push'
    );
    assert.ok(
      content.indexOf(repairStep) < content.indexOf(pushStep),
      'legacy ClassroomPath schema repair should run before db:push'
    );
  });

  void test('host fallback migrations also repair legacy ClassroomPath schema before db:push', () => {
    const content = readFileSync(hostMigrationsScriptPath, 'utf-8');
    const repairStep = 'node --import tsx api/scripts/ensure-legacy-cp-schema.ts';
    const pushStep = 'npm run db:push -w @classroompath/api';

    assert.ok(
      content.includes(repairStep),
      'run-migrations.sh should repair legacy ClassroomPath schema before db:push'
    );
    assert.ok(
      content.indexOf(repairStep) < content.indexOf(pushStep),
      'host fallback should repair legacy ClassroomPath schema before db:push'
    );
  });

  void test('staging deploy validates the gateway runtime contract before migrations', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const remoteContent = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const validateStep = 'bash scripts/validate-runtime-config-docker.sh';
    const pushStep =
      'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"';

    assert.ok(
      existsSync(stagingDeployRemoteScriptPath),
      'deploy-staging-remote.sh should exist as the versioned remote deploy payload'
    );
    assert.ok(
      localContent.includes('STAGING_REMOTE_SCRIPT_PATH="$SCRIPT_DIR/deploy-staging-remote.sh"'),
      'deploy-staging-local.sh should invoke the dedicated remote deploy script'
    );
    assert.ok(
      remoteContent.includes(validateStep),
      'deploy-staging-remote.sh should validate runtime config before migrations'
    );
    assert.ok(
      remoteContent.indexOf(validateStep) < remoteContent.indexOf(pushStep),
      'runtime config validation should happen before migrations inside the remote deploy script'
    );
  });

  void test('staging remote deploy can resolve its helper library even when executed via stdin', () => {
    const remoteContent = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');

    assert.ok(
      remoteContent.includes('SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"'),
      'deploy-staging-remote.sh should guard against missing BASH_SOURCE when the payload is streamed over SSH'
    );
    assert.ok(
      remoteContent.includes('APP_DIR="/opt/classroompath/app"'),
      'deploy-staging-remote.sh should declare the canonical app directory explicitly'
    );
    assert.ok(
      remoteContent.includes('SCRIPT_DIR="$APP_DIR/scripts"'),
      'deploy-staging-remote.sh should fall back to the deployed scripts directory when stdin execution has no script path'
    );
    assert.ok(
      remoteContent.includes('if [ ! -f "$RELEASE_MANIFEST_HELPER_PATH" ]; then') &&
        remoteContent.includes('decode_release_manifest_base64() {') &&
        remoteContent.includes('release_manifest_validate_contract() {'),
      'deploy-staging-remote.sh should inline release-manifest helpers when the deployed checkout is too old to provide them'
    );
  });

  void test('production remote scripts can resolve their helper library when ssh-action executes without BASH_SOURCE', () => {
    const deployRemoteContent = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const rollbackRemoteContent = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );

    for (const [scriptName, content] of [
      ['deploy-production-remote.sh', deployRemoteContent],
      ['rollback-production-remote.sh', rollbackRemoteContent],
    ] as const) {
      assert.ok(
        content.includes('SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"'),
        `${scriptName} should guard against missing BASH_SOURCE when appleboy/ssh-action streams the payload`
      );
      assert.ok(
        content.includes('APP_DIR="/opt/classroompath/app"'),
        `${scriptName} should declare the canonical app directory explicitly`
      );
      assert.ok(
        content.includes('SCRIPT_DIR="$APP_DIR/scripts"'),
        `${scriptName} should fall back to the deployed scripts directory when stdin execution has no script path`
      );
      assert.ok(
        content.includes('COMMON_SH_DEPLOYED_PATH="$APP_DIR/scripts/lib/common.sh"'),
        `${scriptName} should keep an absolute path to the deployed helper library after the remote checkout updates the app directory`
      );
      assert.ok(
        content.includes('reload_deployed_common_helpers() {'),
        `${scriptName} should be able to re-source helper functions from the freshly checked out app directory`
      );
    }

    assert.ok(
      deployRemoteContent.includes('if [ ! -f "$RELEASE_MANIFEST_HELPER_PATH" ]; then') &&
        deployRemoteContent.includes('decode_release_manifest_base64() {') &&
        deployRemoteContent.includes('release_manifest_validate_contract() {'),
      'deploy-production-remote.sh should inline release-manifest helpers when the deployed checkout is too old to provide them'
    );
  });

  void test('remote bootstrap helper centralizes streamed ssh script context and helper resolution', () => {
    const remoteBootstrapPath = resolve(projectRoot, 'scripts/lib/remote-bootstrap.sh');
    const remoteBootstrap = readFileSync(remoteBootstrapPath, 'utf-8');
    const stagingRemote = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const productionRemote = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const rollbackRemote = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );
    const persistVerification = readFileSync(
      resolve(projectRoot, 'scripts/persist-staging-verification-remote.sh'),
      'utf-8'
    );

    assert.ok(existsSync(remoteBootstrapPath), 'scripts/lib/remote-bootstrap.sh should exist');
    assert.ok(
      remoteBootstrap.includes('resolve_remote_script_dir()') &&
        remoteBootstrap.includes('resolve_remote_helper_path()') &&
        remoteBootstrap.includes('reload_deployed_common_helpers()'),
      'remote-bootstrap helper should own streamed-script path resolution and deployed helper reloads'
    );

    for (const [scriptName, content] of [
      ['deploy-staging-remote.sh', stagingRemote],
      ['deploy-production-remote.sh', productionRemote],
      ['rollback-production-remote.sh', rollbackRemote],
      ['persist-staging-verification-remote.sh', persistVerification],
    ] as const) {
      assert.ok(
        content.includes('REMOTE_BOOTSTRAP_HELPER_PATH=') &&
          content.includes('resolve_remote_script_dir "$APP_DIR" "$SCRIPT_SOURCE"') &&
          content.includes('resolve_remote_helper_path'),
        `${scriptName} should reuse the shared remote bootstrap helper when available`
      );
    }
  });

  void test('verify-full skips coverage cleanup and gating when no API/SPA source coverage is needed', () => {
    const content = readFileSync(verifyFullOrchestratorPath, 'utf-8');

    assert.ok(
      content.includes('needsCoverageGate: needsApiCoverage || needsSpaCoverage'),
      'verify-full.ts should track whether the changed-file coverage gate is actually needed'
    );
    assert.ok(
      content.includes('if (plan.needsCoverageGate) {'),
      'verify-full.ts should guard coverage cleanup and gating behind needsCoverageGate'
    );
    assert.ok(
      content.includes('Skipping coverage gate (no changed API/SPA source files).'),
      'verify-full.ts should report when it skips the changed-file coverage gate'
    );
  });

  void test('pre-commit and release verification both require the full Playwright suite', () => {
    const packageJson = JSON.parse(readFileSync(classroomPathPackagePath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const hook = readFileSync(preCommitHookPath, 'utf-8');
    const verifyScript = readFileSync(verifyFullOrchestratorPath, 'utf-8');

    assert.equal(
      packageJson.scripts?.['verify:commit'],
      'VERIFY_MODE=commit bash scripts/verify-full.sh',
      'package.json should expose a dedicated fast verify:commit lane'
    );
    assert.equal(
      packageJson.scripts?.['verify:release'],
      'VERIFY_MODE=release bash scripts/verify-full.sh',
      'package.json should expose a dedicated release verify lane'
    );
    assert.ok(
      hook.includes('npm run verify:commit'),
      'pre-commit should execute verify:commit instead of the release lane'
    );
    assert.ok(
      packageJson.scripts?.['test:e2e:verify-fast'] === 'npm run test:e2e:full',
      'the legacy fast E2E alias should resolve to the full Playwright suite'
    );
    assert.ok(
      packageJson.scripts?.['test:e2e:commit-smoke'] === 'npm run test:e2e:full',
      'the legacy commit-smoke alias should resolve to the full Playwright suite'
    );
    assert.ok(
      verifyScript.includes(
        'Playwright browsers are required for local verification and are not installed.'
      ),
      'verify-full.ts should fail when Playwright browsers are unavailable'
    );
    assert.ok(
      verifyScript.includes('Running full E2E Playwright suite...') &&
        verifyScript.includes('runPlaywrightVerification'),
      'verify-full.ts should always run the full Playwright suite'
    );
    assert.ok(
      !verifyScript.includes('--grep="@commit-smoke"') &&
        !verifyScript.includes('--grep-invert="@slow-network|@repro"') &&
        !verifyScript.includes('skipping commit-smoke browser verification'),
      'verify-full.ts should not include reduced or skippable Playwright lanes'
    );
    assert.ok(
      verifyScript.includes(
        'Playwright verification cannot skip tests; skipped: ${String(skipped)}'
      ) && verifyScript.includes('PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath'),
      'verify-full.ts should fail when Playwright reports skipped tests'
    );
    assert.ok(
      readFileSync(resolve(projectRoot, 'playwright.config.ts'), 'utf-8').includes(
        'PLAYWRIGHT_JSON_OUTPUT_FILE'
      ),
      'playwright.config.ts should support an auxiliary JSON reporter for verification gates'
    );
  });

  void test('verify-full shell entrypoint delegates policy to a typed Node orchestrator', () => {
    const verifyScript = readFileSync(verifyFullScriptPath, 'utf-8');

    assert.ok(existsSync(verifyFullOrchestratorPath), 'scripts/verify-full.ts should exist');
    assert.ok(
      verifyScript.includes('exec node --import tsx "$ROOT_DIR/scripts/verify-full.ts" "$@"'),
      'verify-full.sh should be a thin wrapper over the typed Node orchestrator'
    );

    const orchestrator = readFileSync(verifyFullOrchestratorPath, 'utf-8');

    assert.ok(
      orchestrator.includes('type VerifyMode =') &&
        orchestrator.includes('function buildVerifyPlan('),
      'verify-full.ts should model verification policy through typed planning helpers'
    );
    assert.ok(
      orchestrator.includes('function validatePlaywrightReport(') &&
        orchestrator.includes('Playwright verification cannot skip tests; skipped:'),
      'verify-full.ts should own the Playwright skipped-test gate'
    );
  });

  void test('build and static verification route through the ClassroomPath turbo pipeline', () => {
    const rootPackage = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
      workspaces?: string[];
    };
    const buildScript = readFileSync(
      resolve(projectRoot, 'scripts/build-classroompath.sh'),
      'utf-8'
    );
    const verifyOrchestrator = readFileSync(verifyFullOrchestratorPath, 'utf-8');
    const turboConfig = readFileSync(turboConfigPath, 'utf-8');

    assert.ok(existsSync(turboConfigPath), 'turbo.json should exist at the ClassroomPath root');
    assert.ok(
      existsSync(turboRunnerScriptPath),
      'scripts/run-turbo.sh should exist as the shared turbo entrypoint'
    );
    assert.ok(
      rootPackage.scripts?.['verify:static']?.includes('scripts/run-turbo.sh verify:static'),
      'package.json should expose a root verify:static script through the shared turbo runner'
    );
    assert.ok(
      buildScript.includes('scripts/run-turbo.sh build'),
      'build-classroompath.sh should delegate package builds to the shared turbo runner'
    );
    assert.ok(
      verifyOrchestrator.includes("await run('bash', ['scripts/run-turbo.sh', 'verify:static']"),
      'verify-full.ts should route static verification through the root turbo pipeline'
    );
    assert.ok(
      turboConfig.includes('"build"') &&
        turboConfig.includes('"typecheck"') &&
        turboConfig.includes('"lint"'),
      'turbo.json should define build, typecheck, and lint tasks for the workspace graph'
    );
  });

  void test('ClassroomPath packages declare the OpenPath shared workspace when they import it', () => {
    const apiPackage = JSON.parse(
      readFileSync(resolve(projectRoot, 'api/package.json'), 'utf-8')
    ) as {
      dependencies?: Record<string, string>;
    };
    const spaPackage = JSON.parse(
      readFileSync(resolve(projectRoot, 'react-spa/package.json'), 'utf-8')
    ) as {
      dependencies?: Record<string, string>;
    };

    assert.equal(
      apiPackage.dependencies?.['@openpath/shared'],
      '1.0.0',
      '@classroompath/api should declare @openpath/shared so clean workspace builds pull it into the turbo graph'
    );
    assert.equal(
      spaPackage.dependencies?.['@openpath/shared'],
      '1.0.0',
      '@classroompath/react-spa should declare @openpath/shared so workspace installs match its source imports'
    );
    assert.equal(
      spaPackage.dependencies?.['@openpath/api'],
      '1.0.0',
      '@classroompath/react-spa should declare @openpath/api so clean typecheck runs pull the OpenPath API workspace into the graph'
    );
  });

  void test('ClassroomPath react-spa preserves the upstream OpenPath tsconfig path aliases it relies on', () => {
    const spaTsconfig = JSON.parse(
      readFileSync(resolve(projectRoot, 'react-spa/tsconfig.json'), 'utf-8')
    ) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };

    assert.deepEqual(
      spaTsconfig.compilerOptions?.paths?.['@openpath/shared'],
      ['../upstream/openpath/shared/src'],
      '@classroompath/react-spa should keep the direct @openpath/shared source alias'
    );
    assert.deepEqual(
      spaTsconfig.compilerOptions?.paths?.['@openpath/shared/*'],
      ['../upstream/openpath/shared/src/*'],
      '@classroompath/react-spa should keep the subpath @openpath/shared/* alias'
    );
    assert.deepEqual(
      spaTsconfig.compilerOptions?.paths?.['@openpath/api'],
      ['../upstream/openpath/api/src/index.ts'],
      '@classroompath/react-spa should keep the @openpath/api alias for upstream shell typecheck'
    );
  });

  void test('staging deploy waits for the successful release-candidate manifest before source-build fallback', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const remoteContent = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');

    assert.ok(existsSync(releaseImagesScriptPath), 'release-images.mjs should exist');
    assert.ok(
      existsSync(waitForReleaseCandidateScriptPath),
      'wait-for-release-candidate.mjs should exist'
    );
    assert.ok(
      localContent.includes('node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest'),
      'deploy-staging-local.sh should wait for a successful release-candidate manifest for origin/main'
    );
    assert.ok(
      remoteContent.includes('deploy_with_release_candidates'),
      'deploy-staging-remote.sh should define a release-candidate deploy path'
    );
    assert.ok(
      remoteContent.includes('docker compose pull gateway api spa'),
      'staging remote deploy should try pulling prebuilt candidate images'
    );
    assert.ok(
      localContent.includes('STAGING_RELEASE_MANIFEST_FILE') &&
        localContent.includes('STAGING_RELEASE_MANIFEST_B64'),
      'staging deploy should resolve and forward a single release-manifest payload for the remote deploy'
    );
    assert.ok(
      localContent.includes('STAGING_RELEASE_WAIT_TIMEOUT_SECONDS'),
      'staging deploy should expose a bounded wait timeout for release candidate availability'
    );
    assert.ok(
      remoteContent.includes('decode_release_manifest_base64 "$STAGING_RELEASE_MANIFEST_B64"') &&
        remoteContent.includes('load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"'),
      'staging remote deploy should derive the release-candidate image refs from the shared manifest payload'
    );
    assert.ok(
      remoteContent.includes(
        'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "$OPENPATH_LINUX_AGENT_VERSION"'
      ),
      'staging remote deploy should persist the pinned OpenPath Linux agent version into the runtime env file before compose up'
    );
    assert.ok(
      remoteContent.includes('if [ "$STAGING_IMAGE_MODE" = "source-build" ]; then'),
      'staging remote deploy should keep source-build as an explicit opt-in mode'
    );
    assert.ok(
      !localContent.includes('node "$SCRIPT_DIR/release-images.mjs" outputs --sha "$REMOTE_SHA"'),
      'staging deploy should consume the manifest digests instead of guessing image tags locally'
    );
    assert.ok(
      !localContent.includes('Falling back to source build for staging'),
      'staging deploy should not silently fall back from release candidates to source builds'
    );
  });

  void test('staging deploy records reusable verification evidence after smoke and release gate pass', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const releaseGateHelperContent = readFileSync(stagingReleaseGateScriptPath, 'utf-8');
    const helperContent = readFileSync(stagingVerifyStateScriptPath, 'utf-8');
    const runnerContent = readFileSync(stagingVerificationRunnerPath, 'utf-8');

    assert.ok(
      existsSync(stagingVerifyStateScriptPath),
      'persist-staging-verification-remote.sh should exist as the versioned remote evidence writer'
    );
    assert.ok(
      existsSync(stagingVerificationRunnerPath),
      'run-staging-verification.sh should exist as the shared staging verification runner'
    );
    assert.ok(
      localContent.includes('STAGING_RUN_RELEASE_GATE="${STAGING_RUN_RELEASE_GATE:-1}"'),
      'deploy-staging-local.sh should default to running the staging release gate during promotion prep'
    );
    assert.ok(
      existsSync(stagingReleaseGateScriptPath),
      'run-staging-release-gate.sh should exist as the versioned staging release gate helper'
    );
    assert.ok(
      releaseGateHelperContent.includes(
        'exec bash "$SCRIPT_DIR/run-staging-verification.sh" release-gate "$@"'
      ),
      'run-staging-release-gate.sh should delegate to the shared staging verification runner'
    );
    assert.ok(
      runnerContent.includes('RELEASE_GATE_URL="$CANONICAL_STAGING_URL"'),
      'staging verification runner should keep the release gate bound to the canonical staging URL'
    );
    assert.ok(
      runnerContent.includes('RELEASE_GATE_EXPECTED_ORIGIN="$RELEASE_GATE_EXPECTED_ORIGIN"'),
      'staging verification runner should pass the canonical public origin separately from the transport target'
    );
    assert.ok(
      runnerContent.includes('bash "$RESOLVE_HOST_SCRIPT_PATH" "$target_host"'),
      'staging verification runner should resolve canonical hosts explicitly before invoking the local runner'
    );
    assert.ok(
      runnerContent.includes('RELEASE_GATE_RESOLVED_ADDRESS='),
      'staging verification runner should provide the resolved release-gate address to the test runner instead of downgrading the URL'
    );
    assert.ok(
      helperContent.includes('STAGING_RELEASE_GATE_RESULT=success') ||
        localContent.includes('STAGING_GATE_RESULT="success"'),
      'staging deploy should capture a successful release-gate result'
    );
    assert.ok(
      helperContent.includes('staging-verification.env'),
      'staging deploy should persist staging-verification.env on the staging host'
    );
    assert.ok(
      helperContent.includes('STAGING_VERIFIED_GATEWAY_IMAGE'),
      'staging verification evidence should record the deployed immutable image digests'
    );
    assert.ok(
      runnerContent.includes(
        'classroompath-api test -f /app/firefox-extension/build/firefox-release/metadata.json'
      ),
      'staging verification runner should verify the staged Firefox release metadata inside the API container before recording evidence'
    );
    assert.ok(
      runnerContent.includes(
        'classroompath-api test -f /app/firefox-extension/build/firefox-release/openpath-firefox-extension.xpi'
      ),
      'staging verification runner should verify the staged Firefox release XPI inside the API container before recording evidence'
    );
    assert.ok(
      helperContent.includes(
        'STAGING_VERIFIED_FIREFOX_RELEASE_ARTIFACTS=$STAGING_FIREFOX_RELEASE_ARTIFACTS'
      ),
      'staging verification evidence should record Firefox release artifact presence explicitly'
    );
    assert.ok(
      runnerContent.includes('npm run test:windows-bootstrap-gate'),
      'staging verification runner should run the live Windows bootstrap gate before persisting release evidence'
    );
    assert.ok(
      runnerContent.includes('WINDOWS_BOOTSTRAP_GATE_RESOLVED_ADDRESS='),
      'staging verification runner should provide the resolved canonical host address to the Windows bootstrap gate'
    );
    assert.ok(
      helperContent.includes('STAGING_WINDOWS_BOOTSTRAP_RESULT=$STAGING_WINDOWS_BOOTSTRAP_RESULT'),
      'staging verification evidence should record a successful Windows bootstrap result'
    );
    assert.ok(
      helperContent.includes('STAGING_FIREFOX_POLICY_RESULT=$STAGING_FIREFOX_POLICY_RESULT'),
      'staging verification evidence should record a successful Firefox policy input result'
    );
    assert.ok(
      helperContent.includes('STAGING_FIREFOX_EXTENSION_ID=') &&
        helperContent.includes('STAGING_FIREFOX_RELEASE_VERSION=') &&
        helperContent.includes('STAGING_FIREFOX_METADATA_SHA256=') &&
        helperContent.includes('STAGING_FIREFOX_XPI_SHA256='),
      'staging verification evidence should persist Firefox release identity and hashes'
    );
    assert.ok(
      runnerContent.includes(
        'node "$SCRIPT_DIR/read-firefox-release-metadata.mjs" --field extensionId'
      ) &&
        runnerContent.includes(
          'node "$SCRIPT_DIR/read-firefox-release-metadata.mjs" --field version'
        ),
      'staging verification runner should own Firefox metadata parsing'
    );
    assert.ok(
      runnerContent.includes(
        'Release-candidate staging deploys must prove the live Windows bootstrap contract'
      ),
      'shared staging verification runner should fail release-candidate staging evidence when the live Windows bootstrap gate fails'
    );
    assert.ok(
      localContent.includes(
        'STAGING_VERIFY_STATE_SCRIPT_PATH="$SCRIPT_DIR/persist-staging-verification-remote.sh"'
      ),
      'deploy-staging-local.sh should reference the dedicated remote evidence writer'
    );
    assert.ok(
      localContent.includes(
        'STAGING_VERIFICATION_RUNNER_PATH="$SCRIPT_DIR/run-staging-verification.sh"'
      ),
      'deploy-staging-local.sh should reference the shared staging verification runner'
    );
    assert.ok(
      localContent.includes(
        'bash "$STAGING_VERIFICATION_RUNNER_PATH" collect "$VERIFICATION_STATE_FILE" "$STAGING_HOST" "$STAGING_SMOKE_URL" "$CANONICAL_STAGING_URL" "$STAGING_USE_RELEASE_CANDIDATE" "${SSH_CMD[@]}"'
      ),
      'deploy-staging-local.sh should delegate smoke and release-gate verification to the shared runner'
    );
    assert.ok(
      localContent.includes(
        '"${SSH_CMD[@]}" "${VERIFY_STATE_ENV_CMD}bash -s" < "$STAGING_VERIFY_STATE_SCRIPT_PATH"'
      ),
      'deploy-staging-local.sh should delegate evidence persistence to the remote helper script'
    );
  });

  void test('staging deploy delegates remote health polling to a dedicated helper', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const helperContent = readFileSync(stagingHealthCheckScriptPath, 'utf-8');

    assert.ok(
      existsSync(stagingHealthCheckScriptPath),
      'check-staging-health.sh should exist as the versioned staging health helper'
    );
    assert.ok(
      localContent.includes(
        'STAGING_HEALTH_CHECK_SCRIPT_PATH="$SCRIPT_DIR/check-staging-health.sh"'
      ),
      'deploy-staging-local.sh should reference the dedicated staging health helper'
    );
    assert.ok(
      localContent.includes(
        'bash "$STAGING_HEALTH_CHECK_SCRIPT_PATH" "$STAGING_HOST" "${SSH_CMD[@]}"'
      ),
      'deploy-staging-local.sh should delegate the remote health polling to the helper script'
    );
    assert.ok(
      helperContent.includes('curl -sf http://localhost:3000/cp/ready 2>/dev/null'),
      'staging health helper should poll gateway readiness over SSH'
    );
    assert.ok(
      helperContent.includes('curl -sf http://localhost:3000/health 2>/dev/null'),
      'staging health helper should poll API health via the gateway over SSH'
    );
  });

  void test('staging deploy delegates smoke execution and fallback resolution to a dedicated helper', () => {
    const localContent = readFileSync(stagingDeployScriptPath, 'utf-8');
    const helperContent = readFileSync(stagingSmokeScriptPath, 'utf-8');
    const runnerContent = readFileSync(stagingVerificationRunnerPath, 'utf-8');

    assert.ok(
      existsSync(stagingSmokeScriptPath),
      'run-staging-smoke.sh should exist as the versioned staging smoke helper'
    );
    assert.ok(
      helperContent.includes('exec bash "$SCRIPT_DIR/run-staging-verification.sh" smoke "$@"'),
      'run-staging-smoke.sh should delegate to the shared staging verification runner'
    );
    assert.ok(
      localContent.includes(
        'STAGING_VERIFICATION_RUNNER_PATH="$SCRIPT_DIR/run-staging-verification.sh"'
      ),
      'deploy-staging-local.sh should reference the shared staging verification runner for smoke checks'
    );
    assert.ok(
      runnerContent.includes('bash "$RESOLVE_HOST_SCRIPT_PATH" "$target_host"'),
      'staging verification runner should resolve canonical smoke and release-gate hosts explicitly before invoking the test runners'
    );
    assert.ok(
      runnerContent.includes('npm run test:smoke'),
      'staging verification runner should execute the shared smoke entrypoint'
    );
    assert.ok(
      runnerContent.includes('SMOKE_TEST_RESOLVED_ADDRESS='),
      'staging verification runner should pass the resolved canonical host address to the smoke runner'
    );
  });

  void test('migration runner image packages the workspace migration entrypoint', () => {
    assert.ok(existsSync(migrationsDockerfilePath), 'Dockerfile.migrations should exist');
    assert.ok(existsSync(migrationsImageScriptPath), 'run-migrations-image.sh should exist');
    assert.ok(existsSync(openPathDbEnvHelperPath), 'derive-openpath-db-env.mjs should exist');

    const dockerfile = readFileSync(migrationsDockerfilePath, 'utf-8');
    const script = readFileSync(migrationsImageScriptPath, 'utf-8');

    assert.ok(
      dockerfile.includes('COPY . .'),
      'migration runner image should copy the workspace sources it migrates'
    );
    assert.ok(
      dockerfile.includes('ENTRYPOINT ["sh", "scripts/run-migrations-image.sh"]'),
      'migration runner image should execute the dedicated migrations entrypoint'
    );
    assert.ok(
      script.includes('node --import tsx api/scripts/ensure-legacy-cp-schema.ts'),
      'migration runner should repair legacy ClassroomPath schema drift before the ClassroomPath push'
    );
    assert.ok(
      script.includes('npm run db:push -w @classroompath/api'),
      'migration runner should push the ClassroomPath schema from the prebuilt image'
    );
    assert.ok(
      script.includes('npm run db:push -w @openpath/api'),
      'migration runner should push the OpenPath schema from the prebuilt image'
    );
    assert.ok(
      script.includes('node scripts/derive-openpath-db-env.mjs'),
      'migration runner should derive OpenPath DB_* env vars from the shared helper when needed'
    );
  });

  void test('gateway release image narrows its build inputs to avoid unrelated cache invalidation', () => {
    assert.ok(existsSync(gatewayDockerfilePath), 'Dockerfile.cp-api should exist');
    assert.ok(existsSync(gatewayDockerignorePath), 'Dockerfile.cp-api.dockerignore should exist');

    const dockerfile = readFileSync(gatewayDockerfilePath, 'utf-8');
    const dockerignore = readFileSync(gatewayDockerignorePath, 'utf-8');

    assert.ok(
      !dockerfile.includes('COPY . .'),
      'gateway release image should not copy the entire repository into the build stage'
    );
    assert.ok(
      dockerfile.includes('COPY api/src ./api/src'),
      'gateway release image should copy only the ClassroomPath API sources it builds'
    );
    assert.ok(
      dockerfile.includes('COPY react-spa/src ./react-spa/src'),
      'gateway release image should copy the ClassroomPath SPA sources it renders'
    );
    assert.ok(
      dockerfile.includes('COPY upstream/openpath/react-spa/src ./upstream/openpath/react-spa/src'),
      'gateway release image should copy the upstream OpenPath SPA sources it imports'
    );
    assert.ok(
      dockerfile.includes('COPY contracts/package*.json ./contracts/'),
      'gateway release image should copy the contracts workspace manifest required by the ClassroomPath SPA and API builds'
    );
    assert.ok(
      dockerfile.includes('COPY presenters/package*.json ./presenters/'),
      'gateway release image should copy the presenters workspace manifest required by the ClassroomPath API build'
    );
    assert.ok(
      dockerfile.includes('COPY contracts/src ./contracts/src'),
      'gateway release image should copy the contracts workspace sources required by the ClassroomPath SPA and API builds'
    );
    assert.ok(
      dockerfile.includes('COPY presenters/src ./presenters/src'),
      'gateway release image should copy the presenters workspace sources required by the ClassroomPath API build'
    );
    assert.ok(
      dockerfile.includes(
        'COPY --from=builder /app/contracts/dist ./node_modules/@classroompath/contracts/dist'
      ),
      'gateway runtime image should restore the built contracts workspace for Node resolution'
    );
    assert.ok(
      dockerfile.includes(
        'COPY --from=builder /app/presenters/dist ./node_modules/@classroompath/presenters/dist'
      ),
      'gateway runtime image should restore the built presenters workspace for Node resolution'
    );
    assert.ok(
      dockerignore.includes('tests/**'),
      'gateway release image should ignore repo-level tests from its Docker context'
    );
    assert.ok(
      dockerignore.includes('react-spa/src/**/__tests__/**'),
      'gateway release image should ignore ClassroomPath SPA unit tests from its Docker context'
    );
    assert.ok(
      dockerignore.includes('upstream/openpath/react-spa/src/**/__tests__/**'),
      'gateway release image should ignore OpenPath SPA unit tests from its Docker context'
    );
  });

  void test('spa release image narrows its build inputs to avoid unrelated cache invalidation', () => {
    assert.ok(existsSync(spaDockerfilePath), 'Dockerfile.spa should exist');
    assert.ok(existsSync(spaDockerignorePath), 'Dockerfile.spa.dockerignore should exist');

    const dockerfile = readFileSync(spaDockerfilePath, 'utf-8');
    const dockerignore = readFileSync(spaDockerignorePath, 'utf-8');

    assert.ok(
      !dockerfile.includes('COPY . .'),
      'spa release image should not copy the entire repository into the build stage'
    );
    assert.ok(
      dockerfile.includes('COPY react-spa/src ./react-spa/src'),
      'spa release image should copy only the ClassroomPath SPA sources it builds'
    );
    assert.ok(
      dockerfile.includes('COPY upstream/openpath/react-spa/src ./upstream/openpath/react-spa/src'),
      'spa release image should copy the upstream OpenPath SPA sources it imports'
    );
    assert.ok(
      dockerfile.includes('COPY contracts/package*.json ./contracts/'),
      'spa release image should copy the contracts workspace manifest required by the ClassroomPath SPA build'
    );
    assert.ok(
      dockerfile.includes('COPY contracts/src ./contracts/src'),
      'spa release image should copy the contracts workspace sources required by the ClassroomPath SPA build'
    );
    assert.ok(
      dockerignore.includes('tests/**'),
      'spa release image should ignore repo-level tests from its Docker context'
    );
    assert.ok(
      dockerignore.includes('react-spa/src/**/__tests__/**'),
      'spa release image should ignore ClassroomPath SPA unit tests from its Docker context'
    );
    assert.ok(
      dockerignore.includes('upstream/openpath/react-spa/src/**/__tests__/**'),
      'spa release image should ignore OpenPath SPA unit tests from its Docker context'
    );
  });

  void test('release verifier image packages the repo test entrypoints for tag promotion gates', () => {
    assert.ok(existsSync(verifierDockerfilePath), 'Dockerfile.release-verifier should exist');

    const dockerfile = readFileSync(verifierDockerfilePath, 'utf-8');

    assert.ok(
      dockerfile.includes('COPY . .'),
      'release verifier image should copy the repository sources needed by the gate tests'
    );
    assert.ok(
      dockerfile.includes('npm ci'),
      'release verifier image should install dependencies during the candidate build, not on the tag workflow'
    );
    assert.ok(
      dockerfile.includes('--mount=type=cache,target=/root/.npm'),
      'release verifier image should cache npm downloads across repeated candidate builds'
    );
    assert.ok(
      dockerfile.includes('tests/release-gate.test.ts') ||
        dockerfile.includes('tests/smoke.test.ts') ||
        dockerfile.includes('WORKDIR /app'),
      'release verifier image should target the repository test workspace'
    );
  });

  void test('ClassroomPath release Dockerfiles use npm cache mounts where they install dependencies', () => {
    const cases = [
      'docker/Dockerfile.cp-api',
      'docker/Dockerfile.spa',
      'docker/Dockerfile.release-verifier',
      'docker/Dockerfile.migrations',
    ];

    for (const relativePath of cases) {
      const content = readFileSync(resolve(projectRoot, relativePath), 'utf-8');
      assert.ok(
        content.includes('--mount=type=cache,target=/root/.npm'),
        `${relativePath} should cache npm downloads across repeated image builds`
      );
    }
  });

  void test('shared SSH host resolver script exists for deploy workflows', () => {
    const resolverScriptPath = resolve(projectRoot, 'scripts/resolve-ssh-host.sh');
    assert.ok(existsSync(resolverScriptPath), 'scripts/resolve-ssh-host.sh should exist');
    const content = readFileSync(resolverScriptPath, 'utf-8');
    assert.ok(content.includes('getent hosts'), 'resolver should try system DNS resolution first');
    assert.ok(content.includes('dig +short'), 'resolver should fall back to dig when needed');
    assert.ok(
      content.includes('getent ahostsv4'),
      'resolver should try IPv4-specific resolution when getent hosts is empty'
    );
    assert.ok(
      content.includes('nslookup "$HOST" 1.1.1.1'),
      'resolver should query an explicit recursive resolver when local NSS resolution is flaky'
    );
    assert.ok(
      content.includes('https://dns.google/resolve'),
      'resolver should fall back to DNS-over-HTTPS before failing'
    );
  });

  void test('shared readiness and smoke helpers exist for reusable deployment verification', () => {
    const waitForReadyPath = resolve(projectRoot, 'scripts/wait-for-ready.sh');
    const runSmokePath = resolve(projectRoot, 'scripts/run-smoke-in-verifier.sh');

    assert.ok(existsSync(waitForReadyPath), 'scripts/wait-for-ready.sh should exist');
    assert.ok(existsSync(runSmokePath), 'scripts/run-smoke-in-verifier.sh should exist');

    const waitForReady = readFileSync(waitForReadyPath, 'utf-8');
    const runSmoke = readFileSync(runSmokePath, 'utf-8');

    assert.ok(waitForReady.includes('"ready":true'), 'readiness helper should poll for ready=true');
    assert.ok(
      runSmoke.includes('CLASSROOMPATH_VERIFIER_IMAGE'),
      'smoke helper should require the prebuilt verifier image reference'
    );
    assert.ok(
      runSmoke.includes('npm run test:smoke'),
      'smoke helper should execute the shared smoke entrypoint'
    );
  });

  void test('dockerized migration wrapper can delegate to a prebuilt migration runner image', () => {
    const content = readFileSync(migrationsScriptPath, 'utf-8');

    assert.ok(
      content.includes('--runner-image <image>'),
      'run-migrations-docker.sh should document the prebuilt runner image flag'
    );
    assert.ok(
      content.includes('RUNNER_IMAGE=""'),
      'run-migrations-docker.sh should track the optional runner image'
    );
    assert.ok(
      content.includes('"$RUNNER_IMAGE"'),
      'run-migrations-docker.sh should execute the requested prebuilt runner image'
    );
    assert.ok(
      content.includes('derive-openpath-db-env.mjs') &&
        content.includes('node /derive-openpath-db-env.mjs'),
      'run-migrations-docker.sh should derive OpenPath DB_* env vars from the shared helper before db:push'
    );
    assert.ok(
      content.indexOf('if [ -n "$RUNNER_IMAGE" ]; then') <
        content.indexOf('docker_select_image_with_fallback'),
      'run-migrations-docker.sh should skip generic node image pulls when a prebuilt runner image is provided'
    );
  });

  void test('verify-full keeps DATABASE_URL canonical and derives OpenPath DB_* env through the shared helper', () => {
    const verifyScript = readFileSync(verifyFullOrchestratorPath, 'utf-8');

    assert.ok(
      verifyScript.includes('function buildTestDatabaseUrl(testDbPort: number): string') &&
        verifyScript.includes('DATABASE_URL: buildTestDatabaseUrl(plan.testDbPort)'),
      'verify-full should keep DATABASE_URL as the canonical test database contract'
    );
    assert.ok(
      verifyScript.includes(
        "capture('node', [join(ROOT_DIR, 'scripts/derive-openpath-db-env.mjs')]"
      ),
      'verify-full should derive OpenPath DB_* compatibility env through the shared helper'
    );
    assert.ok(
      !verifyScript.includes("DB_HOST: 'localhost'") &&
        !verifyScript.includes("DB_PORT: '5432'") &&
        !verifyScript.includes('verifyEnv.DB_HOST') &&
        !verifyScript.includes('verifyEnv.DB_PORT'),
      'verify-full should not duplicate OpenPath DB_* derivation inline'
    );
  });

  void test('production deploy uses release-candidate migrations and verifies staging state first', () => {
    const content = readFileSync(deployWorkflowPath, 'utf-8');
    const stagingVerificationScript = readFileSync(
      resolve(projectRoot, 'scripts/verify-staging-release-state.sh'),
      'utf-8'
    );
    const deployRemoteScript = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const rollbackRemoteScript = readFileSync(
      resolve(projectRoot, 'scripts/rollback-production-remote.sh'),
      'utf-8'
    );

    assert.ok(
      content.includes(
        'RELEASE_MANIFEST_B64: ${{ needs.resolve-release-images.outputs.manifest_base64 }}'
      ),
      'deploy workflow should propagate the resolved release manifest into production deployment'
    );
    assert.ok(
      content.includes('OPENPATH_LINUX_AGENT_VERSION'),
      'deploy workflow should propagate the pinned OpenPath Linux agent version into production deployment'
    );
    assert.ok(
      content.includes('verify-staging-release-state'),
      'deploy workflow should verify staging release state before production rollout'
    );
    assert.ok(
      content.includes('script_path: scripts/deploy-production-remote.sh') &&
        deployRemoteScript.includes(
          'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"'
        ),
      'production deploy should run migrations from the prebuilt runner image instead of npm-installing on the host'
    );
    assert.ok(
      content.includes(
        'RELEASE_MANIFEST_B64: ${{ needs.resolve-release-images.outputs.manifest_base64 }}'
      ),
      'deploy workflow should pass the resolved release manifest as a single payload into the SSH deploy boundary'
    );
    assert.ok(
      content.includes('staging-verification.env'),
      'deploy workflow should read the persisted staging verification evidence before production rollout'
    );
    assert.ok(
      content.includes('verify-staging-release-state.sh') &&
        stagingVerificationScript.includes('STAGING_RELEASE_GATE_RESULT'),
      'deploy workflow should require successful staging release-gate evidence instead of rerunning the same gate'
    );
    assert.ok(
      stagingVerificationScript.includes('STAGING_WINDOWS_BOOTSTRAP_RESULT') &&
        stagingVerificationScript.includes('STAGING_FIREFOX_POLICY_RESULT'),
      'deploy workflow should consume the Windows/Firefox staging evidence fields for promotion decisions'
    );
    assert.ok(
      stagingVerificationScript.includes('PASS_WITH_FALLBACK'),
      'deploy workflow should explicitly distinguish fallback smoke evidence from production-grade evidence'
    );
    assert.ok(
      !content.includes('name: Release Gate Staging'),
      'deploy workflow should not rerun a separate staging release-gate job during production promotion'
    );
    assert.ok(
      !content.includes('docker buildx imagetools inspect'),
      'deploy workflow should not re-resolve digests from image tags during tag promotion'
    );
    assert.ok(
      !content.includes('run: sleep 30'),
      'deploy workflow should replace the fixed smoke delay with readiness polling'
    );
    assert.ok(
      deployRemoteScript.includes('write_release_runtime_state') &&
        deployRemoteScript.includes('"$OPENPATH_LINUX_AGENT_VERSION"'),
      'production deploy should persist the pinned OpenPath Linux agent version in release-state metadata'
    );
    assert.ok(
      deployRemoteScript.includes(
        'upsert_env_file_var "$APP_DIR/config/.env" OPENPATH_LINUX_AGENT_VERSION "$OPENPATH_LINUX_AGENT_VERSION"'
      ),
      'production deploy should persist the pinned OpenPath Linux agent version into the runtime env file before compose up'
    );
    assert.ok(
      deployRemoteScript.includes('decode_release_manifest_base64 "$RELEASE_MANIFEST_B64"') &&
        deployRemoteScript.includes(
          'load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"'
        ),
      'production deploy should load immutable image refs from the shared release manifest helper'
    );
    assert.ok(
      deployRemoteScript.includes(
        'COMMON_SH_PATH="$(resolve_remote_helper_path "$SCRIPT_DIR" "$APP_DIR" "lib/common.sh")"'
      ),
      'production deploy should resolve common.sh through the shared remote bootstrap helper when the runner does not preserve the original script directory'
    );
    assert.ok(
      deployRemoteScript.includes('classify_migration_risk() {'),
      'production deploy should define a local migration risk classifier before the remote checkout so it does not depend on node on the target host'
    );
    assert.ok(
      deployRemoteScript.includes(
        'classify_migration_risk "$APP_DIR" "$PREVIOUS_APP_SHA" "$TARGET_SHA"'
      ),
      'production deploy should evaluate migration risk through the local shell classifier instead of requiring node on the target host'
    );
    assert.ok(
      deployRemoteScript.includes(
        'git -C "$repo_root" diff --name-only "${from_ref}..${to_ref}" --'
      ) && deployRemoteScript.includes("'upstream/openpath/api/drizzle/*.sql'"),
      'production deploy should classify migration risk from git diff output covering both ClassroomPath and OpenPath SQL migrations'
    );
    assert.ok(
      deployRemoteScript.includes('upsert_env_file_var() {'),
      'production deploy should define a local env-file updater so production promotion does not depend on helper functions added after the currently deployed revision'
    );
    assert.ok(
      deployRemoteScript.includes('git submodule update --init --recursive --force') &&
        deployRemoteScript.includes('reload_deployed_common_helpers'),
      'production deploy should reload helper functions from the freshly checked out app revision before using post-checkout helpers'
    );
    assert.ok(
      rollbackRemoteScript.includes('upsert_env_file_var() {'),
      'production rollback should define a local env-file updater so rollbacks to older revisions do not depend on helper functions missing from that target revision'
    );
  });

  void test('release candidate workflow publishes a verifier image in the manifest artifact', () => {
    const content = readFileSync(releaseCandidateWorkflowPath, 'utf-8');

    assert.ok(
      content.includes('build-verifier-release-candidate'),
      'release candidate workflow should include a dedicated verifier image build job'
    );
    assert.ok(
      content.includes('docker/Dockerfile.release-verifier'),
      'release candidate workflow should build the verifier image from Dockerfile.release-verifier'
    );
    assert.ok(
      content.includes('CLASSROOMPATH_VERIFIER_IMAGE='),
      'release candidate manifest artifact should include the verifier image reference'
    );
    assert.ok(
      content.includes('OPENPATH_LINUX_AGENT_VERSION='),
      'release candidate manifest artifact should include the pinned OpenPath Linux agent version'
    );
    assert.ok(
      content.includes('resolve-openpath-linux-agent-version.mjs'),
      'release candidate workflow should resolve the OpenPath Linux agent version automatically before publishing the manifest'
    );
  });

  void test('dockerized runtime validation executes the TypeScript runtime contract check', () => {
    const validationScriptPath = resolve(projectRoot, 'scripts/validate-runtime-config-docker.sh');
    const content = readFileSync(validationScriptPath, 'utf-8');

    assert.ok(
      content.includes('node --import tsx api/scripts/validate-runtime-config.ts'),
      'validate-runtime-config-docker.sh should execute the runtime config validation entrypoint'
    );
    assert.ok(
      content.includes('npm ci --silent -w @classroompath/api'),
      'validate-runtime-config-docker.sh should install the ClassroomPath API workspace before validating'
    );
  });

  void test('staging deploy reuses the release verifier image for remote runtime validation', () => {
    const localDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
    const remoteDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-remote.sh');
    const validationScriptPath = resolve(projectRoot, 'scripts/validate-runtime-config-docker.sh');

    const localDeploy = readFileSync(localDeployScriptPath, 'utf-8');
    const remoteDeploy = readFileSync(remoteDeployScriptPath, 'utf-8');
    const validationScript = readFileSync(validationScriptPath, 'utf-8');

    assert.ok(
      localDeploy.includes(
        'remote_assignment STAGING_RELEASE_MANIFEST_B64 "$STAGING_RELEASE_MANIFEST_B64"'
      ),
      'deploy-staging-local.sh should forward the shared release manifest payload to the remote staging deploy'
    );
    assert.ok(
      remoteDeploy.includes('CLASSROOMPATH_VERIFIER_IMAGE="${CLASSROOMPATH_VERIFIER_IMAGE:-}"') &&
        remoteDeploy.includes('bash scripts/validate-runtime-config-docker.sh'),
      'deploy-staging-remote.sh should reuse the staged verifier image during runtime validation'
    );
    assert.ok(
      validationScript.includes('CLASSROOMPATH_VERIFIER_IMAGE') &&
        validationScript.indexOf('if [ -n "${CLASSROOMPATH_VERIFIER_IMAGE:-}" ]; then') <
          validationScript.indexOf('docker_select_image_with_fallback'),
      'validate-runtime-config-docker.sh should prefer the prebuilt verifier image before pulling a generic node runtime'
    );
  });

  void test('deploy shell helpers centralize tool-image resolution for migrations, validation, and smoke', () => {
    const deployImagesHelperPath = resolve(projectRoot, 'scripts/lib/deploy-images.sh');
    const helperContent = readFileSync(deployImagesHelperPath, 'utf-8');
    const migrationsContent = readFileSync(migrationsScriptPath, 'utf-8');
    const validationContent = readFileSync(
      resolve(projectRoot, 'scripts/validate-runtime-config-docker.sh'),
      'utf-8'
    );
    const smokeContent = readFileSync(
      resolve(projectRoot, 'scripts/run-smoke-in-verifier.sh'),
      'utf-8'
    );

    assert.ok(existsSync(deployImagesHelperPath), 'scripts/lib/deploy-images.sh should exist');
    assert.ok(
      helperContent.includes('docker_require_image()') &&
        helperContent.includes('docker_select_image_with_fallback()'),
      'deploy image helper should centralize required-image and fallback-image logic'
    );
    assert.ok(
      migrationsContent.includes('source "$SCRIPT_DIR/lib/deploy-images.sh"'),
      'run-migrations-docker.sh should source the shared deploy-images helper'
    );
    assert.ok(
      validationContent.includes('source "$SCRIPT_DIR/lib/deploy-images.sh"'),
      'validate-runtime-config-docker.sh should source the shared deploy-images helper'
    );
    assert.ok(
      smokeContent.includes('source "$SCRIPT_DIR/lib/deploy-images.sh"'),
      'run-smoke-in-verifier.sh should source the shared deploy-images helper'
    );
  });

  void test('release manifest flows through staging and production as a single contract payload', () => {
    const stagingLocal = readFileSync(stagingDeployScriptPath, 'utf-8');
    const stagingRemote = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const productionRemote = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );
    const workflow = readFileSync(resolve(projectRoot, '.github/workflows/deploy.yml'), 'utf-8');
    const manifestHelperPath = resolve(projectRoot, 'scripts/lib/release-manifest.sh');
    const deployPayloadHelperPath = resolve(projectRoot, 'scripts/lib/deploy-payload.mjs');
    const manifestHelper = readFileSync(manifestHelperPath, 'utf-8');
    const deployPayloadHelper = readFileSync(deployPayloadHelperPath, 'utf-8');

    assert.ok(existsSync(manifestHelperPath), 'scripts/lib/release-manifest.sh should exist');
    assert.ok(existsSync(deployPayloadHelperPath), 'scripts/lib/deploy-payload.mjs should exist');
    assert.ok(
      manifestHelper.includes('decode_release_manifest_base64()') &&
        manifestHelper.includes('export_release_manifest_runtime_env()') &&
        manifestHelper.includes('release_manifest_validate_contract()'),
      'release-manifest helper should decode, validate, and export manifest fields from a single payload'
    );
    assert.ok(
      deployPayloadHelper.includes('export function buildDeployPayload') &&
        deployPayloadHelper.includes('export function encodeDeployPayloadBase64') &&
        deployPayloadHelper.includes('export function decodeDeployPayloadBase64'),
      'deploy-payload helper should own the versioned workflow-to-script deploy payload contract'
    );
    assert.ok(
      stagingLocal.includes('STAGING_RELEASE_MANIFEST_FILE=') &&
        stagingLocal.includes('--output-file "$STAGING_RELEASE_MANIFEST_FILE"'),
      'deploy-staging-local.sh should materialize the resolved release manifest to a single file'
    );
    assert.ok(
      stagingLocal.includes('STAGING_DEPLOY_PAYLOAD_B64=') &&
        stagingLocal.includes('remote_assignment STAGING_DEPLOY_PAYLOAD_B64'),
      'deploy-staging-local.sh should forward one versioned deploy payload to the remote deploy'
    );
    assert.ok(
      stagingRemote.includes('decode_deploy_payload_base64 "$STAGING_DEPLOY_PAYLOAD_B64"') &&
        stagingRemote.includes(
          'release_manifest_b64="$(deploy_payload_get "$STAGING_DEPLOY_PAYLOAD_FILE" manifest_base64)"'
        ) &&
        stagingRemote.includes('load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"'),
      'deploy-staging-remote.sh should decode the versioned deploy payload and then load the shared release manifest contract'
    );
    assert.ok(
      workflow.includes('payload_base64: ${{ steps.deploy-payload.outputs.payload_base64 }}'),
      'deploy workflow should expose the versioned deploy payload as a single output'
    );
    assert.ok(
      workflow.includes(
        'DEPLOY_PAYLOAD_B64: ${{ needs.resolve-release-images.outputs.payload_base64 }}'
      ) && workflow.includes('envs: GHCR_USERNAME,GHCR_TOKEN,DEPLOY_PAYLOAD_B64'),
      'production deploy workflow should pass one versioned deploy payload to the SSH boundary'
    );
    assert.ok(
      productionRemote.includes('decode_deploy_payload_base64 "$DEPLOY_PAYLOAD_B64"') &&
        productionRemote.includes(
          'release_manifest_b64="$(deploy_payload_get "$DEPLOY_PAYLOAD_FILE" manifest_base64)"'
        ) &&
        productionRemote.includes(
          'load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"'
        ),
      'deploy-production-remote.sh should validate and load release images from the shared deploy payload contract'
    );
  });

  void test('release runtime helper centralizes manifest loading and runtime state writes', () => {
    const releaseRuntimeHelperPath = resolve(projectRoot, 'scripts/lib/release-runtime.sh');
    const releasePlanHelperPath = resolve(projectRoot, 'scripts/lib/release-plan.mjs');
    const releaseRuntimeHelper = readFileSync(releaseRuntimeHelperPath, 'utf-8');
    const releasePlanHelper = readFileSync(releasePlanHelperPath, 'utf-8');
    const localDeploy = readFileSync(stagingDeployScriptPath, 'utf-8');
    const stagingRemote = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');
    const productionRemote = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );

    assert.ok(existsSync(releaseRuntimeHelperPath), 'scripts/lib/release-runtime.sh should exist');
    assert.ok(existsSync(releasePlanHelperPath), 'scripts/lib/release-plan.mjs should exist');
    assert.ok(
      releaseRuntimeHelper.includes('load_release_manifest_runtime()') &&
        releaseRuntimeHelper.includes('write_release_runtime_state()'),
      'release-runtime helper should own manifest-to-env loading and current runtime state persistence'
    );
    assert.ok(
      releasePlanHelper.includes('export function buildStagingReleasePlan') &&
        releasePlanHelper.includes('export function formatStagingReleasePlanEnv'),
      'release-plan helper should own the typed staging release plan contract and shell export rendering'
    );
    assert.ok(
      localDeploy.includes('node "$SCRIPT_DIR/lib/release-plan.mjs" render-staging-env') &&
        localDeploy.includes('STAGING_RELEASE_PLAN_ENV_FILE="$(mktemp)"'),
      'deploy-staging-local.sh should derive staging image decisions from the typed release-plan helper'
    );
    assert.ok(
      stagingRemote.includes('RELEASE_RUNTIME_HELPER_PATH="$SCRIPT_DIR/lib/release-runtime.sh"') &&
        stagingRemote.includes('load_release_manifest_runtime "$STAGING_RELEASE_MANIFEST_FILE"') &&
        stagingRemote.includes('write_release_runtime_state') &&
        stagingRemote.includes('"$CURRENT_STATE_FILE"'),
      'deploy-staging-remote.sh should reuse the shared release-runtime helper'
    );
    assert.ok(
      productionRemote.includes(
        'RELEASE_RUNTIME_HELPER_PATH="$SCRIPT_DIR/lib/release-runtime.sh"'
      ) &&
        productionRemote.includes(
          'load_release_manifest_runtime "$RELEASE_MANIFEST_FILE" "$TARGET_SHA"'
        ) &&
        productionRemote.includes('write_release_runtime_state') &&
        productionRemote.includes('"$STATE_DIR/current-images.env"'),
      'deploy-production-remote.sh should reuse the shared release-runtime helper'
    );
  });

  void test('staging remote deploy executes explicit deployment phases in order', () => {
    const content = readFileSync(stagingDeployRemoteScriptPath, 'utf-8');

    assert.ok(
      content.includes('prepare_staging_checkout()') &&
        content.includes('run_staging_runtime_validation()') &&
        content.includes('cleanup_staging_disk_if_needed()') &&
        content.includes('run_staging_database_migrations()') &&
        content.includes('start_staging_runtime()') &&
        content.includes('wait_for_staging_runtime_readiness()'),
      'deploy-staging-remote.sh should define explicit phase functions for the remote deploy'
    );
    assert.ok(
      content.indexOf('prepare_staging_checkout') <
        content.indexOf('run_staging_runtime_validation') &&
        content.indexOf('run_staging_runtime_validation') <
          content.indexOf('cleanup_staging_disk_if_needed') &&
        content.indexOf('cleanup_staging_disk_if_needed') <
          content.indexOf('run_staging_database_migrations') &&
        content.indexOf('run_staging_database_migrations') <
          content.indexOf('start_staging_runtime') &&
        content.indexOf('start_staging_runtime') <
          content.indexOf('wait_for_staging_runtime_readiness'),
      'deploy-staging-remote.sh should invoke the remote deploy phases in a stable order'
    );
    assert.ok(
      content.includes('plan_staging_runtime_deploy()') &&
        content.includes('apply_staging_runtime_deploy()') &&
        content.indexOf('plan_staging_runtime_deploy') <
          content.indexOf('apply_staging_runtime_deploy'),
      'deploy-staging-remote.sh should separate deployment planning from remote side effects'
    );
  });

  void test('release-state helpers centralize current-image and staging-verification evidence writes', () => {
    const releaseStateHelperPath = resolve(projectRoot, 'scripts/lib/release-state.sh');
    const deploymentStateHelperPath = resolve(projectRoot, 'scripts/lib/deployment-state.sh');
    const releaseStateHelper = readFileSync(releaseStateHelperPath, 'utf-8');
    const deploymentStateHelper = readFileSync(deploymentStateHelperPath, 'utf-8');
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

    assert.ok(existsSync(releaseStateHelperPath), 'scripts/lib/release-state.sh should exist');
    assert.ok(
      existsSync(deploymentStateHelperPath),
      'scripts/lib/deployment-state.sh should exist'
    );
    assert.ok(
      releaseStateHelper.includes('load_release_state_env()') &&
        releaseStateHelper.includes('write_release_state_snapshot()') &&
        releaseStateHelper.includes('write_current_release_state()') &&
        releaseStateHelper.includes('write_deploy_context_state()') &&
        releaseStateHelper.includes('write_staging_verification_state()'),
      'release-state helper should own schema-based reading and writing deployment evidence snapshots'
    );
    assert.ok(
      deploymentStateHelper.includes('deployment_state_init_paths()') &&
        deploymentStateHelper.includes('deployment_state_capture_previous_release()') &&
        deploymentStateHelper.includes('deployment_state_activate_previous_release()'),
      'deployment-state helper should own current/previous/context rollback state transitions'
    );
    assert.ok(
      stagingRemote.includes('RELEASE_STATE_HELPER_PATH') &&
        stagingRemote.includes("grep -q 'write_deploy_context_state()'") &&
        stagingRemote.includes('write_current_release_state() {') &&
        stagingRemote.includes('write_deploy_context_state() {') &&
        stagingRemote.includes('write_release_runtime_state'),
      'deploy-staging-remote.sh should reuse the shared release-state writers and fall back when the remote helper is outdated'
    );
    assert.ok(
      productionRemote.includes('RELEASE_STATE_HELPER_PATH') &&
        productionRemote.includes("grep -q 'write_deploy_context_state()'") &&
        productionRemote.includes('write_current_release_state() {') &&
        productionRemote.includes('write_deploy_context_state() {') &&
        productionRemote.includes('DEPLOYMENT_STATE_HELPER_PATH') &&
        productionRemote.includes("grep -q 'deployment_state_capture_previous_release()'") &&
        productionRemote.includes('deployment_state_capture_previous_release') &&
        productionRemote.includes('write_release_runtime_state'),
      'deploy-production-remote.sh should reuse the shared release-state/deployment-state writers and fall back when the remote helpers are outdated'
    );
    assert.ok(
      persistVerification.includes('SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"') &&
        persistVerification.includes('SCRIPT_DIR="$APP_DIR/scripts"') &&
        persistVerification.includes('RELEASE_STATE_HELPER_PATH') &&
        persistVerification.includes('STAGING_VERIFICATION_RUNNER_PATH') &&
        persistVerification.includes('persist-evidence'),
      'persist-staging-verification-remote.sh should delegate persistence to the shared staging verification runner'
    );
    assert.ok(
      readFileSync(resolve(projectRoot, 'scripts/deploy-staging-local.sh'), 'utf-8').includes(
        'remote_assignment STAGING_SMOKE_RESULT "$STAGING_SMOKE_RESULT"'
      ) &&
        readFileSync(resolve(projectRoot, 'scripts/deploy-staging-local.sh'), 'utf-8').includes(
          'remote_assignment STAGING_RELEASE_GATE_RESULT "$STAGING_RELEASE_GATE_RESULT"'
        ),
      'deploy-staging-local.sh should forward smoke and release-gate evidence to the remote persistence writer'
    );
    assert.ok(
      rollbackRemote.includes('DEPLOYMENT_STATE_HELPER_PATH') &&
        rollbackRemote.includes('deployment_state_activate_previous_release') &&
        rollbackRemote.includes('deployment_state_load_context'),
      'rollback-production-remote.sh should consume rollback metadata through the shared deployment-state helper'
    );
    assert.ok(
      verifyState.includes('load_release_state_env ./staging-release-state.env') &&
        verifyState.includes('load_release_state_env ./staging-verification.env'),
      'verify-staging-release-state.sh should load evidence through the shared release-state helper'
    );
  });

  void test('production remote deploy executes explicit deployment phases in order', () => {
    const content = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf-8'
    );

    assert.ok(
      content.includes('prepare_production_checkout()') &&
        content.includes('load_production_release_manifest()') &&
        content.includes('classify_production_migration_risk()') &&
        content.includes('run_production_database_migrations()') &&
        content.includes('start_production_runtime()') &&
        content.includes('wait_for_production_runtime_readiness()'),
      'deploy-production-remote.sh should define explicit phase functions for the remote production deploy'
    );
    assert.ok(
      content.indexOf('prepare_production_checkout') <
        content.indexOf('load_production_release_manifest') &&
        content.indexOf('load_production_release_manifest') <
          content.indexOf('classify_production_migration_risk') &&
        content.indexOf('classify_production_migration_risk') <
          content.indexOf('run_production_database_migrations') &&
        content.indexOf('run_production_database_migrations') <
          content.indexOf('start_production_runtime') &&
        content.indexOf('start_production_runtime') <
          content.indexOf('wait_for_production_runtime_readiness'),
      'deploy-production-remote.sh should invoke the remote production phases in a stable order'
    );
    assert.ok(
      content.includes('plan_production_runtime_deploy()') &&
        content.includes('apply_production_runtime_deploy()') &&
        content.indexOf('plan_production_runtime_deploy') <
          content.indexOf('apply_production_runtime_deploy'),
      'deploy-production-remote.sh should separate deployment planning from remote side effects'
    );
  });
});
