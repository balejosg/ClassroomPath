import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

process.env.NODE_ENV = 'test';

const routerModule = await import('../src/trpc/routers/windows-offline-installer.js');
const { appRouter } = await import('../src/trpc/router.js');

const ROUTER_SOURCE = await readFile(
  path.join(import.meta.dirname, '..', 'src', 'trpc', 'routers', 'windows-offline-installer.ts'),
  'utf8'
);

describe('windows-offline-installer tRPC router', () => {
  test('mounts a protected generate procedure on the app router', () => {
    assert.ok(appRouter.windowsOfflineInstaller, 'appRouter should mount windowsOfflineInstaller');
    assert.equal(typeof routerModule.windowsOfflineInstallerRouter.generate, 'function');
  });

  test('generate is a teacher/admin-guarded mutation with a bounded classroomId input', () => {
    assert.match(ROUTER_SOURCE, /teacherOrAdminProcedure/);
    assert.match(ROUTER_SOURCE, /\.mutation\(/);
    assert.match(ROUTER_SOURCE, /classroomId: z\.string\(\)\.min\(1\)\.max\(128\)/);
    assert.match(ROUTER_SOURCE, /generateClassroomPathWindowsOfflineInstaller/);
    assert.doesNotMatch(ROUTER_SOURCE, /artifact|download-refs|windows-offline-installer-route/);
  });

  test('never returns token material in the output contract', () => {
    assert.match(ROUTER_SOURCE, /generateClassroomPathWindowsOfflineInstaller/);
    assert.doesNotMatch(ROUTER_SOURCE, /artifactPath|referenceHash|enrollmentToken/);
    assert.doesNotMatch(ROUTER_SOURCE, /enrollmentToken:/);
  });
});
