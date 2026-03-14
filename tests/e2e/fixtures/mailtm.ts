type MailTmDomain = {
  id: string;
  domain: string;
  isActive: boolean;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
};

type MailTmAddress = {
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

type MailTmAttachment = {
  id: string;
  filename: string;
  contentType: string;
  disposition: string;
  transferEncoding: string;
  related: boolean;
  size: number;
  downloadUrl: string;
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

type HydraCollection<T> = {
  'hydra:member': T[];
  'hydra:totalItems': number;
};

type MailTmCollection<T> = HydraCollection<T> | T[];

type MailTmAccount = {
  id: string;
  address: string;
  quota: number;
  used: number;
  isDisabled: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
};

type TokenResponse = {
  id: string;
  token: string;
};

export type MailTmMailboxAccount = {
  id: string;
  address: string;
  password: string;
};

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

export type MailboxFixture = {
  address: string;
  password: string;
  startedAt: Date;
  listMessages(): Promise<MailTmMessageSummary[]>;
  waitForMessage(options?: WaitForMessageOptions): Promise<MailTmMessage>;
  waitForLink(options?: WaitForLinkOptions): Promise<string>;
  waitForOtp(options?: WaitForOtpOptions): Promise<string>;
};

export class MailTmClient {
  private token?: string;

  constructor(private readonly baseUrl = 'https://api.mail.tm') {}

  async listDomains(): Promise<MailTmDomain[]> {
    const data = await this.request<MailTmCollection<MailTmDomain>>(
      '/domains',
      {
        method: 'GET',
      },
      false
    );
    return asCollectionItems(data);
  }

  async createAccount(address: string, password: string): Promise<MailTmAccount> {
    return this.request<MailTmAccount>(
      '/accounts',
      {
        method: 'POST',
        body: JSON.stringify({ address, password }),
      },
      false
    );
  }

  async login(address: string, password: string): Promise<void> {
    const data = await this.request<TokenResponse>(
      '/token',
      {
        method: 'POST',
        body: JSON.stringify({ address, password }),
      },
      false
    );
    this.token = data.token;
  }

  async createRandomAccount(prefix = 'e2e'): Promise<MailTmMailboxAccount> {
    const domains = await this.listDomains();
    const domain = domains.find((entry) => entry.isActive && !entry.isPrivate) ?? domains[0];

    if (!domain) {
      throw new Error('No hay dominios disponibles en mail.tm');
    }

    const localPart = `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`.toLowerCase();
    const address = `${localPart}@${domain.domain}`;
    const password = crypto.randomUUID();
    const account = await this.createAccount(address, password);

    await this.login(address, password);

    return {
      id: account.id,
      address,
      password,
    };
  }

  async listMessages(page = 1): Promise<MailTmMessageSummary[]> {
    const data = await this.request<MailTmCollection<MailTmMessageSummary>>(
      `/messages?page=${String(page)}`,
      { method: 'GET' }
    );
    return asCollectionItems(data);
  }

  async getMessage(id: string): Promise<MailTmMessage> {
    return this.request<MailTmMessage>(`/messages/${id}`, { method: 'GET' });
  }

  async deleteAccount(id: string): Promise<void> {
    await this.request(`/accounts/${id}`, { method: 'DELETE' });
  }

  async waitForMessage(options: WaitForMessageOptions = {}): Promise<MailTmMessage> {
    const {
      timeoutMs = 45000,
      pollMs = 1500,
      after,
      subjectIncludes,
      toAddress,
      fromAddress,
      predicate,
    } = options;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const messages = await this.listMessages(1);
      const sorted = [...messages].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );

      for (const message of sorted) {
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
          !message.to.some(
            (recipient) => recipient.address.toLowerCase() === toAddress.toLowerCase()
          )
        ) {
          continue;
        }

        const fullMessage = await this.getMessage(message.id);

        if (predicate && !(await predicate(fullMessage))) {
          continue;
        }

        return fullMessage;
      }

      await sleep(pollMs);
    }

    throw new Error('Timeout esperando email en mail.tm');
  }

  extractLinks(message: MailTmMessage): string[] {
    const combined = this.getCombinedBody(message).replace(/&amp;/g, '&');
    const matches = combined.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    return [...new Set(matches.map((url) => url.replace(/[),.;]+$/g, '')))];
  }

  extractOtp(message: MailTmMessage, pattern: RegExp = /\b\d{6}\b/): string | null {
    const combined = this.getCombinedBody(message);
    return combined.match(pattern)?.[0] ?? null;
  }

  getCombinedBody(message: MailTmMessage): string {
    const text = message.text ?? '';
    const html = (message.html ?? []).join('\n');
    const htmlAsText = stripHtml(html);
    return [text, html, htmlAsText].filter(Boolean).join('\n');
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit,
    requireAuth = true
  ): Promise<T> {
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      const headers = new Headers(init.headers);

      headers.set('Accept', 'application/json');

      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      if (requireAuth) {
        if (!this.token) {
          throw new Error('No autenticado. Llama a login() o createRandomAccount() primero.');
        }
        headers.set('Authorization', `Bearer ${this.token}`);
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });

      if (response.status === 429 && attempt < 3) {
        await sleep(getRetryDelayMs(response, attempt));
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`mail.tm ${response.status} ${response.statusText}: ${body}`);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('json')) {
        return (await response.json()) as T;
      }

      return (await response.text()) as T;
    }

    throw new Error(`mail.tm request exhausted retries for ${path}`);
  }
}

