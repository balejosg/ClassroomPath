import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, describe, test } from 'node:test';

import express from 'express';

import { registerGatewayHealthRoutes } from '../src/lib/gateway/health-routes.ts';
import { getAvailablePort, waitForHealth } from './test-utils.js';

let server: Server | undefined;
let baseUrl = '';

await describe('health-routes', { concurrency: false }, async () => {
  before(async () => {
    const app = express();
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${String(port)}`;

    registerGatewayHealthRoutes(app, {
      getGatewayReadiness: async () => ({
        ready: false,
        upstreamAvailable: false,
        databaseConnected: true,
        databaseSchemaReady: false,
        missingTables: ['cp_terms_acceptance'],
        offlineInstallerReady: false,
        offlineInstallerCode: 'TEMPLATE_MISSING',
      }),
    });

    server = app.listen(port);
    await waitForHealth(baseUrl);
  });

  after(async () => {
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
  });

  test('serves live health and degraded readiness payloads', async () => {
    const healthResponse = await fetch(`${baseUrl}/cp/health`);
    const readinessResponse = await fetch(`${baseUrl}/cp/ready`);

    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), {
      status: 'ok',
      service: 'classroompath-gateway',
    });

    assert.equal(readinessResponse.status, 503);
    assert.deepEqual(await readinessResponse.json(), {
      status: 'not_ready',
      ready: false,
      upstreamAvailable: false,
      databaseConnected: true,
      databaseSchemaReady: false,
      missingTables: ['cp_terms_acceptance'],
      offlineInstallerReady: false,
      offlineInstallerCode: 'TEMPLATE_MISSING',
    });
  });
});
