import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..');

describe('canonical production recovery preflight', () => {
  it('defines one reusable operation with exact recovery and candidate identity inputs', () => {
    const helper = readFileSync(
      resolve(projectRoot, 'scripts/lib/production-recovery-preflight.sh'),
      'utf8'
    );

    assert.match(helper, /production_recovery_prepare_and_verify\(\)/u);
    assert.match(helper, /PRODUCTION_RECOVERY_SHA/u);
    assert.match(helper, /CANDIDATE_SHA/u);
    assert.match(helper, /authority_script[\s\S]*validate/u);
    assert.match(helper, /authority_script[\s\S]*package/u);
    assert.match(helper, /authority_script[\s\S]*preflight/u);
  });
});
