import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FLEET_HEALTH_MAX_HOSTNAMES,
  createClientCanaryFleetHealthHandler,
  type FleetHealthLookup,
} from '../src/lib/client-canary-fleet-health-route.ts';
import { getAvailablePort } from './test-utils.js';

const currentFilePath = fileURLToPath(import.meta.url);
const apiRoot = resolve(dirname(currentFilePath), '..');
const TOKEN = 'fleet-health-test-token';

let server: Server | undefined;
let lookupCalls: string[][] = [];

async function startServer(options: { token?: string | null; lookup?: FleetHealthLookup } = {}) {
  const app = express();
  const lookup: FleetHealthLookup =
    options.lookup ??
    (async (hostnames) => {
      lookupCalls.push(hostnames);
      return {
        'pc-ok.example.invalid': {
          status: 'HEALTHY',
          reasonCodes: [],
          version: '4.2.0',
          reportedAt: '2026-11-18T13:00:00.000Z',
        },
        'pc-contradiction.example.invalid': {
          status: 'FAIL_OPEN',
          reasonCodes: ['open_classroom_firewall_active', 'open_classroom_dns_pinned'],
          version: '4.2.0',
          reportedAt: '2026-11-18T13:05:00.000Z',
        },
      };
    });

  app.get(
    '/cp/internal/client-canary/fleet-health',
    createClientCanaryFleetHealthHandler({
      lookup,
      readToken: () => (options.token === undefined ? TOKEN : options.token),
    })
  );

  const port = await getAvailablePort();
  server = app.listen(port);
  await new Promise<void>((resolveListening) =>
    server?.once('listening', () => resolveListening())
  );
  return `http://127.0.0.1:${String(port)}`;
}

async function stopServer() {
  if (!server) return;
  const current = server;
  server = undefined;
  await new Promise<void>((resolveClose, reject) => {
    current.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function fleetUrl(baseUrl: string, ...hostnames: string[]): string {
  const params = new URLSearchParams();
  for (const hostname of hostnames) params.append('hostname', hostname);
  return `${baseUrl}/cp/internal/client-canary/fleet-health?${params.toString()}`;
}

describe('client canary fleet health route', () => {
  afterEach(async () => {
    lookupCalls = [];
    await stopServer();
  });

  test('fails closed when no read token is configured', async () => {
    const baseUrl = await startServer({ token: null });

    const response = await fetch(fleetUrl(baseUrl, 'pc-ok.example.invalid'), {
      headers: { 'x-classroompath-fleet-health-token': TOKEN },
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'forbidden' });
    assert.deepEqual(lookupCalls, []);
  });

  test('rejects a missing token before reading reports', async () => {
    const baseUrl = await startServer();

    const response = await fetch(fleetUrl(baseUrl, 'pc-ok.example.invalid'));

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'forbidden' });
    assert.deepEqual(lookupCalls, []);
  });

  test('rejects a wrong token before reading reports', async () => {
    const baseUrl = await startServer();

    const response = await fetch(fleetUrl(baseUrl, 'pc-ok.example.invalid'), {
      headers: { Authorization: 'Bearer wrong-token' },
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'forbidden' });
    assert.deepEqual(lookupCalls, []);
  });

  test('accepts the token through the dedicated header or bearer authorization', async () => {
    const baseUrl = await startServer();
    const headers = { 'x-classroompath-fleet-health-token': TOKEN };

    const dedicated = await fetch(fleetUrl(baseUrl, 'pc-ok.example.invalid'), { headers });
    const bearer = await fetch(fleetUrl(baseUrl, 'pc-ok.example.invalid'), {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    assert.equal(dedicated.status, 200);
    assert.equal(bearer.status, 200);
  });

  test('rejects more than the bounded number of hostnames', async () => {
    const baseUrl = await startServer();
    const hostnames = Array.from(
      { length: FLEET_HEALTH_MAX_HOSTNAMES + 1 },
      (_, index) => `pc-${String(index)}.example.invalid`
    );

    const response = await fetch(fleetUrl(baseUrl, ...hostnames), {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'too_many_hostnames' });
    assert.deepEqual(lookupCalls, []);
  });

  test('normalizes and deduplicates hostnames before the lookup', async () => {
    const baseUrl = await startServer();

    const response = await fetch(
      fleetUrl(baseUrl, ' PC-OK.EXAMPLE.INVALID ', 'pc-ok.example.invalid'),
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );

    assert.equal(response.status, 200);
    assert.deepEqual(lookupCalls, [['pc-ok.example.invalid']]);
  });

  test('returns no report for an unknown hostname', async () => {
    const baseUrl = await startServer({
      lookup: async () => ({}),
    });

    const response = await fetch(fleetUrl(baseUrl, 'unknown.example.invalid'), {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { reports: {} });
  });

  test('returns only the agreed report fields for known hostnames', async () => {
    const baseUrl = await startServer();

    const response = await fetch(
      fleetUrl(baseUrl, 'pc-ok.example.invalid', 'pc-contradiction.example.invalid'),
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    const body = (await response.json()) as {
      reports: Record<string, Record<string, unknown>>;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body.reports).sort(), [
      'pc-contradiction.example.invalid',
      'pc-ok.example.invalid',
    ]);
    for (const report of Object.values(body.reports)) {
      assert.deepEqual(Object.keys(report).sort(), [
        'reasonCodes',
        'reportedAt',
        'status',
        'version',
      ]);
    }
    assert.deepEqual(body.reports['pc-contradiction.example.invalid'], {
      status: 'FAIL_OPEN',
      reasonCodes: ['open_classroom_firewall_active', 'open_classroom_dns_pinned'],
      version: '4.2.0',
      reportedAt: '2026-11-18T13:05:00.000Z',
    });
  });

  test('reads the fleet read token through the runtime config singleton', () => {
    const routeSource = readFileSync(
      resolve(apiRoot, 'src/lib/client-canary-fleet-health-route.ts'),
      'utf8'
    );

    assert.ok(routeSource.includes('config.fleetHealthReadToken'));
    assert.ok(!routeSource.includes('process.env.CP_FLEET_HEALTH_READ_TOKEN'));
  });
});
