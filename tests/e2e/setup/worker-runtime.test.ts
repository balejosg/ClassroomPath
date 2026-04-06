import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createE2EWorkerRuntime,
  prefixWorkerScopedLabel,
  prefixWorkerScopedLocalPart,
} from '../../helpers/e2e-runtime.js';

describe('e2e worker runtime', () => {
  test('derives stable worker scope metadata from the Playwright worker index', () => {
    const runtime = createE2EWorkerRuntime({
      BASE_URL: 'http://localhost:5173',
      TEST_WORKER_INDEX: '2',
    } as NodeJS.ProcessEnv);

    assert.equal(runtime.workerIndex, 2);
    assert.equal(runtime.workerSlot, 3);
    assert.equal(runtime.scopeToken, 'w3');
  });

  test('prefixes generated labels and local-parts with the worker scope', () => {
    const runtime = createE2EWorkerRuntime({
      BASE_URL: 'http://localhost:5173',
      TEST_WORKER_INDEX: '4',
    } as NodeJS.ProcessEnv);

    assert.equal(prefixWorkerScopedLocalPart('mailbox', runtime), 'mailbox-w5');
    assert.equal(prefixWorkerScopedLabel('E2E Organization', runtime), 'E2E Organization W5');
  });
});
