import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { getApiCopy, resolveApiLocale } from '../src/lib/api-content.ts';

describe('api content copy', () => {
  test('resolves supported API locales with English fallback', () => {
    assert.equal(resolveApiLocale('es-ES'), 'es');
    assert.equal(resolveApiLocale('ES'), 'es');
    assert.equal(resolveApiLocale('en-US'), 'en');
    assert.equal(resolveApiLocale(null), 'en');
    assert.equal(resolveApiLocale(undefined), 'en');
  });

  test('returns localized email and push copy', () => {
    const english = getApiCopy('en');
    const spanish = getApiCopy('es');

    assert.equal(english.email.verificationSubject, 'Verify your ClassroomPath email');
    assert.equal(spanish.email.verificationSubject, 'Verifica tu correo de ClassroomPath');
    assert.equal(
      english.push.newDomainRequestBody('example.com'),
      'example.com is requesting access'
    );
    assert.equal(spanish.push.newDomainRequestBody('example.com'), 'example.com solicita acceso');
  });
});
