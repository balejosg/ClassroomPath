import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { publishTemplateFromGroup } from '../src/services/group-template-publish.service.js';

void describe('group-template-publish.service', () => {
  void test('exports the template publish use-case', () => {
    assert.equal(typeof publishTemplateFromGroup, 'function');
  });
});
