import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page } from '@playwright/test';

import { resolveTestEmailSinkFile } from '@classroompath/testkit/test-email-sink';
import { SEEDED_E2E_ORGANIZATION } from '@classroompath/testkit/test-actors';
import { test, expect } from './fixtures/base-test';
import {
  clearAuth,
  createTestUser,
  getAdminAccountForWorker,
  loginAsAdmin,
  openRegisterForm,
  parseTrpcResult,
  type MailboxFixture,
  waitForPostAuthScreen,
} from './fixtures/test-utils';
import { createMailboxFixture } from './fixtures/mailbox-provider';
import type { WaitForLinkOptions } from './fixtures/mailbox-provider';
import {
  extractLinksFromMessage,
  matchesLink,
} from './fixtures/mailboxes/mailbox-message-utils.js';
import { AcceptInvitationPage, OrganizationPage, ResetPasswordPage } from './fixtures/page-objects';

type VerificationResponse = {
  email?: string;
  emailSent?: boolean;
  verificationRequired?: boolean;
  verificationUrl?: string;
};

const VERIFICATION_SUBJECT = 'Verifica tu correo de ClassroomPath';
const RESET_SUBJECT = 'Restablece tu acceso a ClassroomPath';
const BASE_URL = new URL(process.env.BASE_URL ?? 'http://localhost:5173');
const EXPECT_MANUAL_VERIFICATION_LINK = ['localhost', '127.0.0.1'].includes(BASE_URL.hostname);
const USE_LOCAL_SINK_LINK_READER = process.env.E2E_REAL_EMAIL !== '1';

