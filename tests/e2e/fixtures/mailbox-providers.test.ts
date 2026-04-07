import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, test } from 'node:test';

import {
  appendTestEmailSinkEntry,
  clearTestEmailSink,
} from '@classroompath/testkit/test-email-sink';
import { createMailboxProviderSelector, type MailboxProvider } from './mailbox-provider.js';
import { createLocalSinkMailboxProvider } from './mailboxes/local-sink-provider.js';

describe('mailbox providers', () => {
  test('selects the Mail.tm provider when E2E_REAL_EMAIL is enabled', async () => {
    const calls: string[] = [];
    const selector = createMailboxProviderSelector({
      localSink: {
        createFixture: async () => {
          calls.push('local');
          throw new Error('local should not be selected');
        },
      } satisfies MailboxProvider,
      mailTm: {
        createFixture: async () => {
          calls.push('mailtm');
          return {
            mailbox: {
              address: 'mailtm@example.test',
              password: 'secret',
              startedAt: new Date(0),
              listMessages: async () => [],
              waitForMessage: async () => {
                throw new Error('not used');
              },
              waitForLink: async () => 'https://classroompath.test/login?token=mailtm',
              waitForOtp: async () => '123456',
            },
            cleanup: async () => undefined,
          };
        },
      } satisfies MailboxProvider,
    });

    const fixture = await selector({ E2E_REAL_EMAIL: '1' } as NodeJS.ProcessEnv);

    assert.equal(fixture.mailbox.address, 'mailtm@example.test');
    assert.deepEqual(calls, ['mailtm']);
  });

  test('selects the local sink provider by default', async () => {
    const calls: string[] = [];
    const selector = createMailboxProviderSelector({
      localSink: {
        createFixture: async () => {
          calls.push('local');
          return {
            mailbox: {
              address: 'local@classroompath.test',
              password: 'secret',
              startedAt: new Date(0),
              listMessages: async () => [],
              waitForMessage: async () => {
                throw new Error('not used');
              },
              waitForLink: async () => 'https://classroompath.test/login?token=local',
              waitForOtp: async () => '654321',
            },
            cleanup: async () => undefined,
          };
        },
      } satisfies MailboxProvider,
      mailTm: {
        createFixture: async () => {
          calls.push('mailtm');
          throw new Error('mailtm should not be selected');
        },
      } satisfies MailboxProvider,
    });

    const fixture = await selector({} as NodeJS.ProcessEnv);

    assert.equal(fixture.mailbox.address, 'local@classroompath.test');
    assert.deepEqual(calls, ['local']);
  });

  test('local sink provider can read a matching email even when it predates fixture startedAt', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cp-local-mailbox-'));
    const sinkFile = join(tempDir, 'emails.jsonl');
    const originalSinkFile = process.env.CP_TEST_EMAIL_SINK_FILE;

    process.env.CP_TEST_EMAIL_SINK_FILE = sinkFile;

    try {
      const provider = createLocalSinkMailboxProvider();
      const fixture = await provider.createFixture();
      const createdAt = new Date(fixture.mailbox.startedAt.getTime() - 1_000).toISOString();

      await appendTestEmailSinkEntry({
        to: fixture.mailbox.address,
        subject: 'Verifica tu correo de ClassroomPath',
        html: '<p><a href="http://localhost:5173/login?email=test%40classroompath.test&token=abc123">Verificar</a></p>',
        text: 'Verifica tu correo aqui: http://localhost:5173/login?email=test%40classroompath.test&token=abc123',
        createdAt,
      });

      const link = await fixture.mailbox.waitForLink({
        subjectIncludes: 'Verifica tu correo de ClassroomPath',
        timeoutMs: 1_000,
        urlIncludes: '/login?',
      });

      assert.equal(
        link,
        'http://localhost:5173/login?email=test%40classroompath.test&token=abc123'
      );

      await clearTestEmailSink();
      await fixture.cleanup();
    } finally {
      if (originalSinkFile === undefined) {
        delete process.env.CP_TEST_EMAIL_SINK_FILE;
      } else {
        process.env.CP_TEST_EMAIL_SINK_FILE = originalSinkFile;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('local sink provider picks up a matching email that arrives after polling starts', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cp-local-mailbox-'));
    const sinkFile = join(tempDir, 'emails.jsonl');
    const originalSinkFile = process.env.CP_TEST_EMAIL_SINK_FILE;

    process.env.CP_TEST_EMAIL_SINK_FILE = sinkFile;

    try {
      const provider = createLocalSinkMailboxProvider();
      const fixture = await provider.createFixture();

      const waitForLinkPromise = fixture.mailbox.waitForLink({
        subjectIncludes: 'Verifica tu correo de ClassroomPath',
        timeoutMs: 2_000,
        pollMs: 50,
        urlIncludes: '/login?',
      });

      setTimeout(() => {
        void appendTestEmailSinkEntry({
          to: fixture.mailbox.address,
          subject: 'Verifica tu correo de ClassroomPath',
          html: '<p><a href="http://localhost:5173/login?email=test%40classroompath.test&token=late123">Verificar</a></p>',
          text: 'Verifica tu correo aqui: http://localhost:5173/login?email=test%40classroompath.test&token=late123',
          createdAt: new Date().toISOString(),
        });
      }, 100);

      const link = await waitForLinkPromise;

      assert.equal(
        link,
        'http://localhost:5173/login?email=test%40classroompath.test&token=late123'
      );

      await clearTestEmailSink();
      await fixture.cleanup();
    } finally {
      if (originalSinkFile === undefined) {
        delete process.env.CP_TEST_EMAIL_SINK_FILE;
      } else {
        process.env.CP_TEST_EMAIL_SINK_FILE = originalSinkFile;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test('local sink provider accepts display-name recipient formatting in sink entries', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'cp-local-mailbox-'));
    const sinkFile = join(tempDir, 'emails.jsonl');
    const originalSinkFile = process.env.CP_TEST_EMAIL_SINK_FILE;

    process.env.CP_TEST_EMAIL_SINK_FILE = sinkFile;

    try {
      const provider = createLocalSinkMailboxProvider();
      const fixture = await provider.createFixture();

      await appendTestEmailSinkEntry({
        to: `Mailbox User <${fixture.mailbox.address}>`,
        subject: 'Verifica tu correo de ClassroomPath',
        html: '<p><a href="http://localhost:5173/login?email=test%40classroompath.test&token=formatted123">Verificar</a></p>',
        text: 'Verifica tu correo aqui: http://localhost:5173/login?email=test%40classroompath.test&token=formatted123',
        createdAt: new Date().toISOString(),
      });

      const link = await fixture.mailbox.waitForLink({
        subjectIncludes: 'Verifica tu correo de ClassroomPath',
        timeoutMs: 1_000,
        urlIncludes: '/login?',
      });

      assert.equal(
        link,
        'http://localhost:5173/login?email=test%40classroompath.test&token=formatted123'
      );

      const messages = await fixture.mailbox.listMessages();
      assert.equal(messages.length, 1);
      assert.equal(messages[0]?.to[0]?.address, `Mailbox User <${fixture.mailbox.address}>`);

      await clearTestEmailSink();
      await fixture.cleanup();
    } finally {
      if (originalSinkFile === undefined) {
        delete process.env.CP_TEST_EMAIL_SINK_FILE;
      } else {
        process.env.CP_TEST_EMAIL_SINK_FILE = originalSinkFile;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
