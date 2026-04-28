import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  evidenceContainsAllExpectedHosts,
  waitForEvidenceObservation,
} from '../scripts/lib/auto-allow-observation.mjs';

describe('auto-allow observation helpers', () => {
  test('recognizes evidence that contains every expected host', () => {
    assert.equal(
      evidenceContainsAllExpectedHosts(
        {
          containsExpectedHosts: {
            'ajax-auto-allow-target.127.0.0.1.sslip.io': true,
            'ajax-auto-allow-font.127.0.0.1.sslip.io': true,
          },
        },
        ['ajax-auto-allow-target.127.0.0.1.sslip.io', 'ajax-auto-allow-font.127.0.0.1.sslip.io']
      ),
      true
    );
  });

  test('waits until one collector observes every expected host', async () => {
    let polls = 0;
    const result = await waitForEvidenceObservation({
      expectedHosts: ['ajax-auto-allow-font.127.0.0.1.sslip.io'],
      timeoutMs: 1000,
      intervalMs: 1,
      collectors: {
        global: async () => ({
          containsExpectedHosts: {
            'ajax-auto-allow-font.127.0.0.1.sslip.io': false,
          },
        }),
        native: async () => {
          polls += 1;
          return {
            containsExpectedHosts: {
              'ajax-auto-allow-font.127.0.0.1.sslip.io': polls >= 2,
            },
          };
        },
      },
    });

    assert.equal(result.observed, true);
    assert.equal(
      result.evidence.native.containsExpectedHosts['ajax-auto-allow-font.127.0.0.1.sslip.io'],
      true
    );
  });
});
