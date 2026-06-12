#!/usr/bin/env node

/**
 * Entry point for the Windows AJAX auto-allow canary: delegates to the runtime harness in scripts/lib/.
 *
 * Invoked by: GitHub Actions `windows-production-bootstrap-canary.yml` and canary-related workflows.
 * Usage: node scripts/windows-ajax-auto-allow-canary.mjs
 * Env: WINDOWS_AUTO_ALLOW_CANARY_GROUP_ID, WINDOWS_AJAX_AUTO_ALLOW_CANARY_ADMIN_TOKEN.
 */

import { runWindowsAjaxAutoAllowCanaryRuntime } from './lib/windows-ajax-auto-allow-runtime.mjs';

await runWindowsAjaxAutoAllowCanaryRuntime();
