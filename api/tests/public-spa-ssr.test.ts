import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  createPublicSpaRenderer,
  resolveProductLocaleFromAcceptLanguage,
} from '../src/lib/public-spa-ssr.ts';

async function createFixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'cp-public-ssr-'));
  const reactSpaPath = path.join(rootDir, 'dist');
  const reactSpaSsrPath = path.join(rootDir, 'dist-ssr');

  await mkdir(reactSpaPath, { recursive: true });
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

  await writeFile(
    path.join(reactSpaSsrPath, 'ssr-entry.js'),
    [
      'export function renderPublicPage({ pathname, locale }) {',
      '  if (pathname !== "/" && pathname !== "/pricing") return null;',
      '  return {',
      '    appHtml: `<main data-locale="${locale}"><h1>${pathname === "/" ? "Landing" : "Pricing"} ${locale}</h1></main>`,',
      '    canonicalPath: pathname === "/" ? "/" : "/pricing",',
      '    description: `Description for ${pathname} in ${locale}`,',
      '    title: `${pathname === "/" ? "Landing" : "Pricing"} SSR ${locale}`,',
      '  };',
      '}',
    ].join('\n')
  );

  return reactSpaPath;
}

test('returns a disabled renderer when build artifacts are missing', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'cp-public-ssr-missing-'));
  const renderer = createPublicSpaRenderer(path.join(rootDir, 'dist'));

  assert.equal(renderer.canRender, false);
  assert.equal(
    await renderer.render({
      locale: 'en',
      origin: 'https://classroompath.test',
      pathname: '/',
    }),
    null
  );
});

test('renders SSR HTML with metadata for supported public routes', async () => {
  const reactSpaPath = await createFixture();
  const renderer = createPublicSpaRenderer(reactSpaPath);

  assert.equal(renderer.canRender, true);

  const html = await renderer.render({
    locale: 'es',
    origin: 'https://classroompath.test',
    pathname: '/pricing',
  });

  assert.ok(html);
  assert.match(html, /<html lang="es">/);
  assert.match(
    html,
    /<div id="root" data-classroompath-public-ssr="true" data-classroompath-locale="es" data-product-locale="es"><main data-locale="es"><h1>Pricing es<\/h1><\/main><\/div>/
  );
  assert.match(html, /window\.__CLASSROOMPATH_PRODUCT_LOCALE__="es"/);
  assert.match(html, /<title>Pricing SSR es<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/classroompath\.test\/pricing" \/>/);
  assert.match(html, /<meta property="og:title" content="Pricing SSR es" \/>/);
});

test('returns null when the SSR module does not support a route', async () => {
  const reactSpaPath = await createFixture();
  const renderer = createPublicSpaRenderer(reactSpaPath);

  assert.equal(
    await renderer.render({
      locale: 'en',
      origin: 'https://classroompath.test',
      pathname: '/login',
    }),
    null
  );
});

test('resolves product locale from Accept-Language with English default', () => {
  assert.equal(resolveProductLocaleFromAcceptLanguage(undefined), 'en');
  assert.equal(resolveProductLocaleFromAcceptLanguage('fr-FR,es;q=0.8,en;q=0.4'), 'es');
  assert.equal(resolveProductLocaleFromAcceptLanguage('de-DE,en-US;q=0.9,es;q=0.7'), 'en');
  assert.equal(resolveProductLocaleFromAcceptLanguage('es-ES, en;q=0.8'), 'es');
  assert.equal(resolveProductLocaleFromAcceptLanguage('fr-FR,*;q=0.5'), 'en');
});
