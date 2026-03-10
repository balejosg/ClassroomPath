import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const integrationDir = new URL('../tests/integration/', import.meta.url);
const integrationFiles = readdirSync(integrationDir)
  .filter((entry) => entry.endsWith('.test.ts'))
  .sort();

for (const file of integrationFiles) {
  const relativePath = join('tests', 'integration', file);
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', '--test-concurrency=1', relativePath],
    {
      cwd: new URL('..', import.meta.url),
      stdio: 'inherit',
      env: process.env,
    }
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
