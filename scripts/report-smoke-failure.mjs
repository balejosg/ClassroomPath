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
      body: `Another ${environmentName} smoke test failure detected at ${new Date().toISOString()}\n\nRun: ${runUrl}`,
    }),
  });
} else {
  await githubRequest(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: issueTitle, body, labels: issueLabels }),
  });
}
