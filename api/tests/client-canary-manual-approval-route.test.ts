import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  clientCanaryGroupDiagnosticsHandler,
  clientCanaryManualBillingApprovalHandler,
} from '../src/lib/client-canary-manual-approval-route.ts';
import { getAvailablePort } from './test-utils.js';

let server: Server | undefined;
const originalToken = process.env.CP_CLIENT_CANARY_ADMIN_TOKEN;
const currentFilePath = fileURLToPath(import.meta.url);
const apiRoot = resolve(dirname(currentFilePath), '..');

async function startServer() {
  const app = express();
  app.use(express.json());
  app.post(
    '/cp/internal/client-canary/manual-request/:requestId/approve',
    clientCanaryManualBillingApprovalHandler
  );
  app.get(
    '/cp/internal/client-canary/group/:groupId/diagnostics',
    clientCanaryGroupDiagnosticsHandler
  );

  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${String(port)}`;
  server = app.listen(port);
  await new Promise<void>((resolve) => server?.once('listening', () => resolve()));
  return baseUrl;
}

async function stopServer() {
  await new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  server = undefined;
}

describe('client canary manual approval route', () => {
  afterEach(async () => {
    if (originalToken === undefined) {
      delete process.env.CP_CLIENT_CANARY_ADMIN_TOKEN;
    } else {
      process.env.CP_CLIENT_CANARY_ADMIN_TOKEN = originalToken;
    }
    await stopServer();
  });

  test('fails closed when the runtime token is not configured', async () => {
    delete process.env.CP_CLIENT_CANARY_ADMIN_TOKEN;
    const baseUrl = await startServer();

    const response = await fetch(
      `${baseUrl}/cp/internal/client-canary/manual-request/bill_req_123/approve`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer presented-token' },
      }
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'forbidden' });
  });

  test('reads the canary token through the runtime environment policy', () => {
    const routeSource = readFileSync(
      resolve(apiRoot, 'src/lib/client-canary-manual-approval-route.ts'),
      'utf8'
    );

    assert.ok(routeSource.includes('config.clientCanaryAdminToken'));
    assert.ok(!routeSource.includes('process.env.CP_CLIENT_CANARY_ADMIN_TOKEN'));
  });

  test('rejects mismatched tokens before reading manual billing requests', async () => {
    process.env.CP_CLIENT_CANARY_ADMIN_TOKEN = 'expected-token';
    const baseUrl = await startServer();

    const response = await fetch(
      `${baseUrl}/cp/internal/client-canary/manual-request/bill_req_123/approve`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
      }
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'forbidden' });
  });

  test('rejects group diagnostics requests with mismatched tokens before reading canary state', async () => {
    process.env.CP_CLIENT_CANARY_ADMIN_TOKEN = 'expected-token';
    const baseUrl = await startServer();

    const response = await fetch(
      `${baseUrl}/cp/internal/client-canary/group/group_123/diagnostics?host=ajax-auto-allow-target.127.0.0.1.sslip.io`,
      {
        headers: { Authorization: 'Bearer wrong-token' },
      }
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'forbidden' });
  });
});
