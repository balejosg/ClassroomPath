import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { runCreateOrganizationGroupFromRulesWorkflow } from '../src/services/group-create-from-rules-workflow.service.js';

describe('group-create-from-rules-workflow.service', () => {
  test('exports the rule-seeded group creation workflow helper', () => {
    assert.equal(typeof runCreateOrganizationGroupFromRulesWorkflow, 'function');
  });
});
