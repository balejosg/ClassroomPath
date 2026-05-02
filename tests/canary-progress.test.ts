import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createCanaryProgressReporter,
  formatCanaryProgressLine,
} from '../scripts/lib/canary-progress.mjs';

describe('canary progress logs', () => {
  test('formats structured progress as one parseable log line', () => {
    const line = formatCanaryProgressLine({
      canary: 'linux-ajax',
      phase: 'firefox-extension-ready',
      status: 'passed',
      elapsedMs: 1234,
      boundaryId: 'none',
      message: 'Firefox extension ready',
    });

    assert.match(line, /^CANARY_PROGRESS /);
    const payload = JSON.parse(line.slice('CANARY_PROGRESS '.length));
    assert.deepEqual(payload, {
      canary: 'linux-ajax',
      phase: 'firefox-extension-ready',
      status: 'passed',
      elapsedMs: 1234,
      boundaryId: 'none',
      message: 'Firefox extension ready',
    });
  });

  test('reporter derives elapsed time and writes through the selected output sink', () => {
    const lines: string[] = [];
    let tick = 1000;
    const progress = createCanaryProgressReporter({
      canary: 'windows-ajax',
      output: (line) => lines.push(line),
      now: () => tick,
    });

    progress('bootstrap', 'started', { message: 'Starting Windows canary' });
    tick = 1350;
    progress('bootstrap', 'passed', { boundaryId: 'none' });

    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0].slice('CANARY_PROGRESS '.length)).elapsedMs, 0);
    assert.deepEqual(JSON.parse(lines[1].slice('CANARY_PROGRESS '.length)), {
      canary: 'windows-ajax',
      phase: 'bootstrap',
      status: 'passed',
      elapsedMs: 350,
      boundaryId: 'none',
    });
  });
});
