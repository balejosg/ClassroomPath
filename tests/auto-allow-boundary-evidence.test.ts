import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildAutoAllowArtifactFailureSummary,
  buildAutoAllowDiagnosticPhases,
  classifyAutoAllowFailureBoundary,
  hasRemoteRuleEvidence,
} from '../scripts/lib/auto-allow-boundary-evidence.mjs';

const probes = Object.freeze([
  { id: 'ajax-fetch', expectedWhitelistHost: 'ajax-auto-allow-target.127.0.0.1.sslip.io' },
  { id: 'font-subresource', expectedWhitelistHost: 'ajax-auto-allow-font.127.0.0.1.sslip.io' },
]);

const boundaries = Object.freeze({
  'remote-rule-creation': {
    message: 'remote missing',
    recommendedNextAction: 'check server',
  },
  'artifact-written': {
    message: 'artifact missing',
    recommendedNextAction: 'check filesystem',
  },
  none: {
    message: 'success',
    recommendedNextAction: 'none',
  },
});

describe('shared auto-allow boundary evidence model', () => {
  test('detects remote rule evidence from expected host state snapshots', () => {
    assert.equal(
      hasRemoteRuleEvidence(
        {
          diagnostics: {
            postSuccessObservation: {
              remoteRules: {
                diagnostics: {
                  server: {
                    canaryGroup: {
                      body: {
                        expectedHostState: {
                          'ajax-auto-allow-target.127.0.0.1.sslip.io': {
                            whitelistRulePresent: true,
                          },
                          'ajax-auto-allow-font.127.0.0.1.sslip.io': {
                            whitelistRulePresent: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        probes.map((probe) => probe.expectedWhitelistHost)
      ),
      true
    );
  });

  test('builds phases and classifies the first failed boundary', () => {
    const phases = buildAutoAllowDiagnosticPhases({
      summary: { artifactWritten: true },
      probes,
      boundaries,
      checks: [
        {
          id: 'remote-rule-creation',
          passed: false,
          evidence: { expectedHosts: probes.map((probe) => probe.expectedWhitelistHost) },
        },
        {
          id: 'artifact-written',
          passed: true,
          evidence: { artifactWritten: true },
        },
      ],
    });

    assert.equal(phases[0].status, 'failed');
    assert.equal(phases[1].status, 'pending');
    assert.deepEqual(classifyAutoAllowFailureBoundary({ diagnosticPhases: phases, boundaries }), {
      id: 'remote-rule-creation',
      message: 'remote missing',
      recommendedNextAction: 'check server',
    });
  });

  test('builds artifact failure summaries from platform boundaries', () => {
    const summary = buildAutoAllowArtifactFailureSummary({
      id: 'artifact-written',
      message: 'custom artifact failure',
      artifactPath: '/tmp/canary.json',
      error: 'ENOENT',
      phaseIds: ['remote-rule-creation', 'artifact-written'],
      boundaries,
    });

    assert.equal(summary.success, false);
    assert.equal(summary.failureBoundary.message, 'custom artifact failure');
    assert.equal(summary.diagnosticPhases[1].status, 'failed');
  });
});
