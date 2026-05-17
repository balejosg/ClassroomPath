import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import express from 'express';

import { registerGatewaySpaRoutes } from '../src/lib/gateway/spa-routes.ts';

const servers: Array<ReturnType<express.Express['listen']>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        })
    )
  );
});

async function startApp(reactSpaPath: string) {
  const app = express();
  registerGatewaySpaRoutes(app, { reactSpaPath });

  const server = app.listen(0);
  servers.push(server);

  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve test server address');
  }

  return `http://127.0.0.1:${String(address.port)}`;
}

async function createReactSpaFixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'cp-spa-file-'));
  const reactSpaPath = path.join(rootDir, 'dist');
  const reactSpaSsrPath = path.join(rootDir, 'dist-ssr');
  const assetsPath = path.join(reactSpaPath, 'assets');

  await mkdir(assetsPath, { recursive: true });
  await mkdir(reactSpaSsrPath, { recursive: true });

  await writeFile(
    path.join(reactSpaPath, 'index.html'),
    [
      '<!doctype html>',
      '<html lang="es">',
      '<head>',
      '<meta charset="UTF-8" />',
      '<title>ClassroomPath</title>',
      '</head>',
      '<body>',
      '<div id="root"></div>',
      '<script type="module" src="/assets/app.js"></script>',
      '</body>',
      '</html>',
    ].join('')
  );
  await writeFile(path.join(assetsPath, 'app.js'), 'console.log("hydrated");');
  await writeFile(
    path.join(reactSpaSsrPath, 'ssr-entry.js'),
    [
      'export function renderPublicPage({ pathname, locale }) {',
      '  if (pathname === "/" || pathname === "/pricing") {',
      '    return {',
      '      appHtml: `<main data-path="${pathname}" data-locale="${locale}">SSR ${pathname} ${locale}</main>`,',
      '      canonicalPath: pathname === "/" ? "/" : "/pricing",',
      '      description: `Description for ${pathname} in ${locale}`,',
      '      title: `${pathname === "/" ? "Landing" : "Pricing"} SSR ${locale}`,',
      '    };',
      '  }',
      '  return null;',
      '}',
    ].join('\n')
  );

  return reactSpaPath;
}

test('falls back to 404 when the SPA dist is missing', async () => {
  const baseUrl = await startApp(path.join(tmpdir(), 'cp-spa-missing-dist'));

  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 404);
});

test('serves SSR public routes and static assets from the built SPA', async () => {
  const reactSpaPath = await createReactSpaFixture();
  const baseUrl = await startApp(reactSpaPath);

  const pricingResponse = await fetch(`${baseUrl}/pricing`, {
    headers: { 'Accept-Language': 'es-ES, en;q=0.5' },
  });
  const pricingHtml = await pricingResponse.text();
  assert.equal(pricingResponse.status, 200);
  assert.equal(pricingResponse.headers.get('vary'), 'Accept-Language');
  assert.match(pricingHtml, /<html lang="es">/);
  assert.match(
    pricingHtml,
    /<main data-path="\/pricing" data-locale="es">SSR \/pricing es<\/main>/
  );
  assert.match(pricingHtml, /data-classroompath-locale="es"/);
  assert.match(pricingHtml, /data-product-locale="es"/);

  const assetResponse = await fetch(`${baseUrl}/assets/app.js`);
  assert.equal(assetResponse.status, 200);
  assert.match(await assetResponse.text(), /hydrated/);
});