test.describe.serial('Auth email delivery UAT', () => {
  test.afterEach(async () => {
    if (process.env.E2E_REAL_EMAIL === '1') {
      await sleep(30000);
    }
  });

  async function registerUserAwaitingEmail(
    page: Page,
    user: { email: string; name: string; password: string }
  ): Promise<VerificationResponse> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await openRegisterForm(page);

        const registerResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().includes('/cp/trpc/auth.register?batch=1'),
          { timeout: 20000 }
        );

        await page.getByTestId('register-email').fill(user.email);
        await page.getByTestId('register-name').fill(user.name);
        await page.getByTestId('register-password').fill(user.password);
        await page.getByTestId('register-confirm-password').fill(user.password);
        await page.getByTestId('register-terms').check();
        await page.getByTestId('register-submit').click();

        const registerResponse = await registerResponsePromise;
        const payload = parseTrpcResult<VerificationResponse>(
          await registerResponse.text(),
          `auth.register response for ${user.email}`
        );

        expect(payload.email).toBe(user.email);
        expect(payload.verificationRequired).toBe(true);
        expect(payload.emailSent).toBe(true);

        await expect(page.getByText('Revisa tu correo')).toBeVisible({ timeout: 10000 });
        if (EXPECT_MANUAL_VERIFICATION_LINK) {
          await expect(page.getByTestId('register-manual-verification-link')).toBeVisible({
            timeout: 10000,
          });
        } else {
          await expect(page.getByTestId('register-manual-verification-link')).toHaveCount(0);
        }

        return payload;
      } catch (error) {
        if (!isTooManyRequestsError(error) || attempt === 2) {
          throw error;
        }

        await sleep(30000 * (attempt + 1));
      }
    }

    throw new Error(`Unable to register ${user.email}`);
  }

  async function submitLogin(page: Page, email: string, password: string): Promise<void> {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('login-submit').click();
  }

  async function waitForVerificationSuccess(page: Page): Promise<void> {
    await page.getByText(/Correo verificado|Verificando tu correo/i).waitFor({
      state: 'visible',
      timeout: 20000,
    });
    await page.getByText(/Correo verificado/i).waitFor({ state: 'visible', timeout: 20000 });
  }

  function getTokenParam(link: string, param = 'token'): string {
    const token = new URL(link).searchParams.get(param);
    if (!token) {
      throw new Error(`Link is missing ${param}: ${link}`);
    }
    return token;
  }

  async function verifyInboxLinkAndLogin(
    page: Page,
    mailbox: MailboxFixture,
    user: { email: string; password: string },
    options: {
      assertBlockedLoginBeforeVerify?: boolean;
      onboardingOrgName?: string;
    } = {}
  ): Promise<string> {
    const deliveredLink = await waitForDeliveryLink(mailbox, {
      subjectIncludes: VERIFICATION_SUBJECT,
      timeoutMs: 60000,
      urlIncludes: '/login?',
    });

    if (options.assertBlockedLoginBeforeVerify) {
      await submitLogin(page, user.email, user.password);
      await expect(
        page.getByText(/Debes verificar tu correo antes de iniciar sesion/i)
      ).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('login-resend-verification')).toBeVisible();
    }

    await page.goto(deliveredLink);
    await waitForVerificationSuccess(page);
    await loginUntilPostAuth(page, user.email, user.password);

    if (options.onboardingOrgName) {
      await completeOrgOnboarding(page, options.onboardingOrgName);
      return deliveredLink;
    }

    return deliveredLink;
  }

  async function loginUntilPostAuth(page: Page, email: string, password: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await submitLogin(page, email, password);

      try {
        await waitForPostAuthScreen(page, 10000);
        return;
      } catch (error) {
        const invalidCredentialsVisible = await page
          .getByText(/Credenciales invalidas o error de conexion/i)
          .isVisible()
          .catch(() => false);

        if (!invalidCredentialsVisible || attempt === 2) {
          throw error;
        }

        await sleep(2000 * (attempt + 1));
        await page.goto('/login');
      }
    }
  }

  async function createVerifiedAdminWithOrganization(page: Page, mailbox: MailboxFixture) {
    const adminUser = createTestUser({
      email: mailbox.address,
      password: 'UatPassword123!',
      name: 'UAT Admin Mailbox User',
    });

    const registerPayload = await registerUserAwaitingEmail(page, adminUser);
    const deliveredLink = await verifyInboxLinkAndLogin(page, mailbox, adminUser);

    expect(String(registerPayload.verificationUrl)).toContain('/login?');
    expect(new URL(String(registerPayload.verificationUrl)).origin).toBe(BASE_URL.origin);
    expect(new URL(deliveredLink).origin).toBe(BASE_URL.origin);

    await clearAuth(page);
    await loginAsAdmin(page);

    return {
      verifiedUser: adminUser,
      tenantAdminEmail: getAdminAccountForWorker().email,
      orgName: SEEDED_E2E_ORGANIZATION.name,
    };
  }

  async function createSecondaryMailbox() {
    return createMailboxFixture();
  }

  async function inviteMemberAndWaitForEmail(
    page: Page,
    organizationPage: OrganizationPage,
    invitee: { email: string; name: string },
    role: 'admin' | 'teacher',
    subjectIncludes: string,
    inbox: MailboxFixture
  ): Promise<string> {
    await organizationPage.goto();
    await organizationPage.waitForUsersLoaded();
    await organizationPage.inviteMember(invitee.name, invitee.email, role);

    await expect(page.getByText('Invitación enviada')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(`Se envió la invitación a ${invitee.email}.`)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('a[href*="accept-invitation?token="]')).toHaveCount(0);

    return inbox.waitForLink({
      subjectIncludes,
      timeoutMs: 60000,
      urlIncludes: '/accept-invitation?token=',
    });
  }

  async function acceptInvitationLink(
    context: BrowserContext,
    link: string,
    password: string
  ): Promise<Page> {
    const inviteePage = await context.newPage();
    const acceptInvitationPage = new AcceptInvitationPage(inviteePage);

    await inviteePage.goto(link);
    await acceptInvitationPage.expectLoaded();
    await acceptInvitationPage.accept(password);
    await waitForPostAuthScreen(inviteePage, 30000);

    return inviteePage;
  }

  test('delivers the registration verification email and unlocks login only after inbox verification @email @uat', async ({
    page,
    mailbox,
  }) => {
    test.setTimeout(120000);

    const user = createTestUser({
      email: mailbox.address,
      password: 'UatPassword123!',
      name: 'UAT Mailbox User',
    });

    const registerPayload = await registerUserAwaitingEmail(page, user);
    const deliveredLink = await waitForDeliveryLink(mailbox, {
      subjectIncludes: VERIFICATION_SUBJECT,
      timeoutMs: 60000,
      urlIncludes: '/login?',
    });

    expect(registerPayload.verificationUrl).toContain('/login?');
    expect(new URL(String(registerPayload.verificationUrl)).origin).toBe(BASE_URL.origin);
    expect(new URL(deliveredLink).origin).toBe(BASE_URL.origin);

    await submitLogin(page, user.email, user.password);
    await expect(page.getByText(/Debes verificar tu correo antes de iniciar sesion/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId('login-resend-verification')).toBeVisible();

    await page.goto(deliveredLink);
    await waitForVerificationSuccess(page);

    await loginUntilPostAuth(page, user.email, user.password);
  });

  test('resends a fresh verification link from login and keeps the manual link hidden when delivery succeeds @email @uat', async ({
    page,
    mailbox,
  }) => {
    test.setTimeout(120000);

    const user = createTestUser({
      email: mailbox.address,
      password: 'UatPassword123!',
      name: 'UAT Resend User',
    });

    await registerUserAwaitingEmail(page, user);

    const initialLink = await waitForDeliveryLink(mailbox, {
      subjectIncludes: VERIFICATION_SUBJECT,
      timeoutMs: 60000,
      urlIncludes: '/login?',
    });
    const resendStartedAt = new Date();

    await submitLogin(page, user.email, user.password);
    await expect(page.getByText(/Debes verificar tu correo antes de iniciar sesion/i)).toBeVisible({
      timeout: 10000,
    });

    await page.getByTestId('login-resend-verification').click();

    await expect(page.getByText(/Te enviamos un nuevo enlace de verificacion/i)).toBeVisible({
      timeout: 10000,
    });
    if (EXPECT_MANUAL_VERIFICATION_LINK) {
      await expect(page.getByText('Enlace manual de verificacion')).toBeVisible({
        timeout: 10000,
      });
    } else {
      await expect(page.getByText('Enlace manual de verificacion')).toHaveCount(0);
    }

    const resentLink = await waitForDeliveryLink(mailbox, {
      subjectIncludes: VERIFICATION_SUBJECT,
      timeoutMs: 60000,
      urlIncludes: '/login?',
      after: resendStartedAt,
    });

    expect(getTokenParam(resentLink)).not.toBe(getTokenParam(initialLink));

    await page.goto(resentLink);
    await waitForVerificationSuccess(page);

    await loginUntilPostAuth(page, user.email, user.password);
  });

  test('delivers tenant invitation email and activates the invited admin from the inbox link @email @uat', async ({
    page,
    mailbox,
    browser,
  }) => {
    test.setTimeout(180000);

    const inviteeFixture = await createSecondaryMailbox();
    const inviteeUser = createTestUser({
      email: inviteeFixture.mailbox.address,
      password: 'InviteePassword123!',
      name: 'UAT Invitee Admin',
    });
    const inviteeContext = await browser.newContext();

    try {
      const { tenantAdminEmail, orgName } = await createVerifiedAdminWithOrganization(
        page,
        mailbox
      );
      const organizationPage = new OrganizationPage(page);

      const inviteLink = await inviteMemberAndWaitForEmail(
        page,
        organizationPage,
        inviteeUser,
        'admin',
        orgName,
        inviteeFixture.mailbox
      );

      expect(getTokenParam(inviteLink).length).toBeGreaterThan(10);

      const inviteePage = await acceptInvitationLink(
        inviteeContext,
        inviteLink,
        inviteeUser.password
      );
      const inviteeOrganizationPage = new OrganizationPage(inviteePage);

      await inviteeOrganizationPage.goto();
      await inviteeOrganizationPage.waitForUsersLoaded();

      await organizationPage.goto();
      await organizationPage.waitForUsersLoaded();
      await expect(organizationPage.rowForEmail(tenantAdminEmail)).toBeVisible({ timeout: 15000 });
      await expect(organizationPage.rowForEmail(inviteeUser.email)).toBeVisible({ timeout: 15000 });
      await expect(inviteeOrganizationPage.rowForEmail(inviteeUser.email)).toBeVisible({
        timeout: 15000,
      });
    } finally {
      await inviteeContext.close();
      await inviteeFixture.cleanup();
    }
  });

  test('delivers tenant recovery email and lets the invited member reset access from the inbox link @email @uat', async ({
    page,
    mailbox,
    browser,
  }) => {
    test.setTimeout(180000);

    const inviteeFixture = await createSecondaryMailbox();
    const inviteeUser = createTestUser({
      email: inviteeFixture.mailbox.address,
      password: 'InviteePassword123!',
      name: 'UAT Recovery User',
    });
    const newPassword = 'RecoveredPassword123!';
    const inviteeContext = await browser.newContext();
    const recoveryContext = await browser.newContext();

    try {
      const { orgName } = await createVerifiedAdminWithOrganization(page, mailbox);
      const organizationPage = new OrganizationPage(page);

      const inviteLink = await inviteMemberAndWaitForEmail(
        page,
        organizationPage,
        inviteeUser,
        'teacher',
        orgName,
        inviteeFixture.mailbox
      );

      await acceptInvitationLink(inviteeContext, inviteLink, inviteeUser.password);

      await page.goto('/');
      await organizationPage.goto();
      await organizationPage.waitForUsersLoaded();
      await expect(organizationPage.rowForEmail(inviteeUser.email)).toBeVisible({ timeout: 15000 });

      const resetStartedAt = new Date();
      await organizationPage.requestPasswordReset(inviteeUser.email);

      await expect(page.getByText('Enlace de recuperación enviado')).toBeVisible({
        timeout: 10000,
      });
      await expect(
        page.getByText(`Se envió un correo de recuperación a ${inviteeUser.email}.`)
      ).toBeVisible({ timeout: 10000 });
      await expect(page.locator('a[href*="reset-password?email="]')).toHaveCount(0);

      const recoveryLink = await waitForDeliveryLink(inviteeFixture.mailbox, {
        subjectIncludes: RESET_SUBJECT,
        timeoutMs: 60000,
        urlIncludes: '/reset-password?email=',
        after: resetStartedAt,
      });

      expect(getTokenParam(recoveryLink)).toHaveLength(12);
      expect(getTokenParam(recoveryLink, 'email')).toBe(inviteeUser.email);

      const recoveryPage = await recoveryContext.newPage();
      const resetPasswordPage = new ResetPasswordPage(recoveryPage);

      await recoveryPage.goto(recoveryLink);
      await resetPasswordPage.expectLoaded(inviteeUser.email);
      await expect(resetPasswordPage.tokenInput).toHaveValue(/.+/, { timeout: 15000 });
      await resetPasswordPage.resetPassword(newPassword);

      await expect(recoveryPage.getByText('Contraseña actualizada')).toBeVisible({
        timeout: 20000,
      });

      await loginUntilPostAuth(recoveryPage, inviteeUser.email, newPassword);
    } finally {
      await recoveryContext.close();
      await inviteeContext.close();
      await inviteeFixture.cleanup();
    }
  });
});

