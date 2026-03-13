import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateRequiredChecks } from '../scripts/openpath-required-checks.mjs';

describe('evaluateRequiredChecks', () => {
  it('accepts the latest success for every required check', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:00:00Z',
        },
        {
          name: 'E2E Summary',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:01:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });

  it('fails when a required check is missing', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:00:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, ['E2E Summary']);
    assert.deepEqual(result.failing, []);
  });

  it('fails when the latest run of a required check is not successful', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'failure',
          status: 'completed',
          completed_at: '2026-03-13T10:02:00Z',
        },
        {
          name: 'E2E Summary',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:01:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, false);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, [
      {
        conclusion: 'failure',
        name: 'CI Success',
        status: 'completed',
      },
    ]);
  });

  it('deduplicates retries by keeping the latest run per check name', () => {
    const result = evaluateRequiredChecks({
      checkRuns: [
        {
          name: 'CI Success',
          conclusion: 'failure',
          status: 'completed',
          completed_at: '2026-03-13T10:00:00Z',
        },
        {
          name: 'CI Success',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:05:00Z',
        },
        {
          name: 'E2E Summary',
          conclusion: 'success',
          status: 'completed',
          completed_at: '2026-03-13T10:01:00Z',
        },
      ],
      requiredChecks: ['CI Success', 'E2E Summary'],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.failing, []);
  });
});
