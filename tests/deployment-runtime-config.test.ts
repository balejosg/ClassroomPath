/**
 * Deployment Runtime Configuration Tests
 *
 * Contracts for Docker, environment, nginx, and submodule runtime wiring.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
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
  platform?: string;
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
      api.environment?.includes('JWT_ACCESS_EXPIRY=${JWT_ACCESS_EXPIRY:-24h}'),
      'API should default access tokens to the ClassroomPath 24-hour web session policy'
    );
    assert.ok(
      api.environment?.includes('JWT_REFRESH_EXPIRY=${JWT_REFRESH_EXPIRY:-30d}'),
      'API should default refresh tokens to the ClassroomPath 30-day session policy'
    );
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
      gateway.volumes?.includes('/srv/classroompath/downloads:/app/react-spa/dist/downloads:ro'),
      'Gateway should mount the signed Firefox distribution directory into the public SPA asset root'
    );
  });

  void test('gateway separates read-only template storage from writable artifact volume', () => {
    const content = readFileSync(composePath, 'utf-8');
    const compose = parseYaml(content) as DockerCompose;
    const gateway = compose.services['gateway'];

    assert.ok(
      gateway.environment?.includes(
        'CP_OFFLINE_INSTALLER_TEMPLATE_DIR=/app/var/windows-offline-installer/templates'
      )
    );
    assert.ok(
      gateway.environment?.includes(
        'CP_OFFLINE_INSTALLER_ARTIFACTS_DIR=/app/var/windows-offline-installer/artifacts'
      )
    );
    assert.ok(gateway.environment?.includes('OPENPATH_URL=${OPENPATH_URL:-http://api:3000}'));
    assert.ok(
      gateway.volumes?.some(
        (volume) =>
          volume.includes('${CP_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR') &&
          volume.includes(':/app/var/windows-offline-installer/templates:ro')
      )
    );
    assert.ok(
      gateway.volumes?.includes(
        'windows-offline-installer-artifacts:/app/var/windows-offline-installer/artifacts:rw'
      )
    );
    assert.ok('windows-offline-installer-artifacts' in (compose.volumes ?? {}));
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

  void test('release runtime services pin the supported container platform', () => {
    const content = readFileSync(composePath, 'utf-8');
    const compose = parseYaml(content) as DockerCompose;
    const expectedPlatform = '${CLASSROOMPATH_CONTAINER_PLATFORM:-linux/amd64}';

    for (const serviceName of ['gateway', 'api', 'spa']) {
      assert.strictEqual(
        compose.services[serviceName]?.platform,
        expectedPlatform,
        `${serviceName} should run on the declared deploy target platform`
      );
    }
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
    const [builderStage, runtimeStage] = content.split('# Final production image');

    assert.ok(builderStage, 'Dockerfile.api should include a builder stage');
    assert.ok(runtimeStage, 'Dockerfile.api should include a final runtime stage');

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
      builderStage.includes('COPY shared/ ./shared/'),
      'Builder image should copy shared sources into the TypeScript build context'
    );
    assert.ok(
      builderStage.includes('COPY api/ ./api/'),
      'Builder image should copy API sources into the TypeScript build context'
    );
    assert.ok(
      !builderStage.includes('COPY windows/ ./windows/'),
      'Builder image should keep Windows bootstrap assets out of the expensive build cache'
    );
    assert.ok(
      !builderStage.includes('COPY runtime/ ./runtime/') &&
        !builderStage.includes('COPY runtime ./runtime'),
      'Builder image should keep shared runtime assets out of the expensive build cache'
    );
    assert.ok(
      !builderStage.includes('COPY firefox-extension/ ./firefox-extension/'),
      'Builder image should keep browser extension assets out of the expensive build cache'
    );
    assert.ok(
      !builderStage.includes('COPY VERSION ./VERSION'),
      'Builder image should keep VERSION out of the expensive build cache'
    );
    assert.ok(
      runtimeStage.includes('COPY windows/ ./windows/'),
      'Runtime image should include the Windows bootstrap scripts directly from the build context'
    );
    assert.ok(
      runtimeStage.includes('COPY runtime/ ./runtime/') ||
        runtimeStage.includes('COPY runtime ./runtime'),
      'Runtime image should include shared runtime assets for Windows bootstrap'
    );
    assert.ok(
      runtimeStage.includes('COPY firefox-extension/ ./firefox-extension/'),
      'Runtime image should include browser extension assets for Windows bootstrap and Chromium rollout'
    );
    assert.ok(
      content.includes('COPY --from=builder /app/shared/package.json ./shared/package.json'),
      'Runtime image should restore the full shared package metadata after installing from the dependency-only manifest'
    );
    assert.ok(
      runtimeStage.includes('COPY VERSION ./VERSION'),
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
    const requiredVars = [
      'PORT',
      'PUBLIC_URL',
      'JWT_SECRET',
      'DATABASE_URL',
      'CORS_ORIGINS',
      'JWT_ACCESS_EXPIRY',
      'JWT_REFRESH_EXPIRY',
    ];

    for (const envVar of requiredVars) {
      assert.ok(content.includes(envVar), `Required variable ${envVar} should be documented`);
    }
  });

  void test('.env.example documents the email delivery contract for deployed environments', () => {
    const content = readFileSync(envExamplePath, 'utf-8');
    const requiredVars = [
      'RESEND_API_KEY',
      'RESEND_FROM_EMAIL',
      'CP_FAKE_EMAIL_DELIVERY',
      'CP_EMAIL_PREFLIGHT_MODE',
    ];

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

  void test('.env.example documents canonical Windows offline installer pins and storage', () => {
    const content = readFileSync(envExamplePath, 'utf-8');
    for (const envVar of [
      'CP_OFFLINE_INSTALLER_TEMPLATE_VERSION',
      'CP_OFFLINE_INSTALLER_TEMPLATE_COMMIT',
      'CP_OFFLINE_INSTALLER_TEMPLATE_RELEASE_TAG',
      'CP_OFFLINE_INSTALLER_TEMPLATE_SHA256',
      'CP_OFFLINE_INSTALLER_TEMPLATE_DIR',
      'CP_OFFLINE_INSTALLER_ARTIFACTS_DIR',
      'CP_OFFLINE_INSTALLER_TEMPLATE_HOST_DIR',
      'CP_OFFLINE_INSTALLER_TOKEN_TTL_HOURS',
      'CP_OFFLINE_INSTALLER_DOWNLOAD_TTL_MINUTES',
      'CP_OFFLINE_INSTALLER_DOWNLOAD_MAX_ATTEMPTS',
    ]) {
      assert.ok(content.includes(envVar), `${envVar} should be documented`);
    }
    assert.ok(content.includes('CP_OFFLINE_INSTALLER_TEMPLATE_CACHE_DIR'));
    assert.match(content, /deprecated/i);
  });

  void test('.env.example does not contain actual secrets', () => {
    const content = readFileSync(envExamplePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (
        line.includes('SECRET') ||
        line.includes('PASSWORD') ||
        (line.includes('TOKEN') && !line.includes('TOKEN_TTL'))
      ) {
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

  void test('deploy-targets.json contains only public placeholders', () => {
    assert.ok(existsSync(deployTargetsPath), 'config/deploy-targets.json should exist');

    const targets = JSON.parse(readFileSync(deployTargetsPath, 'utf-8')) as {
      staging?: { publicUrl?: string; canaryPublicUrl?: string; containerPlatform?: string };
      production?: { publicUrl?: string; canaryPublicUrl?: string; containerPlatform?: string };
    };

    assert.strictEqual(
      targets.staging?.publicUrl.endsWith('.invalid'),
      true,
      'Staging public URL should be a placeholder in the public repo'
    );
    assert.strictEqual(
      targets.production?.publicUrl.endsWith('.invalid'),
      true,
      'Production public URL should be a placeholder in the public repo'
    );
    assert.strictEqual(
      targets.staging?.canaryPublicUrl.endsWith('.invalid'),
      true,
      'Staging canary URL should be a placeholder in the public repo'
    );
    assert.strictEqual(
      targets.production?.canaryPublicUrl.endsWith('.invalid'),
      true,
      'Production canary URL should be a placeholder in the public repo'
    );
    assert.strictEqual(
      targets.staging?.containerPlatform,
      'linux/amd64',
      'Staging deploy target should explicitly declare the supported image platform'
    );
    assert.strictEqual(
      targets.production?.containerPlatform,
      'linux/arm64',
      'Production deploy target should match the existing ARM64 server platform'
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

  void test('deploy-targets.mjs accepts private environment overrides', () => {
    const output = execFileSync(
      process.execPath,
      ['scripts/deploy-targets.mjs', 'get', 'production', 'publicUrl'],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          CLASSROOMPATH_PRODUCTION_PUBLIC_URL: 'https://production.example.test',
        },
        encoding: 'utf8',
      }
    ).trim();

    assert.strictEqual(output, 'https://production.example.test');
  });

  void test('deploy-targets.mjs does not derive public URLs from SSH host variables', () => {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ['scripts/deploy-targets.mjs', 'get', 'production', 'publicUrl'],
          {
            cwd: projectRoot,
            env: {
              ...process.env,
              CLASSROOMPATH_DEPLOY_TARGETS_FILE: 'config/deploy-targets.json',
              DEPLOY_HOST: 'ssh-only.example.test',
              STAGING_DEPLOY_HOST: 'staging-ssh-only.example.test',
            },
            encoding: 'utf8',
          }
        ),
      /\.invalid values/,
      'SSH host variables must not satisfy deploy-target public URL resolution'
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
