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
      content.includes('COPY windows/ ./windows/'),
      'Builder image should copy Windows agent sources into the build context'
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
  const stagingDeployScriptPath = resolve(projectRoot, 'scripts/deploy-staging-local.sh');
  const releaseImagesScriptPath = resolve(projectRoot, 'scripts/release-images.mjs');

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
    const pushStep = 'bash scripts/run-migrations-docker.sh --cp --openpath';

    assert.ok(
      content.includes(validateStep),
      'deploy-staging-local.sh should validate runtime config before migrations'
    );
    assert.ok(
      content.indexOf(validateStep) < content.indexOf(pushStep),
      'runtime config validation should happen before migrations'
    );
  });

  void test('staging deploy resolves release-candidate image refs before source-build fallback', () => {
    const content = readFileSync(stagingDeployScriptPath, 'utf-8');

    assert.ok(existsSync(releaseImagesScriptPath), 'release-images.mjs should exist');
    assert.ok(
      content.includes('node "$SCRIPT_DIR/release-images.mjs" outputs --sha "$REMOTE_SHA"'),
      'deploy-staging-local.sh should derive release image refs for origin/main'
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
      content.includes('deploy_from_source'),
      'staging deploy should retain a source-build fallback path'
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
