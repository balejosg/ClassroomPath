import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  createWindowsAjaxAutoAllowRuntimeConfig,
  runWindowsAjaxAutoAllowCanaryRuntime,
} from '../scripts/lib/windows-ajax-auto-allow-runtime.mjs';

describe('Windows AJAX auto-allow runtime module', () => {
  test('normalizes environment config without running the CLI adapter', () => {
    const config = createWindowsAjaxAutoAllowRuntimeConfig({
      WINDOWS_AJAX_AUTO_ALLOW_CANARY_PORT: '19091',
      WINDOWS_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS: '12345',
      WINDOWS_AJAX_AUTO_ALLOW_CANARY_ARTIFACT: 'custom-artifact.json',
      WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_MODE: 'selenium',
      WINDOWS_AJAX_AUTO_ALLOW_LOCAL_ADDON_PATH: 'C:\\addon\\openpath.xpi',
      WINDOWS_AJAX_REDDIT_NAVIGATION_MODE: 'gate',
      WINDOWS_AJAX_REDDIT_DIAGNOSTIC_RETRY_DELAY_MS: '2345',
      WINDOWS_AJAX_REDDIT_NAVIGATION_TIMEOUT_MS: '34567',
      OPENPATH_ROOT: 'D:\\OpenPath',
    });

    assert.equal(config.port, 19091);
    assert.equal(config.timeoutMs, 12345);
    assert.equal(config.artifactPath, 'custom-artifact.json');
    assert.equal(config.firefoxMode, 'selenium');
    assert.equal(config.localAddonPath, 'C:\\addon\\openpath.xpi');
    assert.equal(config.redditNavigationMode, 'gate');
    assert.equal(config.redditDiagnosticRetryDelayMs, 2345);
    assert.equal(config.redditNavigationTimeoutMs, 34567);
    assert.equal(config.useLocalFirefoxAddon, true);
    assert.equal(config.openPathRoot, 'D:\\OpenPath');
    assert.equal(config.whitelistPath, 'D:\\OpenPath\\data\\whitelist.txt');
  });

  test('writes failure artifact and restores managed policy/profile resources on warmup timeout', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'windows-ajax-runtime-'));
    const artifactPath = join(tempDir, 'artifact.json');
    const cleanupEvents: string[] = [];
    const progressLines: string[] = [];

    try {
      const config = createWindowsAjaxAutoAllowRuntimeConfig({
        WINDOWS_AJAX_AUTO_ALLOW_CANARY_ARTIFACT: artifactPath,
        WINDOWS_AJAX_AUTO_ALLOW_CANARY_TIMEOUT_MS: '10',
        WINDOWS_AJAX_AUTO_ALLOW_FIREFOX_WARMUP_TIMEOUT_MS: '5',
        WINDOWS_AJAX_AUTO_ALLOW_POST_SUCCESS_OBSERVATION_MS: '0',
      });

      await assert.rejects(
        () =>
          runWindowsAjaxAutoAllowCanaryRuntime(config, {
            browser: {
              findFirefox: () => 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
              waitForFirefoxExtensionReady: async () => ({
                ready: false,
                registryAddonPresent: false,
                profileExtensionPresent: false,
              }),
              launchFirefoxWithSelenium: async () => {
                throw new Error('selenium should not run');
              },
              spawnFirefox: () => {
                throw new Error('firefox should not launch after failed warmup');
              },
            },
            diagnostics: {
              collectWindows: async (phase) => ({ phase }),
              collectReddit: async (phase) => ({ phase }),
            },
            filesystem: {
              makeProfileDir: async () => join(tempDir, 'profile'),
              removeProfileDir: async () => cleanupEvents.push('profile'),
              writeArtifact: async (path, contents) => {
                await import('node:fs/promises').then((fs) => fs.writeFile(path, contents, 'utf8'));
              },
              readWhitelistContainsHost: async () => false,
            },
            server: {
              createProbeServer: async () => ({
                state: {
                  originHits: 0,
                  probeHits: {},
                  browserAttempts: [],
                  completedProbes: {},
                  completedCandidateEvents: {},
                  completedRedditDiagnosticEvents: {},
                  pageResourceCandidateEvents: [],
                  pageObserverInstalled: false,
                  lastAttemptAt: null,
                },
                result: new Promise(() => {}),
                close: () => cleanupEvents.push('server'),
              }),
            },
            policy: {
              suspendFirefoxEnterprisePolicy: async () => ({ suspended: false }),
              restoreFirefoxEnterprisePolicy: async () => cleanupEvents.push('policy'),
            },
            output: {
              error: (line: string) => {
                if (line.startsWith('CANARY_PROGRESS ')) progressLines.push(line);
              },
              log: () => {},
              githubOutput: () => {},
            },
          }),
        /Timed out after 5ms waiting for Firefox extension/
      );

      const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
      assert.equal(artifact.success, false);
      assert.equal(artifact.diagnostics.preflight.phase, 'preflight');
      assert.equal(artifact.diagnostics.postFailure.phase, 'post-firefox-warmup-failure');
      assert.deepEqual(cleanupEvents, ['server', 'profile', 'policy']);
      assert.deepEqual(
        progressLines.map((line) => {
          const payload = JSON.parse(line.slice('CANARY_PROGRESS '.length));
          return [payload.canary, payload.phase, payload.status, payload.boundaryId ?? null];
        }),
        [
          ['windows-ajax', 'bootstrap', 'started', null],
          ['windows-ajax', 'bootstrap', 'passed', 'none'],
          ['windows-ajax', 'firefox-extension-ready', 'failed', 'firefox-extension-ready'],
        ]
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('delegates page and probe server behavior to the shared AJAX canary runtime', async () => {
    const runtimeSource = await readFile(
      new URL('../scripts/lib/windows-ajax-auto-allow-runtime.mjs', import.meta.url),
      'utf8'
    );

    assert.match(runtimeSource, /createAjaxAutoAllowCanaryRuntimeServer/);
    assert.match(runtimeSource, /emitAjaxAutoAllowCanaryRuntimeSummary/);
    assert.match(runtimeSource, /listenAjaxAutoAllowCanaryRuntimeServer/);
    assert.match(runtimeSource, /redditDiagnosticProbes/);
    assert.doesNotMatch(runtimeSource, /function buildPage\(/);
    assert.doesNotMatch(runtimeSource, /createServer\(\(req, res\) =>/);
  });

  test('collects runtime dependency fast-apply timing evidence from Windows logs', async () => {
    const runtimeSource = await readFile(
      new URL('../scripts/lib/windows-ajax-auto-allow-runtime.mjs', import.meta.url),
      'utf8'
    );

    assert.match(runtimeSource, /readScheduledTaskEvidence\('OpenPath-RuntimeDependencyApply'\)/);
    assert.match(runtimeSource, /extractRuntimeDependencyTimingEvidence/);
    assert.match(runtimeSource, /Runtime dependency fast apply metrics:/);
    assert.match(runtimeSource, /variant:\s*fastApplyMetrics \? 'fast-queue-apply-product'/);
    assert.match(runtimeSource, /nativeActionElapsedMs/);
    assert.match(runtimeSource, /queueWriteMs/);
    assert.match(runtimeSource, /updateTriggerMs/);
    assert.match(runtimeSource, /overlayWriteMs/);
    assert.match(runtimeSource, /acrylicReloadMs/);
  });

  test('does not abort artifact collection on initial Selenium navigation timeout', async () => {
    const runtimeSource = await readFile(
      new URL('../scripts/lib/windows-ajax-auto-allow-runtime.mjs', import.meta.url),
      'utf8'
    );

    assert.match(runtimeSource, /let initialNavigation = \{ success: true, error: null \};/);
    assert.match(runtimeSource, /try \{\s+await driver\.get\(originUrl\);\s+\} catch \(error\)/);
    assert.match(runtimeSource, /initialNavigation,/);
  });

  test('managed Selenium warmup does not report ready without installed extension evidence', async () => {
    const runtimeSource = await readFile(
      new URL('../scripts/lib/windows-ajax-auto-allow-runtime.mjs', import.meta.url),
      'utf8'
    );

    assert.doesNotMatch(
      runtimeSource,
      /firefoxExtensionWarmup:\s*\{[\s\S]*?ready:\s*true[\s\S]*?mode:\s*USE_LOCAL_FIREFOX_ADDON \? 'selenium-local-addon' : 'selenium-managed'/,
      'managed Selenium readiness must not be hardcoded to true'
    );
    assert.match(
      runtimeSource,
      /ready:\s*extensionEvidence\.registryAddonPresent \|\| extensionEvidence\.profileExtensionPresent/,
      'managed Selenium readiness must depend on Firefox profile extension evidence'
    );
  });
});
