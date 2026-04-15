import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  importTemplateToOrganization,
  publishTemplateFromOrganizationGroup,
} from '../src/services/template-write.service.js';

void describe('template-write.service', () => {
  void test('exports the template write use-cases', () => {
    assert.equal(typeof publishTemplateFromOrganizationGroup, 'function');
    assert.equal(typeof importTemplateToOrganization, 'function');
  });
});
