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

interface DockerComposeService {
  build?: { context: string; dockerfile: string };
  image?: string;
  ports?: Array<string | number>;
  expose?: Array<string | number>;
  env_file?: string[];
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
  const hostMigrationsScriptPath = resolve(projectRoot, 'scripts/run-migrations.sh');
  const migrationsImageScriptPath = resolve(projectRoot, 'scripts/run-migrations-image.sh');
  const migrationsDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.migrations');
  const gatewayDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.cp-api');
  const gatewayDockerignorePath = resolve(projectRoot, 'docker/Dockerfile.cp-api.dockerignore');
  const spaDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.spa');
  const spaDockerignorePath = resolve(projectRoot, 'docker/Dockerfile.spa.dockerignore');
  const verifierDockerfilePath = resolve(projectRoot, 'docker/Dockerfile.release-verifier');
  const stagingDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
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
    const content = readFileSync(stagingDeployScriptPath, 'utf-8');
    const validateStep = 'bash scripts/validate-runtime-config-docker.sh';
    const pushStep =
      'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"';

    assert.ok(
      content.includes(validateStep),
      'deploy-staging-local.sh should validate runtime config before migrations'
    );
    assert.ok(
      content.indexOf(validateStep) < content.indexOf(pushStep),
      'runtime config validation should happen before migrations'
    );
  });

  void test('verify-full skips coverage cleanup and gating when no API/SPA source coverage is needed', () => {
    const content = readFileSync(verifyFullScriptPath, 'utf-8');

    assert.ok(
      content.includes('NEEDS_COVERAGE_GATE=0'),
      'verify-full.sh should track whether the changed-file coverage gate is actually needed'
    );
    assert.ok(
      content.includes('if [ "$NEEDS_COVERAGE_GATE" = "1" ]; then'),
      'verify-full.sh should guard coverage cleanup and gating behind NEEDS_COVERAGE_GATE'
    );
    assert.ok(
      content.includes('Skipping coverage gate (no changed API/SPA source files).'),
      'verify-full.sh should report when it skips the changed-file coverage gate'
    );
  });

  void test('pre-commit uses verify:commit and the release lane remains available explicitly', () => {
    const packageJson = JSON.parse(readFileSync(classroomPathPackagePath, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const hook = readFileSync(preCommitHookPath, 'utf-8');
    const verifyScript = readFileSync(verifyFullScriptPath, 'utf-8');

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
      verifyScript.includes('if [ "$VERIFY_MODE" = "commit" ]; then'),
      'verify-full.sh should support a dedicated commit verification mode'
    );
    assert.ok(
      verifyScript.includes('npx playwright test --grep="@commit-smoke"'),
      'commit verification mode should use the reduced Playwright smoke subset'
    );
  });

  void test('staging deploy waits for the successful release-candidate manifest before source-build fallback', () => {
    const content = readFileSync(stagingDeployScriptPath, 'utf-8');

    assert.ok(existsSync(releaseImagesScriptPath), 'release-images.mjs should exist');
    assert.ok(
      existsSync(waitForReleaseCandidateScriptPath),
      'wait-for-release-candidate.mjs should exist'
    );
    assert.ok(
      content.includes('node "$SCRIPT_DIR/wait-for-release-candidate.mjs" resolve-manifest'),
      'deploy-staging-local.sh should wait for a successful release-candidate manifest for origin/main'
    );
    assert.ok(
      content.includes('deploy_with_release_candidates'),
      'deploy-staging-local.sh should define a release-candidate deploy path'
    );
    assert.ok(
      content.includes('docker compose pull gateway api spa'),
      'staging deploy should try pulling prebuilt candidate images'
    );
    assert.ok(
      content.includes('STAGING_MIGRATIONS_IMAGE'),
      'staging deploy should resolve a prebuilt migrations image alongside the runtime images'
    );
    assert.ok(
      content.includes('STAGING_RELEASE_WAIT_TIMEOUT_SECONDS'),
      'staging deploy should expose a bounded wait timeout for release candidate availability'
    );
    assert.ok(
      content.includes('CLASSROOMPATH_MIGRATIONS_IMAGE="$STAGING_MIGRATIONS_IMAGE"'),
      'staging deploy should export the release-candidate migrations image into the remote deploy path'
    );
    assert.ok(
      content.indexOf('CLASSROOMPATH_MIGRATIONS_IMAGE="$STAGING_MIGRATIONS_IMAGE"') <
        content.indexOf(
          'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"'
        ),
      'staging deploy should export the release-candidate migrations image before running migrations'
    );
    assert.ok(
      content.includes('if [ "$STAGING_IMAGE_MODE" = "source-build" ]; then'),
      'staging deploy should keep source-build as an explicit opt-in mode'
    );
    assert.ok(
      !content.includes('node "$SCRIPT_DIR/release-images.mjs" outputs --sha "$REMOTE_SHA"'),
      'staging deploy should consume the manifest digests instead of guessing image tags locally'
    );
    assert.ok(
      !content.includes('Falling back to source build for staging'),
      'staging deploy should not silently fall back from release candidates to source builds'
    );
  });

  void test('staging deploy records reusable verification evidence after smoke and release gate pass', () => {
    const content = readFileSync(stagingDeployScriptPath, 'utf-8');

    assert.ok(
      content.includes('STAGING_RUN_RELEASE_GATE="${STAGING_RUN_RELEASE_GATE:-1}"'),
      'deploy-staging-local.sh should default to running the staging release gate during promotion prep'
    );
    assert.ok(
      content.includes('RELEASE_GATE_URL="$CANONICAL_STAGING_URL"'),
      'staging deploy should run the release gate against the canonical staging URL'
    );
    assert.ok(
      content.includes('STAGING_RELEASE_GATE_RESULT=success') ||
        content.includes('STAGING_GATE_RESULT="success"'),
      'staging deploy should capture a successful release-gate result'
    );
    assert.ok(
      content.includes('staging-verification.env'),
      'staging deploy should persist staging-verification.env on the staging host'
    );
    assert.ok(
      content.includes('STAGING_VERIFIED_GATEWAY_IMAGE'),
      'staging verification evidence should record the deployed immutable image digests'
    );
  });

  void test('migration runner image packages the workspace migration entrypoint', () => {
    assert.ok(existsSync(migrationsDockerfilePath), 'Dockerfile.migrations should exist');
    assert.ok(existsSync(migrationsImageScriptPath), 'run-migrations-image.sh should exist');

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
      script.includes('DATABASE_URL') && script.includes('DB_HOST'),
      'migration runner should derive OpenPath DB_* env vars from DATABASE_URL when needed'
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
      dockerfile.includes('tests/release-gate.test.ts') ||
        dockerfile.includes('tests/smoke.test.ts') ||
        dockerfile.includes('WORKDIR /app'),
      'release verifier image should target the repository test workspace'
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
  });

  void test('production deploy uses release-candidate migrations and verifies staging state first', () => {
    const content = readFileSync(deployWorkflowPath, 'utf-8');

    assert.ok(
      content.includes('CLASSROOMPATH_MIGRATIONS_IMAGE'),
      'deploy workflow should propagate the prebuilt migrations image into production deployment'
    );
    assert.ok(
      content.includes('verify-staging-release-state'),
      'deploy workflow should verify staging release state before production rollout'
    );
    assert.ok(
      content.includes(
        'bash scripts/run-migrations-docker.sh --cp --openpath --runner-image "$CLASSROOMPATH_MIGRATIONS_IMAGE"'
      ),
      'production deploy should run migrations from the prebuilt runner image instead of npm-installing on the host'
    );
    assert.ok(
      content.includes('staging-verification.env'),
      'deploy workflow should read the persisted staging verification evidence before production rollout'
    );
    assert.ok(
      content.includes('STAGING_RELEASE_GATE_RESULT'),
      'deploy workflow should require successful staging release-gate evidence instead of rerunning the same gate'
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
});
