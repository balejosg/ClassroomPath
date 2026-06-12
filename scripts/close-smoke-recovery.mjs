/**
 * Closes open smoke-recovery GitHub issues once the deployment smoke test passes again.
 *
 * Invoked by: GitHub Actions `reusable-smoke-test.yml` and `production-client-update-canary.yml` workflows.
 * Usage: node scripts/close-smoke-recovery.mjs
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, ISSUE_LABELS.
 */
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const issueLabels = String(process.env.ISSUE_LABELS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (!token || !repository || issueLabels.length === 0) {
  throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY, and ISSUE_LABELS are required');
}

const [owner, repo] = repository.split('/');
const environmentName = process.env.SMOKE_ENVIRONMENT ?? 'unknown';
const runUrl = `${process.env.GITHUB_SERVER_URL}/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;

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

const issues = await githubRequest(
  `/repos/${owner}/${repo}/issues?state=open&labels=${encodeURIComponent(issueLabels.join(','))}`
);

for (const issue of Array.isArray(issues) ? issues : []) {
  await githubRequest(`/repos/${owner}/${repo}/issues/${issue.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      body: `${environmentName} smoke tests recovered at ${new Date().toISOString()}\n\nRun: ${runUrl}`,
    }),
  });

  await githubRequest(`/repos/${owner}/${repo}/issues/${issue.number}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed' }),
  });
}
