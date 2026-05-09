import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseTrpcEnvelope } from './helpers/trpc-envelope.js';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(currentFilePath), '..');

describe('smoke tRPC envelope parser', () => {
  test('parses a direct success envelope', () => {
    assert.deepEqual(parseTrpcEnvelope({ result: { data: { enabled: true } } }), {
      data: { enabled: true },
    });
  });

  test('parses a batched success envelope', () => {
    assert.deepEqual(parseTrpcEnvelope([{ result: { data: { enabled: true } } }]), {
      data: { enabled: true },
    });
  });

  test('unwraps tRPC JSON data payloads', () => {
    assert.deepEqual(parseTrpcEnvelope([{ result: { data: { json: { enabled: true } } } }]), {
      data: { enabled: true },
    });
  });

  test('parses a direct error envelope', () => {
    assert.deepEqual(
      parseTrpcEnvelope({
        error: {
          message: 'Forbidden',
          code: 'FORBIDDEN',
          data: { code: 'FORBIDDEN_DATA' },
        },
      }),
      {
        error: {
          message: 'Forbidden',
          code: 'FORBIDDEN_DATA',
        },
      }
    );
  });

  test('parses a batched error envelope', () => {
    assert.deepEqual(
      parseTrpcEnvelope([
        {
          error: {
            message: 'Unauthorized',
            code: 'UNAUTHORIZED',
          },
        },
      ]),
      {
        error: {
          message: 'Unauthorized',
          code: 'UNAUTHORIZED',
        },
      }
    );
  });

  test('returns an empty object for invalid payloads', () => {
    for (const payload of [null, undefined, 'not-json', 123, true, []]) {
      assert.deepEqual(parseTrpcEnvelope(payload), {});
    }
  });

  test('smoke test consumes the shared parser instead of parsing tRPC inline', () => {
    const smokeTest = readFileSync(resolve(projectRoot, 'tests/smoke.test.ts'), 'utf8');

    assert.match(smokeTest, /from '\.\/helpers\/trpc-envelope\.js'/);
    assert.doesNotMatch(smokeTest, /function\s+parseTrpcEnvelope/);
    assert.doesNotMatch(smokeTest, /interface\s+TrpcEnvelope/);
  });
});
