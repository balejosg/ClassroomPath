import { createLocalSinkMailboxProvider } from './mailboxes/local-sink-provider.js';
import { createMailTmMailboxProvider } from './mailboxes/mailtm-provider.js';

export type WaitForMessageOptions = {
  timeoutMs?: number;
  pollMs?: number;
  after?: Date;
  subjectIncludes?: string;
  toAddress?: string;
  fromAddress?: string;
  predicate?: (message: MailTmMessage) => boolean | Promise<boolean>;
};

export type WaitForLinkOptions = Omit<WaitForMessageOptions, 'predicate'> & {
  urlIncludes?: string;
  urlPattern?: RegExp;
};

export type WaitForOtpOptions = Omit<WaitForMessageOptions, 'predicate'> & {
  otpPattern?: RegExp;
};

export type MailTmAddress = {
  name: string;
  address: string;
};

export type MailTmMessageSummary = {
  id: string;
  accountId: string;
  msgid: string;
  from: MailTmAddress;
  to: MailTmAddress[];
  subject: string;
  intro?: string;
  seen: boolean;
  isDeleted: boolean;
  hasAttachments: boolean;
  size: number;
  downloadUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type MailTmMessage = MailTmMessageSummary & {
  cc?: string[];
  bcc?: string[];
  flagged?: boolean;
  verifications?: string[];
  retention?: boolean;
  retentionDate?: string;
  text?: string;
  html?: string[];
  attachments?: MailTmAttachment[];
};

export type MailTmAttachment = {
  id: string;
  filename: string;
  contentType: string;
  disposition: string;
  transferEncoding: string;
  related: boolean;
  size: number;
  downloadUrl: string;
};

export type MailboxFixture = {
  address: string;
  password: string;
  startedAt: Date;
  listMessages(): Promise<MailTmMessageSummary[]>;
  waitForMessage(options?: WaitForMessageOptions): Promise<MailTmMessage>;
  waitForLink(options?: WaitForLinkOptions): Promise<string>;
  waitForOtp(options?: WaitForOtpOptions): Promise<string>;
};

export type MailboxFixtureResult = {
  mailbox: MailboxFixture;
  cleanup(): Promise<void>;
};

export interface MailboxProvider {
  createFixture(): Promise<MailboxFixtureResult>;
}

type ProviderSet = {
  localSink: MailboxProvider;
  mailTm: MailboxProvider;
};

const defaultProviders: ProviderSet = {
  localSink: createLocalSinkMailboxProvider(),
  mailTm: createMailTmMailboxProvider(),
};

export function createMailboxProviderSelector(providers: ProviderSet = defaultProviders) {
  return async (env: NodeJS.ProcessEnv = process.env): Promise<MailboxFixtureResult> => {
    const provider = env.E2E_REAL_EMAIL === '1' ? providers.mailTm : providers.localSink;
    return provider.createFixture();
  };
}

export async function createMailboxFixture(
  env: NodeJS.ProcessEnv = process.env
): Promise<MailboxFixtureResult> {
  return createMailboxProviderSelector()(env);
}
