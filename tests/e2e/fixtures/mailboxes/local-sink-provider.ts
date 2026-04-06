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
  getCombinedBody,
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
    .filter((entry) => entryTargetsAddress(entry, address))
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
  const expectedAddress = normalizeAddress(toAddress ?? address);

  while (Date.now() - started < timeoutMs) {
    const match = await findMatchingLocalMessage(expectedAddress, {
      after,
      fromAddress,
      predicate,
      subjectIncludes,
      toAddress,
    });
    if (match) {
      return match;
    }

    await sleep(pollMs);
  }

  const fallbackMatch = await findMatchingLocalMessage(expectedAddress, {
    after,
    fromAddress,
    predicate,
    subjectIncludes,
    toAddress,
  });
  if (fallbackMatch) {
    return fallbackMatch;
  }

  throw new Error('Timeout esperando email en el sink local');
}

async function findMatchingLocalMessage(
  expectedAddress: string,
  options: Pick<
    WaitForMessageOptions,
    'after' | 'fromAddress' | 'predicate' | 'subjectIncludes' | 'toAddress'
  >
): Promise<MailTmMessage | null> {
  const { after, fromAddress, predicate, subjectIncludes, toAddress } = options;
  const normalizedToAddress = toAddress ? normalizeAddress(toAddress) : undefined;
  const entries = (await readLocalSinkEntries()).sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

  for (const [index, entry] of entries.entries()) {
    const message = toLocalMailMessage(entry, `${Date.parse(entry.createdAt)}-${String(index)}`);

    if (
      !entryTargetsAddress(entry, expectedAddress) &&
      !messageTargetsAddress(message, expectedAddress)
    ) {
      continue;
    }

    if (after && new Date(message.createdAt).getTime() < after.getTime()) {
      continue;
    }
    if (subjectIncludes && !message.subject.includes(subjectIncludes)) {
      continue;
    }
    if (fromAddress && normalizeAddress(message.from.address) !== normalizeAddress(fromAddress)) {
      continue;
    }
    if (
      normalizedToAddress &&
      !message.to.some((recipient) => normalizeAddress(recipient.address) === normalizedToAddress)
    ) {
      continue;
    }
    if (predicate && !(await predicate(message))) {
      continue;
    }

    return message;
  }

  return null;
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

function normalizeAddress(address: string): string {
  return extractNormalizedAddress(address) ?? address.trim().toLowerCase();
}

function extractNormalizedAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const bracketMatch = trimmed.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  if (bracketMatch) {
    return bracketMatch[1].trim().toLowerCase();
  }

  if (trimmed.includes('@')) {
    return trimmed.toLowerCase();
  }

  return null;
}

function entryTargetsAddress(entry: LocalSinkEntry, expectedAddress: string): boolean {
  const normalizedEntryAddress = normalizeAddress(entry.to);
  if (normalizedEntryAddress === expectedAddress) {
    return true;
  }

  return messageBodyMentionsAddress(
    `${entry.subject}\n${entry.text ?? ''}\n${entry.html ?? ''}`,
    expectedAddress
  );
}

function messageTargetsAddress(message: MailTmMessage, expectedAddress: string): boolean {
  if (message.to.some((recipient) => normalizeAddress(recipient.address) === expectedAddress)) {
    return true;
  }

  return messageBodyMentionsAddress(getCombinedBody(message), expectedAddress);
}

function messageBodyMentionsAddress(body: string, expectedAddress: string): boolean {
  const normalizedBody = body.toLowerCase();
  return (
    normalizedBody.includes(expectedAddress) ||
    normalizedBody.includes(encodeURIComponent(expectedAddress)) ||
    normalizedBody.includes(expectedAddress.replace('@', '%40'))
  );
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
