import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildVerificationReportSummary,
  VERIFICATION_REPORT_VERSION,
} from './verification-report-contract.mjs';
import type { VerifyPlan } from './verify-plan.ts';

export type VerifyStageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export type VerifyReportStage = {
  details?: Record<string, unknown>;
  error?: string;
  finishedAt?: string;
  id: string;
  label: string;
  startedAt?: string;
  status: VerifyStageStatus;
};

export type VerificationReport = {
  composeProjectName: string;
  coverage: {
    needsApiCoverage: boolean;
    needsCoverageGate: boolean;
    needsSpaCoverage: boolean;
  };
  domains: VerifyPlan['domainSummary'];
  finishedAt?: string;
  mode: VerifyPlan['mode'];
  notes: string[];
  ok: boolean | null;
  reportFile: string;
  rootDir: string;
  scope: VerifyPlan['verificationScope'];
  summary: ReturnType<typeof buildVerificationReportSummary>;
  stages: VerifyReportStage[];
  startedAt: string;
  testDbPort: number;
  version: typeof VERIFICATION_REPORT_VERSION;
  workspaceFingerprint: string;
};

export type VerifyReporter = ReturnType<typeof createVerifyReporter>;

function cloneReport(report: VerificationReport): VerificationReport {
  return JSON.parse(JSON.stringify(report)) as VerificationReport;
}

export function createVerifyReporter(
  plan: VerifyPlan,
  {
    now = () => new Date().toISOString(),
    reportFile = process.env.VERIFY_REPORT_FILE ||
      resolve(tmpdir(), `classroompath-verify-report-${process.pid}.json`),
  }: {
    now?: () => string;
    reportFile?: string;
  } = {}
) {
  const normalizedReportFile = resolve(reportFile);
  const state: VerificationReport = {
    composeProjectName: plan.composeProjectName,
    coverage: {
      needsApiCoverage: plan.needsApiCoverage,
      needsCoverageGate: plan.needsCoverageGate,
      needsSpaCoverage: plan.needsSpaCoverage,
    },
    domains: plan.domainSummary,
    mode: plan.mode,
    notes: [],
    ok: null,
    reportFile: normalizedReportFile,
    rootDir: plan.rootDir,
    scope: plan.verificationScope,
    summary: {
      failedStages: 0,
      ok: false,
      owners: [...plan.domainSummary.owners],
      passedStages: 0,
      pendingStages: 0,
      requiredApprovals: [...plan.domainSummary.requiredApprovals],
      runningStages: 0,
      scope: plan.verificationScope,
      skippedStages: 0,
      totalStages: 0,
    },
    stages: [],
    startedAt: now(),
    testDbPort: plan.testDbPort,
    version: VERIFICATION_REPORT_VERSION,
    workspaceFingerprint: plan.workspaceFingerprint,
  };

  function flush() {
    state.summary = buildVerificationReportSummary(state);
    mkdirSync(dirname(normalizedReportFile), { recursive: true });
    writeFileSync(normalizedReportFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  function getOrCreateStage(id: string, label: string): VerifyReportStage {
    let stage = state.stages.find((entry) => entry.id === id);
    if (!stage) {
      stage = { id, label, status: 'pending' };
      state.stages.push(stage);
    } else {
      stage.label = label;
    }

    return stage;
  }

  flush();

  return {
    addNote(note: string) {
      state.notes.push(note);
      flush();
    },
    completeStage(id: string, label: string, details?: Record<string, unknown>) {
      const stage = getOrCreateStage(id, label);
      stage.status = 'passed';
      stage.finishedAt = now();
      if (!stage.startedAt) {
        stage.startedAt = stage.finishedAt;
      }
      if (details) {
        stage.details = details;
      }
      delete stage.error;
      flush();
    },
    failStage(id: string, label: string, error: unknown) {
      const stage = getOrCreateStage(id, label);
      stage.status = 'failed';
      stage.finishedAt = now();
      if (!stage.startedAt) {
        stage.startedAt = stage.finishedAt;
      }
      stage.error = error instanceof Error ? error.message : String(error);
      flush();
    },
    finalize(ok: boolean) {
      state.ok = ok;
      state.finishedAt = now();
      flush();
    },
    getReport() {
      return cloneReport(state);
    },
    getReportFile() {
      return normalizedReportFile;
    },
    skipStage(id: string, label: string, details?: Record<string, unknown>) {
      const stage = getOrCreateStage(id, label);
      stage.status = 'skipped';
      stage.finishedAt = now();
      if (!stage.startedAt) {
        stage.startedAt = stage.finishedAt;
      }
      if (details) {
        stage.details = details;
      }
      delete stage.error;
      flush();
    },
    startStage(id: string, label: string, details?: Record<string, unknown>) {
      const stage = getOrCreateStage(id, label);
      stage.status = 'running';
      stage.startedAt = now();
      stage.finishedAt = undefined;
      if (details) {
        stage.details = details;
      }
      delete stage.error;
      flush();
    },
  };
}
