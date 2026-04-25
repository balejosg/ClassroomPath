export const OPENPATH_CI_JOB_NAMES = [
  'Detect Relevant Changes',
  'Linux Agent Tests (BATS)',
  'Windows Agent Tests (Pester)',
  'Delivery Contracts (Node)',
];

export const OPENPATH_BASE_REQUIRED_CHECKS = ['CI Success'];

export const OPENPATH_HIGH_RISK_REQUIRED_CHECKS = [
  {
    check: 'E2E Summary',
    patterns: [
      /^windows\//,
      /^linux\//,
      /^firefox-extension\//,
      /^tests\/e2e\//,
      /^tests\/selenium\//,
      /^api\/.*\/token-delivery[^/]*$/,
      /^api\/.*token-delivery[^/]*$/,
      /^\.github\/workflows\/(?:ci|e2e|installer).*\.ya?ml$/,
    ],
  },
  {
    check: 'Installer Contracts Success',
    patterns: [
      /^windows\//,
      /^linux\//,
      /^firefox-extension\//,
      /^api\/.*\/token-delivery[^/]*$/,
      /^api\/.*token-delivery[^/]*$/,
      /^\.github\/workflows\/(?:ci|e2e|installer).*\.ya?ml$/,
    ],
  },
  {
    check: 'Build and Release Scripts',
    patterns: [
      /^package(?:-lock)?\.json$/,
      /^VERSION$/,
      /^\.github\/workflows\/release.*\.ya?ml$/,
      /^scripts\/.*(?:build|release|installer).*$/,
    ],
  },
];

function uniqueValues(values) {
  return [...new Set(values)];
}

export function evaluateOpenPathChangedFilesRisk(changedFiles) {
  const matchedFiles = [];
  const matchedChecks = new Set();

  for (const changedFile of changedFiles) {
    const fileChecks = OPENPATH_HIGH_RISK_REQUIRED_CHECKS.filter((rule) =>
      rule.patterns.some((pattern) => pattern.test(changedFile))
    );

    if (fileChecks.length === 0) {
      continue;
    }

    matchedFiles.push(changedFile);
    for (const rule of fileChecks) {
      matchedChecks.add(rule.check);
    }
  }

  return {
    highRisk: matchedChecks.size > 0,
    matchedFiles,
    matchedChecks: [...matchedChecks],
  };
}

export function resolveOpenPathRequiredChecks({ explicitRequiredChecks, changedFiles = [] } = {}) {
  const risk = evaluateOpenPathChangedFilesRisk(changedFiles);

  if (explicitRequiredChecks && explicitRequiredChecks.length > 0) {
    return {
      requiredChecks: uniqueValues(explicitRequiredChecks),
      highRisk: risk.highRisk,
      matchedFiles: risk.matchedFiles,
    };
  }

  return {
    requiredChecks: uniqueValues([...OPENPATH_BASE_REQUIRED_CHECKS, ...risk.matchedChecks]),
    highRisk: risk.highRisk,
    matchedFiles: risk.matchedFiles,
  };
}

