import { describe, test } from 'node:test';
import assert from 'node:assert';

import { logger } from '../src/lib/logger.js';

function captureStdout<T>(run: () => T): { result: T; output: string } {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = '';

  process.stdout.write = ((chunk, encoding, callback) => {
    const text =
      typeof chunk === 'string'
        ? chunk
        : chunk.toString(typeof encoding === 'string' ? encoding : 'utf8');
    output += text;

    if (typeof encoding === 'function') {
      encoding();
    } else if (typeof callback === 'function') {
      callback();
    }

    return true;
  }) as typeof process.stdout.write;

  try {
    const result = run();
    return { result, output };
  } finally {
    process.stdout.write = originalWrite;
  }
}

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

  await test('requestMiddleware prefers x-forwarded-for over req.ip when logging', () => {
    const finishListeners: Array<() => void> = [];
    let nextCalls = 0;

    const { output } = captureStdout(() => {
      logger.requestMiddleware(
        {
          requestId: 'req-logger-123',
          method: 'GET',
          originalUrl: '/cp/health',
          url: '/cp/health',
          ip: '10.0.0.8',
          headers: {
            'x-forwarded-for': '198.51.100.21, 10.0.0.8',
          },
          get: () => 'node-test',
        } as never,
        {
          statusCode: 200,
          on: (event: string, listener: () => void) => {
            if (event === 'finish') {
              finishListeners.push(listener);
            }
          },
        } as never,
        () => {
          nextCalls += 1;
        }
      );

      for (const listener of finishListeners) {
        listener();
      }
    });

    assert.strictEqual(nextCalls, 1);
    assert.match(output, /198\.51\.100\.21/);
    assert.doesNotMatch(output, /"ip":"10\.0\.0\.8"/);
  });
});
