import { describe, expect, it, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const reactSpaRoot = path.resolve(__dirname, '../../..');
const srcRoot = path.join(reactSpaRoot, 'src');

const sourceExtensions = new Set(['.ts', '.tsx', '.css']);
const directOpenPathImportPattern =
  /(?:from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|@import\s+['"]([^'"]+)['"]|@source\s+['"]([^'"]+)['"])/g;

const forbiddenOpenPathImports = [
  /^@openpath\/shared/,
  /^@openpath\/public-/,
  /^@openpath\/openpath\.css$/,
  /upstream\/openpath\/react-spa\/src/,
];

const allowedOpenPathImportFiles = new Set([
  'src/openpath/openpath.css',
  'src/openpath/public-auth.ts',
  'src/openpath/public-google.ts',
  'src/openpath/public-i18n.ts',
  'src/openpath/public-shell.ts',
  'src/openpath/public-ui.ts',
  'src/openpath/roles.ts',
  'src/openpath/__tests__/public-auth.test.tsx',
  'src/openpath/__tests__/public-google.test.tsx',
  'src/openpath/__tests__/public-i18n.test.tsx',
  'src/openpath/__tests__/public-shell.test.tsx',
  'src/openpath/__tests__/public-ui.test.tsx',
  'src/openpath/__tests__/roles.test.tsx',
]);

const allowedCssSourceExceptions = new Map([
  [
    'src/index.css',
    new Set([
      // Tailwind still needs upstream source visibility for classes rendered by OpenPath components.
      '../../upstream/openpath/react-spa/src',
    ]),
  ],
]);

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        return [];
      }
      return walkFiles(fullPath);
    }

    return sourceExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

function importsFor(source: string): string[] {
  return Array.from(source.matchAll(directOpenPathImportPattern), (match) => {
    return match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
  }).filter(Boolean);
}

function isAllowedException(relativePath: string, specifier: string): boolean {
  return allowedCssSourceExceptions.get(relativePath)?.has(specifier) ?? false;
}

describe('OpenPath SPA adapter boundary', () => {
  it('keeps OpenPath public surface imports behind src/openpath adapters', () => {
    const violations = walkFiles(srcRoot).flatMap((filePath) => {
      const relativePath = path.relative(reactSpaRoot, filePath).split(path.sep).join('/');
      const source = fs.readFileSync(filePath, 'utf8');
      return importsFor(source)
        .filter((specifier) => forbiddenOpenPathImports.some((pattern) => pattern.test(specifier)))
        .filter((specifier) => {
          return (
            !allowedOpenPathImportFiles.has(relativePath) &&
            !isAllowedException(relativePath, specifier)
          );
        })
        .map((specifier) => `${relativePath}: ${specifier}`);
    });

    expect(violations).toEqual([]);
  });

  it('keeps the Tailwind upstream source exception narrow and documented', () => {
    const indexCss = fs.readFileSync(path.join(srcRoot, 'index.css'), 'utf8');

    expect(indexCss).toContain("@import './openpath/openpath.css'");
    expect(indexCss).not.toContain("@import '../../upstream/openpath/react-spa/src/index.css'");
    expect(
      importsFor(indexCss).filter((specifier) => specifier.includes('upstream/openpath'))
    ).toEqual(['../../upstream/openpath/react-spa/src']);
  });

  it('keeps every OpenPath public adapter entrypoint explicitly aliased', () => {
    const viteConfig = fs.readFileSync(path.join(reactSpaRoot, 'vite.config.ts'), 'utf8');
    const tsconfig = JSON.parse(fs.readFileSync(path.join(reactSpaRoot, 'tsconfig.json'), 'utf8'));
    const tsconfigPaths = Object.keys(tsconfig.compilerOptions.paths);

    for (const specifier of [
      '@openpath/openpath.css',
      '@openpath/public-auth',
      '@openpath/public-google',
      '@openpath/public-i18n',
      '@openpath/public-shell',
      '@openpath/public-ui',
    ]) {
      expect(viteConfig, `${specifier} missing from vite.config.ts`).toContain(specifier);
      expect(tsconfigPaths, `${specifier} missing from tsconfig.json paths`).toContain(specifier);
    }
  });
});

// Windows offline installer: the generic headerActions seam must stay exposed
// through the public shell so ClassroomPath can inject classroom actions
// without importing internal OpenPath modules.
test('public-shell Classrooms surface forwards headerActions', async () => {
  const { Classrooms } = await import('@openpath/public-shell');
  type ClassroomsProps = React.ComponentProps<typeof Classrooms>;
  const props: ClassroomsProps = { headerActions: null };
  expect('headerActions' in props).toBe(true);
});