export async function createMailTmMailboxFixture(): Promise<{
  account: MailTmMailboxAccount;
  mailbox: MailboxFixture;
  cleanup(): Promise<void>;
}> {
  const client = new MailTmClient();
  const account = await client.createRandomAccount('e2e');
  const startedAt = new Date();

  const mailbox: MailboxFixture = {
    address: account.address,
    password: account.password,
    startedAt,
    listMessages: () => client.listMessages(),
    waitForMessage: (options = {}) =>
      client.waitForMessage({
        after: startedAt,
        toAddress: account.address,
        ...options,
      }),
    waitForLink: async (options = {}) => {
      const { urlIncludes, urlPattern, ...rest } = options;
      const message = await client.waitForMessage({
        after: startedAt,
        toAddress: account.address,
        ...rest,
        predicate: async (fullMessage) => {
          const links = client.extractLinks(fullMessage);
          return links.some((link) => matchesLink(link, urlIncludes, urlPattern));
        },
      });

      const link = client
        .extractLinks(message)
        .find((entry) => matchesLink(entry, urlIncludes, urlPattern));

      if (!link) {
        throw new Error('No se encontró ningún link válido en el email');
      }

      return link;
    },
    waitForOtp: async (options = {}) => {
      const { otpPattern = /\b\d{6}\b/, ...rest } = options;
      const message = await client.waitForMessage({
        after: startedAt,
        toAddress: account.address,
        ...rest,
        predicate: async (fullMessage) => !!client.extractOtp(fullMessage, otpPattern),
      });
      const otp = client.extractOtp(message, otpPattern);

      if (!otp) {
        throw new Error('No se encontró OTP en el email');
      }

      return otp;
    },
  };

  return {
    account,
    mailbox,
    cleanup: async () => {
      if (process.env.KEEP_TEST_MAILBOX === '1') {
        return;
      }

      await client.deleteAccount(account.id).catch(() => undefined);
    },
  };
}

function matchesLink(link: string, urlIncludes?: string, urlPattern?: RegExp): boolean {
  if (urlIncludes && !link.includes(urlIncludes)) {
    return false;
  }
  if (urlPattern && !urlPattern.test(link)) {
    return false;
  }
  return true;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function asCollectionItems<T>(data: MailTmCollection<T>): T[] {
  return Array.isArray(data) ? data : (data['hydra:member'] ?? []);
}

function getRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');

  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (Number.isFinite(seconds)) {
      return Math.max(seconds * 1000, 1000);
    }

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) {
      return Math.max(retryAt - Date.now(), 1000);
    }
  }

  return 30000 * (attempt + 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
