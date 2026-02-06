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
      api.ports?.some((p) => String(p).includes('3000')) ||
        api.expose?.some((p) => String(p).includes('3000')),
      'API should expose or publish port 3000'
    );
    assert.ok(api.healthcheck, 'API should have healthcheck');
    assert.ok(api.env_file, 'API should use env_file');
  });

  void test('SPA service is properly configured', () => {
    const content = readFileSync(composePath, 'utf-8');
    const compose = parseYaml(content) as DockerCompose;

    assert.ok(compose.services['spa'], 'SPA service should exist');

    const spa = compose.services['spa'];
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
});

void describe('Environment Configuration', () => {
  const envExamplePath = resolve(projectRoot, 'config/.env.example');

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
