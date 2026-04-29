import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildAutoAllowArtifactFailureSummary,
  buildAutoAllowDiagnosticPhases,
  buildAutoAllowEvidenceModel,
  classifyAutoAllowFailureBoundary,
  enrichProbeEvidenceWithRemoteDiagnostics,
  hasCandidateEvidence,
  hasRemoteRuleEvidence,
} from '../scripts/lib/auto-allow-boundary-evidence.mjs';
import {
  LINUX_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS,
  withLinuxAutoAllowDiagnostics,
} from '../scripts/lib/linux-auto-allow-canary-evidence.mjs';
import {
  WINDOWS_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS,
  withWindowsAutoAllowDiagnostics,
} from '../scripts/lib/windows-auto-allow-canary-evidence.mjs';

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
  test('declarative engine marks phases after the first failure as pending', () => {
    const summary = buildAutoAllowEvidenceModel({
      summary: { ready: true },
      probes,
      boundaries,
      phases: [
        {
          id: 'remote-rule-creation',
          evidence: () => ({ ready: true }),
          passed: () => false,
        },
        {
          id: 'artifact-written',
          evidence: () => ({ artifactWritten: true }),
          passed: () => true,
        },
      ],
    });

    assert.deepEqual(
      summary.diagnosticPhases.map((phase) => [phase.id, phase.status]),
      [
        ['remote-rule-creation', 'failed'],
        ['artifact-written', 'pending'],
      ]
    );
    assert.equal(summary.failureBoundary.id, 'remote-rule-creation');
  });

  test('declarative engine returns none when all phases pass', () => {
    const summary = buildAutoAllowEvidenceModel({
      summary: { ready: true },
      probes,
      boundaries,
      phases: [
        {
          id: 'remote-rule-creation',
          evidence: () => ({ ready: true }),
          passed: () => true,
        },
        {
          id: 'artifact-written',
          evidence: () => ({ artifactWritten: true }),
          passed: () => true,
        },
      ],
    });

    assert.equal(summary.failureBoundary.id, 'none');
    assert.equal(summary.failureBoundary.message, 'success');
  });

  test('Linux declarative spec preserves phase order and browser observer boundary decisions', () => {
    const summary = withLinuxAutoAllowDiagnostics({
      firefoxExtensionWarmup: { ready: true },
      originHits: 1,
      originPageHits: 1,
      pageObserverInstalled: false,
      browserNavigation: { afterAttempts: { openpathObserverInstalled: true } },
      completedCandidateEvents: {},
      probeEvidence: [],
    });

    assert.deepEqual(
      summary.diagnosticPhases.map((phase) => phase.id),
      LINUX_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS
    );
    assert.equal(
      summary.diagnosticPhases.find((phase) => phase.id === 'page-observer')?.status,
      'passed'
    );
    assert.equal(summary.failureBoundary.id, 'page-resource-candidates');
  });

  test('Windows declarative spec preserves phase order and failure decisions', () => {
    const summary = withWindowsAutoAllowDiagnostics({
      firefoxExtensionWarmup: { ready: true },
      originHits: 1,
      pageObserverInstalled: true,
      completedCandidateEvents: {},
      probeEvidence: [],
    });

    assert.deepEqual(
      summary.diagnosticPhases.map((phase) => phase.id),
      WINDOWS_AUTO_ALLOW_DIAGNOSTIC_PHASE_IDS
    );
    assert.equal(summary.failureBoundary.id, 'page-resource-candidates');
  });

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

  test('detects remote rule evidence from canary group rule lists', () => {
    assert.equal(
      hasRemoteRuleEvidence(
        {
          diagnostics: {
            postAttempt: {
              server: {
                canaryGroup: {
                  body: {
                    rules: [
                      {
                        type: 'whitelist',
                        value: 'ajax-auto-allow-target.127.0.0.1.sslip.io',
                      },
                      {
                        type: 'whitelist',
                        value: 'ajax-auto-allow-font.127.0.0.1.sslip.io',
                      },
                    ],
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

  test('enriches probe evidence with remote rule diagnostic context', () => {
    const summary = {
      diagnostics: {
        postSuccessObservation: {
          remoteRules: {
            diagnostics: {
              body: {
                rules: [
                  {
                    value: 'ajax-auto-allow-font.127.0.0.1.sslip.io',
                    comment:
                      'Auto-approved via Firefox extension - diagnostic (correlation_id=corr-1; probe_id=font-subresource; request_type=font)',
                  },
                ],
              },
            },
          },
        },
      },
    };

    const enriched = enrichProbeEvidenceWithRemoteDiagnostics(
      [
        {
          id: 'font-subresource',
          expectedWhitelistHost: 'ajax-auto-allow-font.127.0.0.1.sslip.io',
        },
      ],
      summary,
      probes
    );

    assert.equal(
      enriched[0]?.diagnosticContext,
      'correlation_id=corr-1; probe_id=font-subresource; request_type=font'
    );
  });

  test('does not require DOM candidate events for webRequest-only probes', () => {
    assert.equal(
      hasCandidateEvidence(
        {
          completedCandidateEvents: {
            'ajax-fetch': true,
            'stylesheet-font-subresource': false,
          },
        },
        [
          { id: 'ajax-fetch', expectedWhitelistHost: 'ajax-auto-allow-target.127.0.0.1.sslip.io' },
          {
            id: 'stylesheet-font-subresource',
            expectedWhitelistHost: 'ajax-auto-allow-stylesheet-font.127.0.0.1.sslip.io',
            expectsPageResourceCandidate: false,
          },
        ]
      ),
      true
    );
  });
});
