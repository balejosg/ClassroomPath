import { describe, it } from 'node:test';
import assert from 'node:assert';

import { sanitizeSlug } from '@openpath/shared/slug';

import { findAvailableName } from '../src/services/group-copy.service.js';

describe('group-copy.service', () => {
  describe('sanitizeSlug', () => {
    it('lowercases and replaces unsafe characters', () => {
      assert.strictEqual(sanitizeSlug('TeSt_ABC'), 'test_abc');
      assert.strictEqual(sanitizeSlug('My Group!'), 'my-group');
      assert.strictEqual(sanitizeSlug('A  B'), 'a-b');
    });
  });

  describe('findAvailableName', () => {
    it('returns baseName when candidate is available', async () => {
      const name = await findAvailableName({
        baseName: 'my-group',
        maxLength: 100,
        fallbackPrefix: 'group',
        exists: async () => false,
      });
      assert.strictEqual(name, 'my-group');
    });

    it('adds suffix when baseName is already taken', async () => {
      const seen: string[] = [];
      const name = await findAvailableName({
        baseName: 'my-group',
        maxLength: 100,
        fallbackPrefix: 'group',
        exists: async (candidate) => {
          seen.push(candidate);
          return candidate === 'my-group';
        },
      });

      assert.strictEqual(name, 'my-group-2');
      assert.deepStrictEqual(seen.slice(0, 2), ['my-group', 'my-group-2']);
    });

    it('preserves suffix when baseName is truncated by maxLength', async () => {
      const seen: string[] = [];
      const name = await findAvailableName({
        baseName: 'a'.repeat(40),
        maxLength: 10,
        fallbackPrefix: 'group',
        exists: async (candidate) => {
          seen.push(candidate);
          return candidate === 'aaaaaaaaaa';
        },
      });

      assert.strictEqual(name, 'aaaaaaaa-2');
      assert.deepStrictEqual(seen.slice(0, 2), ['aaaaaaaaaa', 'aaaaaaaa-2']);
    });

    it('falls back to prefix when baseName sanitizes to empty', async () => {
      const name = await findAvailableName({
        baseName: '!!!',
        maxLength: 50,
        fallbackPrefix: 'template',
        exists: async () => false,
      });

      assert.ok(name.startsWith('template-'));
      assert.ok(name.length <= 50);
    });
  });
});