async function waitForDeliveryLink(
  mailbox: MailboxFixture,
  options: WaitForLinkOptions
): Promise<string> {
  if (!USE_LOCAL_SINK_LINK_READER) {
    return mailbox.waitForLink(options);
  }

  const {
    after,
    pollMs = 250,
    subjectIncludes,
    timeoutMs = 45000,
    urlIncludes,
    urlPattern,
  } = options;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const link = await findLocalSinkLink(mailbox.address, {
      after,
      subjectIncludes,
      urlIncludes,
      urlPattern,
    });
    if (link) {
      return link;
    }

    await sleep(pollMs);
  }

  const fallbackLink = await findLocalSinkLink(mailbox.address, {
    after,
    subjectIncludes,
    urlIncludes,
    urlPattern,
  });
  if (fallbackLink) {
    return fallbackLink;
  }

  throw new Error('Timeout esperando email en el sink local');
}

async function findLocalSinkLink(
  address: string,
  options: Pick<WaitForLinkOptions, 'after' | 'subjectIncludes' | 'urlIncludes' | 'urlPattern'>
): Promise<string | null> {
  const normalizedAddress = address.trim().toLowerCase();
  const lines = await readLocalSinkLines();

  for (const line of lines.reverse()) {
    const entry = JSON.parse(line) as {
      createdAt: string;
      html?: string;
      subject: string;
      text?: string;
      to: string;
    };

    if (entry.to.trim().toLowerCase() !== normalizedAddress) {
      continue;
    }
    if (options.after && new Date(entry.createdAt).getTime() < options.after.getTime()) {
      continue;
    }
    if (options.subjectIncludes && !entry.subject.includes(options.subjectIncludes)) {
      continue;
    }

    const links = extractLinksFromMessage({
      id: entry.createdAt,
      accountId: 'local',
      msgid: entry.createdAt,
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
      seen: false,
      isDeleted: false,
      hasAttachments: false,
      size: 0,
      createdAt: entry.createdAt,
      updatedAt: entry.createdAt,
      text: entry.text,
      html: entry.html ? [entry.html] : [],
    });
    const link = links.find((candidate) =>
      matchesLink(candidate, options.urlIncludes, options.urlPattern)
    );

    if (link) {
      return link;
    }
  }

  return null;
}

async function readLocalSinkLines(): Promise<string[]> {
  try {
    const body = await readFile(resolveTestEmailSinkFile(), 'utf8');
    return body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function isTooManyRequestsError(error: unknown): boolean {
  return error instanceof Error && /too many requests/i.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