export function parseTimestamp(value) {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function selectLatestCheckRuns(checkRuns) {
  const latestByName = new Map();

  for (const checkRun of checkRuns) {
    const previous = latestByName.get(checkRun.name);

    if (!previous) {
      latestByName.set(checkRun.name, checkRun);
      continue;
    }

    const previousTime = parseTimestamp(previous.completed_at ?? previous.started_at);
    const nextTime = parseTimestamp(checkRun.completed_at ?? checkRun.started_at);

    if (nextTime >= previousTime) {
      latestByName.set(checkRun.name, checkRun);
    }
  }

  return latestByName;
}

export function parseRunIdFromUrl(value) {
  if (!value) {
    return null;
  }

  const match = value.match(/\/actions\/runs\/(\d+)(?:\/|$)/);
  return match ? match[1] : null;
}

export function selectLatestWorkflowJobsByName(workflowJobs) {
  const latestByName = new Map();

  for (const workflowJob of workflowJobs) {
    const previous = latestByName.get(workflowJob.name);

    if (!previous) {
      latestByName.set(workflowJob.name, workflowJob);
      continue;
    }

    const previousTime = parseTimestamp(previous.completed_at ?? previous.started_at);
    const nextTime = parseTimestamp(workflowJob.completed_at ?? workflowJob.started_at);

    if (nextTime >= previousTime) {
      latestByName.set(workflowJob.name, workflowJob);
    }
  }

  return latestByName;
}

export function workflowJobSucceeded(workflowJob) {
  if (!workflowJob) {
    return false;
  }

  const steps = workflowJob.steps ?? [];
  const completeJobStep = steps.find((step) => step.name === 'Complete job');
  const allStepsSucceeded =
    steps.length > 0 &&
    completeJobStep &&
    completeJobStep.status === 'completed' &&
    completeJobStep.conclusion === 'success' &&
    steps.every((step) => step.status === 'completed' && step.conclusion === 'success');

  if (allStepsSucceeded) {
    return true;
  }

  if (workflowJob.status === 'completed') {
    return workflowJob.conclusion === 'success' || workflowJob.conclusion === 'skipped';
  }

  if (workflowJob.status !== 'in_progress' || workflowJob.conclusion) {
    return false;
  }

  return false;
}

export function ciWorkflowSatisfiedByJobs(workflowJobs) {
  const latestByName = selectLatestWorkflowJobsByName(workflowJobs);

  return OPENPATH_CI_JOB_NAMES.every((jobName) => workflowJobSucceeded(latestByName.get(jobName)));
}

export function evaluateRequiredChecks({ checkRuns, requiredChecks, workflowJobs = [] }) {
  const latestByName = selectLatestCheckRuns(checkRuns);
  const missing = [];
  const failing = [];
  const recoveredChecks = new Set();

  if (requiredChecks.includes('CI Success') && ciWorkflowSatisfiedByJobs(workflowJobs)) {
    recoveredChecks.add('CI Success');
  }

  for (const checkName of requiredChecks) {
    if (recoveredChecks.has(checkName)) {
      continue;
    }

    const checkRun = latestByName.get(checkName);

    if (!checkRun) {
      missing.push(checkName);
      continue;
    }

    if (checkRun.status !== 'completed' || checkRun.conclusion !== 'success') {
      failing.push({
        name: checkRun.name,
        status: checkRun.status ?? 'unknown',
        conclusion: checkRun.conclusion ?? 'unknown',
      });
    }
  }

  return {
    ok: missing.length === 0 && failing.length === 0,
    missing,
    failing,
  };
}

export function classifyRequiredCheckWaitState({ checkRuns, requiredChecks, workflowJobs = [] }) {
  const evaluation = evaluateRequiredChecks({ checkRuns, requiredChecks, workflowJobs });

  if (evaluation.ok) {
    return {
      kind: 'passed',
      pending: [],
      terminalFailures: [],
      evaluation,
    };
  }

  const latestByName = selectLatestCheckRuns(checkRuns);
  const terminalFailures = [];
  const pending = [];

  for (const checkName of requiredChecks) {
    const checkRun = latestByName.get(checkName);

    if (!checkRun) {
      pending.push(checkName);
      continue;
    }

    if (checkRun.status === 'completed' && checkRun.conclusion !== 'success') {
      terminalFailures.push({
        name: checkName,
        status: checkRun.status ?? 'unknown',
        conclusion: checkRun.conclusion ?? 'unknown',
      });
      continue;
    }

    if (checkRun.status !== 'completed') {
      pending.push(checkName);
    }
  }

  return {
    kind: terminalFailures.length > 0 ? 'terminal_failure' : 'pending',
    pending,
    terminalFailures,
    evaluation,
  };
}
