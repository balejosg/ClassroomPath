import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { runReportedStage } from '../scripts/lib/verify-runtime.ts';

describe('verify runtime', () => {
  test('skips a reported stage when the cache confirms a reusable diff-safe result', async () => {
    const events: Array<{ type: string; payload?: unknown }> = [];
    let actionCalls = 0;

    await runReportedStage(
      {
        completeStage: (...payload) => events.push({ payload, type: 'complete' }),
        failStage: (...payload) => events.push({ payload, type: 'fail' }),
        skipStage: (...payload) => events.push({ payload, type: 'skip' }),
        startStage: (...payload) => events.push({ payload, type: 'start' }),
      } as never,
      {
        cache: {
          clearStage: () => events.push({ type: 'clear' }),
          key: 'stage-cache-key',
          rememberPassedStage: () => events.push({ type: 'remember' }),
          shouldReuse: async () => true,
        },
        details: { command: 'npm run format:check' },
        id: 'format-and-secrets',
        label: 'Format and secret checks',
      },
      async () => {
        actionCalls += 1;
      }
    );

    assert.equal(actionCalls, 0);
    assert.deepEqual(
      events.map((event) => event.type),
      ['skip']
    );
  });
});
