import { describe, test } from 'node:test';
import assert from 'node:assert';

import { logger } from '../src/lib/logger.js';

await describe('logger', async () => {
  await test('exposes standard log methods', () => {
    assert.strictEqual(typeof logger.info, 'function');
    assert.strictEqual(typeof logger.warn, 'function');
    assert.strictEqual(typeof logger.error, 'function');
    assert.strictEqual(typeof logger.debug, 'function');

    // Smoke: should not throw.
    logger.debug('test debug');
    logger.info('test info');
    logger.warn('test warn');
    logger.error('test error');
  });

  await test('child logger merges metadata', () => {
    assert.strictEqual(typeof logger.child, 'function');

    const child = logger.child({ requestId: 'req-123' });
    assert.strictEqual(typeof child.info, 'function');
    child.info('child info', { extra: true });
  });
});
