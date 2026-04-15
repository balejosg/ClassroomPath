import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  listTemplateRulesPaginated,
  listTemplates,
} from '../src/services/template-read.service.js';

void describe('template-read.service', () => {
  void test('exports the template read use-cases', () => {
    assert.equal(typeof listTemplates, 'function');
    assert.equal(typeof listTemplateRulesPaginated, 'function');
  });
});
