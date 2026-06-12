/**
 * Creates or updates a GitHub issue to report a smoke-test failure, attaching run details and failure context.
 *
 * Invoked by: GitHub Actions `reusable-smoke-test.yml` workflow.
 * Usage: node scripts/report-smoke-failure.mjs
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_TITLE, ISSUE_LABELS.
 */
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const issueTitle = process.env.ISSUE_TITLE;
const issueLabels = String(process.env.ISSUE_LABELS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (!token || !repository || !issueTitle || issueLabels.length === 0) {
  throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_TITLE, and ISSUE_LABELS are required');
}

const [owner, repo] = repository.split('/');
const environmentName = process.env.SMOKE_ENVIRONMENT ?? 'unknown';
const runUrl = `${process.env.GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const failureBoundaryId = String(process.env.SMOKE_FAILURE_BOUNDARY_ID ?? 'unknown').trim();
const failureBoundaryMessage = String(process.env.SMOKE_FAILURE_BOUNDARY_MESSAGE ?? '').trim();

async function githubRequest(path, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'classroompath-smoke-automation',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed (${response.status}): ${await response.text()}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

const body = [
  '## Smoke Test Failure Alert',
  '',
  `**Environment:** ${environmentName}`,
  `**Time:** ${new Date().toISOString()}`,
  `**Run:** [View workflow run](${runUrl})`,
  `**Failure boundary:** \`${failureBoundaryId || 'unknown'}\``,
  `**Boundary message:** ${failureBoundaryMessage || 'No boundary message was reported.'}`,
  `**Public URL:** ${process.env.SMOKE_PUBLIC_URL ?? ''}`,
  `**Ready URL:** ${process.env.SMOKE_READY_URL ?? ''}`,
  '',
  '### Debug Commands',
  '',
  '```bash',
  `curl -i ${process.env.SMOKE_API_HEALTH_URL ?? ''}`,
  `curl -i ${process.env.SMOKE_API_CONFIG_URL ?? ''}`,
  '```',
].join('\n');

const issues = await githubRequest(
  `/repos/${owner}/${repo}/issues?state=open&labels=${encodeURIComponent(issueLabels.join(','))}`
);

if (Array.isArray(issues) && issues.length > 0) {
  await githubRequest(`/repos/${owner}/${repo}/issues/${issues[0].number}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      body: [
        `Another ${environmentName} smoke test failure detected at ${new Date().toISOString()}`,
        '',
        `Run: ${runUrl}`,
        `Failure boundary: \`${failureBoundaryId || 'unknown'}\``,
        `Boundary message: ${failureBoundaryMessage || 'No boundary message was reported.'}`,
      ].join('\n'),
    }),
  });
} else {
  await githubRequest(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: issueTitle, body, labels: issueLabels }),
  });
}
