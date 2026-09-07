import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');

describe('shared deployment runtime executor', () => {
  it('owns mutation boundary, semantic readiness, commit, recovery result, and ledger hooks', () => {
    const helper = readFileSync(
      resolve(projectRoot, 'scripts/lib/deploy-runtime-executor.sh'),
      'utf8'
    );

    assert.match(helper, /deploy_runtime_execute\(\)/u);
    assert.match(helper, /DEPLOYMENT_PHASE_SWITCHING/u);
    assert.match(helper, /rollback_readiness_json_is_ready/u);
    assert.match(helper, /deployment_state_activate_v2_release/u);
    assert.match(helper, /deployment_ledger_append_terminal_from_env/u);
  });

  it('is invoked by both staging and production adapters', () => {
    const staging = readFileSync(resolve(projectRoot, 'scripts/deploy-staging-remote.sh'), 'utf8');
    const production = readFileSync(
      resolve(projectRoot, 'scripts/deploy-production-remote.sh'),
      'utf8'
    );

    assert.match(staging, /deploy_runtime_execute/u);
    assert.match(production, /deploy_runtime_execute/u);
  });
});
