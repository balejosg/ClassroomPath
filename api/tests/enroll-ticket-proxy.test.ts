import { describe, it } from 'node:test';
import assert from 'node:assert';

import { injectEnrollTicketAuth } from '../src/lib/enroll-ticket-proxy.js';

describe('enroll-ticket-proxy', () => {
  it('injects Authorization for POST /api/enroll/:id/ticket when cookie token exists', () => {
    const headers: Record<string, string> = {};

    injectEnrollTicketAuth(
      {
        setHeader: (name, value) => {
          headers[name] = value;
        },
      },
      {
        method: 'POST',
        url: '/api/enroll/cls_123/ticket',
        headers: {
          cookie: 'cp_access_token=token-abc; other=1',
        },
      }
    );

    assert.equal(headers.Authorization, 'Bearer token-abc');
  });

  it('does not override existing Authorization header', () => {
    const headers: Record<string, string> = {};

    injectEnrollTicketAuth(
      {
        setHeader: (name, value) => {
          headers[name] = value;
        },
      },
      {
        method: 'POST',
        url: '/api/enroll/cls_123/ticket',
        headers: {
          authorization: 'Bearer already',
          cookie: 'cp_access_token=token-abc',
        },
      }
    );

    assert.equal(headers.Authorization, undefined);
  });

  it('ignores non-matching routes', () => {
    const headers: Record<string, string> = {};

    injectEnrollTicketAuth(
      {
        setHeader: (name, value) => {
          headers[name] = value;
        },
      },
      {
        method: 'POST',
        url: '/api/enroll/cls_123',
        headers: {
          cookie: 'cp_access_token=token-abc',
        },
      }
    );

    assert.equal(headers.Authorization, undefined);
  });
});
