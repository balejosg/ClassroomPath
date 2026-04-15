import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { importTemplateIntoOrganization } from '../src/services/group-template-import.service.js';

void describe('group-template-import.service', () => {
  void test('exports the template import use-case', () => {
    assert.equal(typeof importTemplateIntoOrganization, 'function');
  });
});
