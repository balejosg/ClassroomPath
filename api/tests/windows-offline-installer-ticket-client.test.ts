import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import { callOpenPathEnrollmentTicket } from '../src/lib/windows-offline-installer-ticket-client.js';

const BASE_REQUEST = {
  openpathUrl: 'https://openpath.example.test/',
  classroomId: 'classroom-1',
  expiresIn: '24h',
  accessToken: 'teacher-token',
};

const VALID_BODY = {
  enrollmentToken: 'ticket-token',
  expiresAt: '2026-08-22T00:00:00.000Z',
  classroomId: 'classroom-1',
  classroomName: 'Lab North',
};

void describe('windows-offline-installer ticket client', () => {
  afterEach(() => {
    delete (globalThis as { fetch?: unknown }).fetch;
  });

  void test('posts bearer token and expiresIn to the ticket endpoint', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    (globalThis as { fetch?: unknown }).fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(VALID_BODY), { status: 200 });
    }) as typeof fetch;

    const ticket = await callOpenPathEnrollmentTicket(BASE_REQUEST);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://openpath.example.test/api/enroll/classroom-1/ticket');
    assert.equal(
      (calls[0].init.headers as Record<string, string>).authorization,
      'Bearer teacher-token'
    );
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { expiresIn: '24h' });
    assert.equal(ticket.enrollmentToken, 'ticket-token');
    assert.equal(ticket.classroomName, 'Lab North');
  });

  void test('throws a status-bearing error when OpenPath rejects the request', async () => {
    (globalThis as { fetch?: unknown }).fetch = (async () =>
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })) as typeof fetch;

    await assert.rejects(callOpenPathEnrollmentTicket(BASE_REQUEST), /403.*forbidden/);
  });

  void test('rejects malformed success payloads', async () => {
    (globalThis as { fetch?: unknown }).fetch = (async () =>
      new Response(JSON.stringify({ enrollmentToken: 42 }), { status: 200 })) as typeof fetch;

    await assert.rejects(
      callOpenPathEnrollmentTicket(BASE_REQUEST),
      /incomplete enrollment ticket/
    );
  });
});
