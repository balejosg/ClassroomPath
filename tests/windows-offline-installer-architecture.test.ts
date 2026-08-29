import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');

function walk(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walk(path));
    } else if (/\.(?:js|mjs|ts|tsx|yml|yaml|sh|env|example)$/u.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

test('ClassroomPath has one Windows offline installer lifecycle: the OpenPath capability', () => {
  const legacyPaths = [
    'api/src/services/windows-offline-installer-artifact.service.ts',
    'api/src/services/windows-offline-installer-download-refs.service.ts',
    'api/src/services/windows-offline-installer-template-cache.service.ts',
    'api/src/lib/windows-offline-installer-config.ts',
    'api/src/lib/windows-offline-installer-overlay.ts',
    'api/src/lib/windows-offline-installer-route.ts',
    'api/src/lib/windows-offline-installer-readiness.ts',
    'api/src/lib/windows-offline-installer-ticket-client.ts',
    'scripts/provision-windows-offline-installer-template.mjs',
    'scripts/lib/windows-offline-installer-template-path.mjs',
  ];

  for (const legacyPath of legacyPaths) {
    assert.equal(
      existsSync(join(projectRoot, legacyPath)),
      false,
      `legacy path remains: ${legacyPath}`
    );
  }

  const scanRoots = ['api/src', 'config', 'docker', 'react-spa/src', 'scripts'];
  const sourceFiles = scanRoots.flatMap((root) => walk(join(projectRoot, root)));
  const retiredRoute = ['/cp/api', '/windows-offline-installer/download'].join('');
  const retiredRoutePolicyPath = 'api/src/lib/openpath-proxy-policy.ts';
  const forbiddenFragments = [
    ['CP', '_OFFLINE_INSTALLER_'].join(''),
    'createWindowsOfflineInstallerDownloadHandler',
    'createWindowsOfflineDownloadRefsService',
    'createWindowsOfflineInstallerService',
    'loadWindowsOfflineInstallerConfig',
    'checkWindowsOfflineInstallerReadiness',
    'callOpenPathEnrollmentTicket',
    'applyWindowsOfflineOverlay',
    'provision-windows-offline-installer-template.mjs',
    'windows-offline-installer-template-path.mjs',
  ];

  const violations: string[] = [];
  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf8');
    if (content.includes(retiredRoute) && relative(projectRoot, file) !== retiredRoutePolicyPath) {
      violations.push(`${relative(projectRoot, file)} contains an active retired installer route`);
    }
    for (const fragment of forbiddenFragments) {
      if (content.includes(fragment)) {
        violations.push(`${relative(projectRoot, file)} contains ${fragment}`);
      }
    }
  }

  const proxyPolicy = readFileSync(join(projectRoot, retiredRoutePolicyPath), 'utf8');
  assert.match(
    proxyPolicy,
    /notFoundRoutes: \[[\s\S]*\/cp\/api\/windows-offline-installer\/download/u,
    'the retired route must remain an explicit 404 policy entry'
  );
  assert.deepEqual(violations, [], 'generic ClassroomPath installer ownership reappeared');
});
