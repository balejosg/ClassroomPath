import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const apiDir = dirname(dirname(currentFilePath));
const libDir = resolve(apiDir, 'src/lib');

function readLibFile(relativePath: string): string {
  return readFileSync(resolve(libDir, relativePath), 'utf8');
}

void describe('gateway composition architecture', () => {
  void test('server delegates gateway wiring through a composition module', () => {
    const serverSource = readFileSync(resolve(apiDir, 'src/server.ts'), 'utf8');
    const composeGatewayPath = resolve(libDir, 'gateway/compose-gateway.ts');

    assert.ok(
      existsSync(composeGatewayPath),
      'api/src/lib/gateway/compose-gateway.ts should exist as the gateway composition entrypoint'
    );
    assert.match(
      serverSource,
      /from '\.\/lib\/gateway\/compose-gateway\.js'/,
      'server.ts should import its gateway wiring from lib/gateway/compose-gateway.js'
    );
    assert.match(
      serverSource,
      /composeGatewayApp\(/,
      'server.ts should use composeGatewayApp() instead of wiring each gateway concern inline'
    );
    assert.doesNotMatch(
      serverSource,
      /registerGateway(BaseMiddleware|ProxyRoutes|HealthRoutes|ApplicationRoutes|SpaRoutes)/,
      'server.ts should not import individual gateway route registrars directly'
    );
  });

  void test('gateway concerns live in focused modules under lib/gateway', () => {
    const expectedModules = [
      'gateway/base-middleware.ts',
      'gateway/health-routes.ts',
      'gateway/proxy-routes.ts',
      'gateway/application-routes.ts',
      'gateway/spa-routes.ts',
      'gateway/compose-gateway.ts',
    ] as const;

    for (const relativePath of expectedModules) {
      assert.ok(
        existsSync(resolve(libDir, relativePath)),
        `${relativePath} should exist as a focused gateway module`
      );
    }
  });

  void test('legacy gateway-routes surface stays as a compatibility wrapper', () => {
    const legacySource = readLibFile('gateway-routes.ts');

    assert.match(
      legacySource,
      /from '\.\/gateway\/base-middleware\.js'/,
      'gateway-routes.ts should re-export the base middleware from the focused gateway module'
    );
    assert.match(
      legacySource,
      /from '\.\/gateway\/compose-gateway\.js'/,
      'gateway-routes.ts should re-export the compose entrypoint from the focused gateway module'
    );
  });
});
