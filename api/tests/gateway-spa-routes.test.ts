import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import express from 'express';

import { registerGatewaySpaRoutes } from '../src/lib/gateway-routes.ts';

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
  const rootDir = await mkdtemp(path.join(tmpdir(), 'cp-spa-'));
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

test('SSR renders landing and preserves client asset references', async () => {
  const reactSpaPath = await createReactSpaFixture();
  const baseUrl = await startApp(reactSpaPath);

  const response = await fetch(baseUrl, { headers: { 'Accept-Language': 'es-ES, en;q=0.5' } });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('vary'), 'Accept-Language');
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(html, /<html lang="es">/);
  assert.match(
    html,
    /<div id="root" data-classroompath-public-ssr="true" data-classroompath-locale="es" data-product-locale="es">/
  );
  assert.match(html, /<main data-path="\/" data-locale="es">SSR \/ es<\/main>/);
  assert.match(html, /window\.__CLASSROOMPATH_PRODUCT_LOCALE__="es"/);
  assert.match(html, /<title>Landing SSR es<\/title>/);
  assert.match(html, /<meta name="description" content="Description for \/ in es/);
  assert.match(html, /<script type="module" src="\/assets\/app.js"><\/script>/);
});

test('SSR renders pricing while other public routes fall back to the SPA shell', async () => {
  const reactSpaPath = await createReactSpaFixture();
  const baseUrl = await startApp(reactSpaPath);

  const pricingResponse = await fetch(`${baseUrl}/pricing`);
  const pricingHtml = await pricingResponse.text();
  assert.equal(pricingResponse.status, 200);
  assert.equal(pricingResponse.headers.get('vary'), 'Accept-Language');
  assert.match(
    pricingHtml,
    /<main data-path="\/pricing" data-locale="en">SSR \/pricing en<\/main>/
  );
  assert.match(pricingHtml, /<title>Pricing SSR en<\/title>/);

  const loginResponse = await fetch(`${baseUrl}/login`);
  const loginHtml = await loginResponse.text();
  assert.equal(loginResponse.status, 200);
  assert.doesNotMatch(loginHtml, /SSR \/login/);
  assert.match(loginHtml, /<div id="root"><\/div>/);
});

test('static assets still come from the gateway SPA handler', async () => {
  const reactSpaPath = await createReactSpaFixture();
  const baseUrl = await startApp(reactSpaPath);

  const response = await fetch(`${baseUrl}/assets/app.js`);

  assert.equal(response.status, 200);
  assert.match(await response.text(), /hydrated/);
});
