import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createPublicSpaRenderer } from '../src/lib/public-spa-ssr.ts';

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
      'export function renderPublicPage(pathname) {',
      '  if (pathname !== "/" && pathname !== "/pricing") return null;',
      '  return {',
      '    appHtml: `<main><h1>${pathname === "/" ? "Landing" : "Pricing"}</h1></main>`,',
      '    canonicalPath: pathname === "/" ? "/" : "/pricing",',
      '    description: `Description for ${pathname}`,',
      '    title: pathname === "/" ? "Landing SSR" : "Pricing SSR",',
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
    origin: 'https://classroompath.test',
    pathname: '/pricing',
  });

  assert.ok(html);
  assert.match(html, /<div id="root"><main><h1>Pricing<\/h1><\/main><\/div>/);
  assert.match(html, /<title>Pricing SSR<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/classroompath\.test\/pricing" \/>/);
  assert.match(html, /<meta property="og:title" content="Pricing SSR" \/>/);
});

test('returns null when the SSR module does not support a route', async () => {
  const reactSpaPath = await createFixture();
  const renderer = createPublicSpaRenderer(reactSpaPath);

  assert.equal(
    await renderer.render({
      origin: 'https://classroompath.test',
      pathname: '/login',
    }),
    null
  );
});
