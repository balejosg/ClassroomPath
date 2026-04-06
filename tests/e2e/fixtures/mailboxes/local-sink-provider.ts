import { readFile } from 'node:fs/promises';

import { resolveTestEmailSinkFile } from '../../../../api/src/lib/test-email-sink.js';
import type {
  MailTmMessage,
  MailTmMessageSummary,
  MailboxFixture,
  MailboxFixtureResult,
  MailboxProvider,
  WaitForMessageOptions,
} from '../mailbox-provider.js';
import {
  extractLinksFromMessage,
  extractOtpFromMessage,
  matchesLink,
} from './mailbox-message-utils.js';

type LocalSinkEntry = {
  createdAt: string;
  html?: string;
  subject: string;
  text?: string;
  to: string;
};

export function createLocalSinkMailboxProvider(): MailboxProvider {
  return {
    async createFixture(): Promise<MailboxFixtureResult> {
      const address = `e2e-local-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@classroompath.test`;
      const password = crypto.randomUUID();
      const startedAt = new Date();

      const mailbox: MailboxFixture = {
        address,
        password,
        startedAt,
        listMessages: async () => (await listLocalMessages(address)).map(toSummary),
        waitForMessage: (options = {}) => waitForLocalMessage(address, startedAt, options),
        waitForLink: async (options = {}) => {
          const { urlIncludes, urlPattern, ...rest } = options;
          const message = await waitForLocalMessage(address, startedAt, {
            ...rest,
            predicate: async (fullMessage) =>
              extractLinksFromMessage(fullMessage).some((link) =>
                matchesLink(link, urlIncludes, urlPattern)
              ),
          });

          const link = extractLinksFromMessage(message).find((entry) =>
            matchesLink(entry, urlIncludes, urlPattern)
          );

          if (!link) {
            throw new Error('No se encontró ningún link válido en el sink local');
          }

          return link;
        },
        waitForOtp: async (options = {}) => {
          const { otpPattern = /\b\d{6}\b/, ...rest } = options;
          const message = await waitForLocalMessage(address, startedAt, {
            ...rest,
            predicate: async (fullMessage) => !!extractOtpFromMessage(fullMessage, otpPattern),
          });
          const otp = extractOtpFromMessage(message, otpPattern);

          if (!otp) {
            throw new Error('No se encontró OTP en el sink local');
          }

          return otp;
        },
      };

      return {
        mailbox,
        cleanup: async () => {},
      };
    },
  };
}

async function listLocalMessages(address: string): Promise<MailTmMessage[]> {
  const entries = await readLocalSinkEntries();
  return entries
    .filter((entry) => entry.to.toLowerCase() === address.toLowerCase())
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((entry, index) =>
      toLocalMailMessage(entry, `${Date.parse(entry.createdAt)}-${String(index)}`)
    );
}

async function waitForLocalMessage(
  address: string,
  _startedAt: Date,
  options: WaitForMessageOptions = {}
): Promise<MailTmMessage> {
  const {
    timeoutMs = 45000,
    pollMs = 250,
    after,
    subjectIncludes,
    toAddress,
    fromAddress,
    predicate,
  } = options;
  const started = Date.now();
  const expectedAddress = (toAddress ?? address).toLowerCase();

  while (Date.now() - started < timeoutMs) {
    const messages = await listLocalMessages(expectedAddress);

    for (const message of messages) {
      if (after && new Date(message.createdAt).getTime() < after.getTime()) {
        continue;
      }
      if (subjectIncludes && !message.subject.includes(subjectIncludes)) {
        continue;
      }
      if (fromAddress && message.from.address.toLowerCase() !== fromAddress.toLowerCase()) {
        continue;
      }
      if (
        toAddress &&
        !message.to.some((recipient) => recipient.address.toLowerCase() === toAddress.toLowerCase())
      ) {
        continue;
      }
      if (predicate && !(await predicate(message))) {
        continue;
      }

      return message;
    }

    await sleep(pollMs);
  }

  throw new Error('Timeout esperando email en el sink local');
}

async function readLocalSinkEntries(): Promise<LocalSinkEntry[]> {
  try {
    const body = await readFile(resolveTestEmailSinkFile(), 'utf8');
    return body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LocalSinkEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function toLocalMailMessage(entry: LocalSinkEntry, id: string): MailTmMessage {
  return {
    id,
    accountId: 'local',
    msgid: id,
    from: {
      name: 'ClassroomPath',
      address: 'no-reply@classroompath.test',
    },
    to: [
      {
        name: entry.to,
        address: entry.to,
      },
    ],
    subject: entry.subject,
    intro: entry.text?.slice(0, 140),
    seen: false,
    isDeleted: false,
    hasAttachments: false,
    size: `${entry.subject}\n${entry.text ?? ''}\n${entry.html ?? ''}`.length,
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    text: entry.text,
    html: entry.html ? [entry.html] : [],
  };
}

function toSummary(message: MailTmMessage): MailTmMessageSummary {
  const {
    cc,
    bcc,
    flagged,
    verifications,
    retention,
    retentionDate,
    text,
    html,
    attachments,
    ...summary
  } = message;

  void cc;
  void bcc;
  void flagged;
  void verifications;
  void retention;
  void retentionDate;
  void text;
  void html;
  void attachments;

  return summary;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
