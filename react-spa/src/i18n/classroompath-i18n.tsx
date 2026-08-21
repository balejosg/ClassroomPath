/**
 * ClassroomPath i18n layer -- CP-specific translation keys layered on top of OpenPath public i18n.
 *
 * Owns: classroomPathI18nEn and classroomPathI18nEs catalogs (CP-only keys; OpenPath shared keys
 * are provided by OpenPathI18nProvider from src/openpath/public-i18n).  The two catalogs must
 * stay in key-parity -- this is enforced by src/i18n/__tests__/classroompath-i18n.test.ts.
 * Sections are marked with "--- Section: <name> ---" comments inside each catalog object for
 * navigation.  Exports: ClassroomPathI18nProvider (wraps OpenPathI18nProvider), useClassroomPathT,
 * useClassroomPathI18n, translateClassroomPathText, and resolveClassroomPathLocale.
 */
import React, { createContext, useContext, useMemo } from 'react';

import {
  OpenPathI18nProvider,
  resolveProductLocale,
  type ProductI18nParams,
  type ProductLocale,
} from '../openpath/public-i18n';

const classroomPathI18nEn = {
  'cp.offlineInstaller.action': 'Download Windows installer',
  'cp.offlineInstaller.generating': 'Generating installer…',
  'cp.offlineInstaller.error': 'Could not generate the installer.',
  'cp.offlineInstaller.metadata': 'v{version} · SHA-256 {sha256}… · token expires {expiresAt}',
  // --- Section: app.loader + app.common (application chrome, loader, and universal UI labels) ---
  'app.loader.preparing': 'Preparing ClassroomPath...',
  'app.loader.panel': 'Loading your panel...',
  'app.common.pending': 'pending',
  'app.common.cancel': 'Cancel',
  'app.common.close': 'Close',
  'app.common.backToHome': 'Back to home',
  'app.common.backToLogin': 'Back to login',
  'app.common.login': 'Log in',
  'app.common.openDashboard': 'Open dashboard',
  'app.common.error': 'Error:',
  'app.common.retry': 'Retry',
  'app.common.processing': 'Processing...',
  'app.common.loading': 'Loading...',
  'app.common.logout': 'Log out',
  'app.common.email': 'Email',
  'app.common.name': 'Name',
  'app.common.password': 'Password',
  'app.common.confirmPassword': 'Confirm password',
  'app.common.role': 'Role',
  'app.common.teacher': 'Teacher',
  'app.common.admin': 'Administrator',
  'app.common.user': 'User',
  'app.common.active': 'Active',
  'app.common.inactive': 'Inactive',
  'app.common.approve': 'Approve',
  'app.common.reject': 'Reject',
  // --- Section: groupLibrary (policy library UI) ---
  'groupLibrary.openAriaLabel': 'Open policy library',
  'groupLibrary.openSrLabel': 'Library',
  'groupLibrary.openButtonLabel': 'Import from library',
  'groupLibrary.title': 'Policy library',
  'groupLibrary.description': 'View and clone shared policies in your organization.',
  'groupLibrary.searchPlaceholder': 'Search by name...',
  'groupLibrary.libraryTab': 'Library',
  'groupLibrary.templatesTab': 'Templates',
  'groupLibrary.manageTab': 'Manage',
  'groupLibrary.manageVisibilityPrefix': 'Mark a policy as',
  'groupLibrary.manageVisibilitySuffix': 'so it appears in the organization library.',
  'groupLibrary.visibility.private': 'Private',
  'groupLibrary.visibility.public': 'Public',
  'groupLibrary.visibility.instancePublic': 'Public (org)',
  'groupLibrary.publishTemplate': 'Publish template',
  'groupLibrary.noPublishedTemplates': 'No published templates.',
  'groupLibrary.emptyOrg': 'No policies to show.',
  'groupLibrary.emptyLibrary': 'No public policies in this organization.',
  'groupLibrary.templatesDescription':
    'Templates available to every organization. They are copied when imported.',
  'groupLibrary.domains': 'Domains',
  'groupLibrary.rules': 'Rules',
  'groupLibrary.previewAction': 'Preview',
  'groupLibrary.clone': 'Clone',
  'groupLibrary.import': 'Import',
  'groupLibrary.previous': 'Previous',
  'groupLibrary.next': 'Next',
  'groupLibrary.preview.groupTitle': 'Preview (read-only)',
  'groupLibrary.preview.groupSubtitle': 'You can clone to edit.',
  'groupLibrary.preview.templateTitle': 'Template preview',
  'groupLibrary.preview.templateSubtitle': 'You can import to edit.',
  'groupLibrary.preview.empty': 'No rules to show.',
  'groupLibrary.preview.searchPlaceholder': 'Search domain...',
  'groupLibrary.preview.loadingRules': 'Loading rules...',
  'groupLibrary.preview.total': 'Total: {total} (showing {count})',
  'groupLibrary.preview.type': 'Type',
  'groupLibrary.preview.domain': 'Domain',
  'groupLibrary.ruleType.allow': 'Allow',
  'groupLibrary.ruleType.deny': 'Block',
  'groupLibrary.ruleType.blockPath': 'Block path',
  // --- Section: app.title (page and section titles) ---
  'app.title.dashboard.admin': 'Overview',
  'app.title.dashboard.user': 'My Dashboard',
  'app.title.classrooms.admin': 'Classroom Management',
  'app.title.classrooms.user': 'Classrooms',
  'app.title.groups.admin': 'Groups and Policies',
  'app.title.groups.user': 'My Policies',
  'app.title.rules.default': 'Rules Management',
  'app.title.rules.group': 'Rules: {groupName}',
  'app.title.users.admin': 'User Administration',
  'app.title.domainRequests.admin': 'Access Requests',
  'app.title.settings': 'Settings',
  // --- Section: domainApproval (domain unblock approval flow) ---
  'domainApproval.loading': 'Loading request...',
  'domainApproval.approved.title': 'Domain approved',
  'domainApproval.approved.body': 'The request has been added to the allowlist.',
  'domainApproval.backToRequests': 'Back to requests',
  'domainApproval.unavailable.title': 'Request unavailable',
  'domainApproval.unavailable.body':
    'The request may have been approved, rejected, or no longer assigned to your groups.',
  'domainApproval.pending.label': 'Pending request',
  'domainApproval.pending.title': 'Approve domain',
  'domainApproval.domain.label': 'Domain',
  'domainApproval.group.label': 'Group',
  'domainApproval.approve.pending': 'Approving...',
  'domainApproval.approve.action': 'Approve domain',
  // --- Section: validation (form validation messages) ---
  'validation.invalidEmail': 'Invalid email address',
  'validation.weakPassword':
    'Password must be at least 8 characters and include uppercase, lowercase, and numbers',
  'validation.passwordMismatch': 'Passwords do not match',
  'validation.termsRequired': 'You must accept the terms of service',
  'validation.registrationFailed': 'Could not create the account. Please try again.',
  'validation.loginFailed': 'Could not log in. Check your credentials.',
  'validation.minLength': 'At least 8 characters',
  // --- Section: passwordStrength (password strength indicator) ---
  'passwordStrength.hasUpper': 'One uppercase letter',
  'passwordStrength.hasLower': 'One lowercase letter',
  'passwordStrength.hasDigit': 'One number',
  'passwordStrength.aria': 'Password strength: {strength} of 4 requirements met',
  // --- Section: google (Google OAuth button) ---
  'google.loading.aria': 'Loading Google button...',
  'google.retry': 'Retry Google',
  // --- Section: auth (authentication flows: login, register, invitation, reset) ---
  'auth.email.label': 'Email address',
  'auth.email.placeholder': 'admin@institution.edu',
  'auth.email.genericPlaceholder': 'user@example.com',
  'auth.email.schoolPlaceholder': 'email@school.edu',
  'auth.password.placeholder': 'Create a secure password',
  'auth.password.repeatPlaceholder': 'Repeat your password',
  'auth.login.title': 'Access',
  'auth.login.submit': 'Enter',
  'auth.login.resetPrompt': 'Need to reset your access?',
  'auth.login.divider': 'Or also',
  'auth.login.noAccount': 'Do not have an account?',
  'auth.login.register': 'Sign up',
  'auth.login.registerAria': 'Go to registration page',
  'auth.login.verifyingEmail': 'Verifying your email...',
  'auth.login.emailVerified': 'Email verified. You can now log in.',
  'auth.login.verifyFailed': 'Could not verify your email',
  'auth.login.enterEmailForVerification': 'Enter your email to resend verification',
  'auth.login.verificationSent': 'We sent you a new verification link.',
  'auth.login.verificationDeliveryUnconfirmed':
    'We could not confirm email delivery. Use the manual link.',
  'auth.login.resendFailed': 'Could not resend verification',
  'auth.login.requiresVerification': 'You must verify your email before logging in.',
  'auth.login.invalidCredentials': 'Invalid credentials or connection error',
  'auth.login.googleFailed': 'Could not log in with Google',
  'auth.login.manualVerificationLink': 'Manual verification link',
  'auth.login.resendVerification': 'Resend verification',
  'auth.register.title': 'Create Account',
  'auth.register.reviewEmail': 'Check your email',
  'auth.register.manualVerificationLink': 'Manual verification link',
  'auth.register.goToLogin': 'Go to login',
  'auth.register.fullName.placeholder': 'Your full name',
  'auth.register.acceptTermsPrefix': 'I accept the',
  'auth.register.termsLink': 'terms of service',
  'auth.register.creating': 'Creating account...',
  'auth.register.submit': 'Register',
  'auth.register.hasAccount': 'Already have an account?',
  'auth.register.login': 'Log in',
  'auth.register.googleFailed': 'Could not continue with Google',
  'auth.invitation.hero': 'Activate your access',
  'auth.invitation.invalidTitle': 'Invalid invitation',
  'auth.invitation.missingToken':
    'The activation token is missing. Open the link you received by email.',
  'auth.invitation.validating': 'Validating invitation...',
  'auth.invitation.expiredTitle': 'Expired or invalid invitation',
  'auth.invitation.expiredBody': 'Ask your administrator to send you a new invitation.',
  'auth.invitation.acceptTitle': 'Accept your invitation',
  'auth.invitation.completeRegistration': 'Complete your registration',
  'auth.invitation.activateFailed': 'Could not activate the invitation',
  'auth.invitation.acceptFailed': 'Could not accept the invitation',
  'auth.invitation.termsRequired': 'You must accept the terms to activate your access',
  'auth.invitation.existingAccount':
    'You already have an account. Log in to review and accept this invitation.',
  'auth.invitation.transferWarning':
    'Accepting this invitation will move you to another organization in ClassroomPath.',
  'auth.invitation.currentOrg': 'Current organization: {organization}',
  'auth.invitation.noCurrentOrg': 'No current organization',
  'auth.invitation.newOrg': 'New organization: {organization}',
  'auth.invitation.accepting': 'Accepting invitation...',
  'auth.invitation.acceptTransfer': 'Accept organization change',
  'auth.invitation.accept': 'Accept invitation',
  'auth.invitation.loginToContinue': 'Log in to continue',
  'auth.invitation.activating': 'Activating access...',
  'auth.invitation.activate': 'Activate access',
  'auth.reset.hero': 'Recover your access',
  'auth.reset.updatedTitle': 'Password updated',
  'auth.reset.updatedBody': 'You can now log in with your new password.',
  'auth.reset.title': 'Reset password',
  'auth.reset.token': 'Recovery token',
  'auth.reset.tokenPlaceholder': 'Paste your token here',
  'auth.reset.newPassword': 'New password',
  'auth.reset.failed': 'Could not reset the password',
  'auth.reset.updating': 'Updating...',
  'auth.reset.submit': 'Update password',
  // --- Section: onboarding (new school onboarding and billing setup) ---
  'onboarding.title': 'Welcome to ClassroomPath',
  'onboarding.subtitle': 'Choose how you want to start managing your rooms',
  'onboarding.orgNameRequired': 'Enter an organization name',
  'onboarding.classroomRequired': 'Enter at least one classroom',
  'onboarding.checkoutFailed': 'Could not start checkout',
  'onboarding.manualNote': 'Public school request from onboarding',
  'onboarding.manualSuccess': 'Request sent. We will review activation before enabling the school.',
  'onboarding.manualFailed': 'Could not send the request',
  'onboarding.selectOrg': 'Select an organization to request access',
  'onboarding.waitFailed': 'Could not process the request',
  'onboarding.billing.contract': 'Subscribe school',
  'onboarding.billing.activate': 'Activate school',
  'onboarding.billing.contractBody':
    'Activate the school with secure checkout before creating the organization. The annual fee includes Stripe Tax and onboarding is separated on the first invoice.',
  'onboarding.billing.publicBody':
    'Public schools can request activation without online payment. We will review the request before enabling the organization.',
  'onboarding.billing.orgName': 'Organization name',
  'onboarding.billing.orgPlaceholder': 'Example: San Jose School',
  'onboarding.billing.classrooms': 'Number of classrooms',
  'onboarding.billing.preparing': 'Preparing...',
  'onboarding.billing.annual': 'Subscribe annual fee',
  'onboarding.billing.pilot': 'Start pilot',
  'onboarding.billing.publicCenter': 'I am a public school',
  'onboarding.invitation.waitTitle': 'Wait for invitation',
  'onboarding.invitation.body':
    'If your institution already uses ClassroomPath, you can request access and wait for an administrator to add you. Your request will follow a traceable institutional flow.',
  'onboarding.invitation.organization': 'Organization',
  'onboarding.invitation.selectOrg': 'Select organization...',
  'onboarding.invitation.loadFailed': 'Could not load organizations.',
  'onboarding.invitation.policyNotice':
    'An administrator from your institution must authorize your access. We will not show the directory or names of other organizations from this portal.',
  'onboarding.invitation.requestAccess': 'Request Access',
  'onboarding.feature.open.title': 'Open source foundation',
  'onboarding.feature.open.text': 'OpenPath provides an auditable core for digital policy.',
  'onboarding.feature.flows.title': 'Traceable flows',
  'onboarding.feature.flows.text': 'Invitations, approvals, and changes follow a clear process.',
  'onboarding.feature.eu.title': 'Official EU production',
  'onboarding.feature.eu.text': 'ClassroomPath is hosted on EU servers.',
  'onboarding.gate.pendingTitle': 'You have a pending invitation',
  'onboarding.gate.pendingBody':
    'You already belong to another organization. If you accept this invitation, ClassroomPath will move you to the new organization.',
  'onboarding.gate.changeOrg': 'Change organization',
  'onboarding.gate.keepOrg': 'Stay with my current organization',
  'onboarding.gate.slowTitle': 'This is taking too long',
  'onboarding.gate.slowBody': 'We could not verify your status in time. Retry or go back to login.',
  'onboarding.gate.accessFailedTitle': 'Could not verify your access',
  'onboarding.gate.accessFailedBody':
    'Try again in a few seconds. If the problem persists, go back to login.',
  'onboarding.gate.verifying': 'Verifying status...',
  // --- Section: waiting (pending invitation waiting screen) ---
  'waiting.title': 'Waiting for invitation',
  'waiting.body':
    'An administrator from your institution must add you to the organization. We will redirect you automatically when this happens.',
  'waiting.traceability':
    'Your request follows a traceable institutional flow on an open-source base hosted on EU servers.',
  'waiting.privacy':
    'For privacy, this portal will not show the organization directory while your request remains pending.',
  'waiting.checking': 'Checking...',
  'waiting.checkNow': 'Check now',
  'waiting.cancel': 'Change my mind',
  'waiting.autoRefresh': 'This page updates automatically every 30 seconds.',
  // --- Section: billing (billing events, banners, and success/cancel flows) ---
  'billing.cancel.title': 'Checkout canceled',
  'billing.cancel.body':
    'No school was activated. You can return to onboarding and resume the process whenever you want.',
  'billing.cancel.back': 'Back to onboarding',
  'billing.success.initial': 'Confirming school activation...',
  'billing.success.waiting': 'Waiting for billing confirmation...',
  'billing.success.manual': 'School activation is under manual review.',
  'billing.success.missing': 'Activation still does not appear. Retry in a few seconds.',
  'billing.success.refreshFailed': 'Could not refresh the session',
  'billing.success.title': 'Activating the school',
  'billing.banner.grace':
    'The school remains temporarily active while we resolve payment. Deadline:',
  'billing.banner.cancel': 'The subscription is marked to end at the close of the current period:',
  'billing.banner.pilot': 'The pilot ends on {date}. Close renewal before that date.',
  // --- Section: platform (platform admin: entitlements, manual requests, audit) ---
  'platform.title': 'Platform administration',
  'platform.subtitle':
    'Review commercial exceptions, monitor school status, and preserve traceability.',
  'platform.noteRequired': 'Every manual resolution requires a note.',
  'platform.manualRequests': 'Manual requests',
  'platform.loadingRequests': 'Loading requests...',
  'platform.noRequests': 'No requests registered.',
  'platform.classrooms': '{count} classrooms',
  'platform.resolution': 'Resolution:',
  'platform.notePlaceholder': 'Required note for support and audit',
  'platform.approveException': 'Approve exception',
  'platform.pendingNow': 'Pending now: {count}. Every action requires a resolution note.',
  'platform.entitlements': 'Active and recent entitlements',
  'platform.loadingSchools': 'Loading schools...',
  'platform.noEntitlements': 'No entitlements registered yet.',
  'platform.source': 'Source:',
  'platform.periodEnd': 'Period end:',
  'platform.graceEnd': 'Grace end:',
  'platform.expires': 'Expires:',
  'platform.updated': 'Last update:',
  'platform.billingTimeline': 'Billing timeline',
  'platform.loadingActivity': 'Loading activity...',
  'platform.noBillingEvents': 'No billing events yet.',
  'platform.billingKind.public_campaign': 'Public campaign',
  'platform.billingKind.custom_quote': 'Custom quote',
  'platform.billingKind.annual': 'Annual',
  'platform.billingKind.pilot': 'Pilot',
  'platform.billingStatus.pending': 'Pending',
  'platform.billingStatus.approved': 'Approved',
  'platform.billingStatus.rejected': 'Rejected',
  'platform.billingStatus.active': 'Active',
  'platform.billingStatus.grace_period': 'Grace period',
  'platform.billingStatus.canceled': 'Canceled',
  'platform.billingStatus.expired': 'Expired',
  'platform.billingSource.manual': 'Manual',
  'platform.billingSource.stripe': 'Stripe',
  'platform.billingSource.pilot': 'Pilot',
  'platform.auditActor.platform_admin': 'Platform administrator',
  'platform.auditActor.system': 'System',
  'platform.auditActor.user': 'User',
  'platform.auditTarget.manual_request': 'Manual request',
  'platform.auditTarget.entitlement': 'Entitlement',
  'platform.auditTarget.organization': 'Organization',
  'platform.auditAction.manual-request.approved': 'Manual request approved',
  'platform.auditAction.manual-request.rejected': 'Manual request rejected',
  'platform.auditAction.entitlement.updated': 'Entitlement updated',
  // --- Section: admin (organization admin banners and access requests) ---
  'admin.pendingUsersBanner': '{count} users waiting for approval',
  'admin.pendingUsersBanner.one': '{count} user waiting for approval',
  'admin.pendingUsersBanner.many': '{count} users waiting for approval',
  'admin.review': 'Review',
  'admin.accessRequests': 'Access Requests',
  'admin.pendingUsersSummary': '{count} pending users',
  'admin.pendingUsersSummary.one': '{count} pending user',
  'admin.pendingUsersSummary.many': '{count} pending users',
  'admin.closePanel': 'Close panel',
  // --- Section: pendingUsers (pending user access request list) ---
  'pendingUsers.loading': 'Loading pending requests...',
  'pendingUsers.loadError': 'Could not load requests',
  'pendingUsers.title': 'Access Requests',
  'pendingUsers.subtitle': 'Users waiting for approval to join your organization.',
  'pendingUsers.emptyTitle': 'No pending requests',
  'pendingUsers.emptyBody':
    'When a user requests to join your organization, they will appear here.',
  'pendingUsers.user': 'User',
  'pendingUsers.requested': 'Requested',
  'pendingUsers.roleToAssign': 'Role to assign',
  'pendingUsers.actions': 'Actions',
  'pendingUsers.unknownDate': 'Unknown date',
  'pendingUsers.summary': '{count} pending requests',
  'pendingUsers.summary.one': '{count} pending request',
  'pendingUsers.summary.many': '{count} pending requests',
  'pendingUsers.rejectConfirm': 'Are you sure you want to reject this request?',
  // --- Section: orgUsers (organization user management table and invite flow) ---
  'orgUsers.title': 'User Management',
  'orgUsers.subtitle':
    'Invite new members, revoke access, and generate recoveries without asking for passwords.',
  'orgUsers.inviteUser': 'Invite user',
  'orgUsers.searchPlaceholder': 'Search by name or email',
  'orgUsers.revokeInvitation': 'Revoke invitation',
  'orgUsers.revokeAccess': 'Revoke access',
  'orgUsers.revokeInvitationBody': 'The pending invitation for {email} will be deleted.',
  'orgUsers.revokeAccessBody': 'Access for {email} to this organization will be removed.',
  'orgUsers.generateRecovery': 'Generate recovery',
  'orgUsers.generateLink': 'Generate link',
  'orgUsers.generateRecoveryBody': 'A recovery link will be generated for {email}.',
  'orgUsers.statusPending': 'Pending',
  'orgUsers.showingNone': 'Showing 0-0 of 0 users',
  'orgUsers.showing': 'Showing 1-{count} of {count} users',
  'orgUsers.invitationSent': 'Invitation sent',
  'orgUsers.invitationSentBody': 'The invitation was sent to {email}.',
  'orgUsers.invitationPending': 'Invitation pending delivery',
  'orgUsers.invitationPendingBody':
    'Could not confirm delivery to {email}. Retry the invitation from this screen.',
  'orgUsers.resetSent': 'Recovery link sent',
  'orgUsers.resetSentBody': 'A recovery email was sent to {email}.',
  'orgUsers.resetPending': 'Recovery pending delivery',
  'orgUsers.resetPendingBody':
    'Could not confirm delivery to {email}. Generate a new recovery email to retry.',
  'orgUsers.loadError': 'Could not load users',
  'orgUsers.inviteFailed': 'Could not create the invitation',
  'orgUsers.revokeFailed': 'Could not revoke the selected access',
  'orgUsers.resetFailed': 'Could not generate the recovery link',
  'orgUsers.table.user': 'User',
  'orgUsers.table.email': 'Email',
  'orgUsers.table.status': 'Status',
  'orgUsers.table.loading': 'Loading users...',
  'orgUsers.table.empty': 'No users or invitations to show.',
  'orgUsers.table.invitationValidUntil': 'Invitation valid until',
  'orgUsers.table.resetAccess': 'Reset access',
  'orgUsers.invite.fullNamePlaceholder': 'Full name',
  'orgUsers.invite.emailPlaceholder': 'user@example.com',
  'orgUsers.invite.passwordNote':
    'The password is not set here. The user will create it when accepting the invitation.',
  'orgUsers.invite.send': 'Send invitation',
  // --- Section: pwa (push notification and PWA install prompts) ---
  'pwa.permissionDenied': 'Notification permission denied',
  'pwa.notConfigured': 'Notifications are not configured',
  'pwa.enabled': 'Notifications active',
  'pwa.enableFailed': 'Could not enable notifications',
  'pwa.enabling': 'Enabling...',
  'pwa.enable': 'Enable notifications',
  'pwa.iosTitle': 'Install ClassroomPath on this iPhone',
  'pwa.iosBody':
    'In Safari, open Share and tap Add to Home Screen. Then open ClassroomPath from the icon and enable notifications.',
  'pwa.requestAlerts': 'Request alerts',
  // --- Section: public.nav + public.faq + public.contact (public marketing pages shared navigation) ---
  'public.landing.title': 'Classroom web filtering | ClassroomPath',
  'public.landing.description':
    'Control what opens and what gets blocked in each classroom. Managed service on OpenPath, classroom-based pricing, and remote activation with the school IT team.',
  'public.nav.tagline': 'Classroom web filtering by classroom',
  'public.nav.pricing': 'Pricing',
  'public.nav.home': 'Home',
  'public.nav.access': 'Sign in',
  'public.nav.calculatePrice': 'Calculate price',
  'public.nav.requestActivation': 'Request activation',
  'public.nav.footerManaged': 'Managed service on',
  'public.nav.legalNotice': 'Legal notice',
  'public.nav.privacyPolicy': 'Privacy policy',
  'public.faq.label': 'FAQ',
  'public.faq.landingTitle': 'What schools usually ask',
  'public.faq.pricingTitle': 'Direct answers for institutional evaluation',
  'public.contact.requestLabel': 'Request a quote, activation, or demo',
  'public.contact.loginPrompt': 'Already have an account?',
  // --- Section: landing (public landing / home page content) ---
  'landing.hero.badge': 'Classroom web filtering by classroom · managed service on OpenPath',
  'landing.hero.title':
    'Decide what Internet reaches each classroom, without adding more work for the IT team.',
  'landing.hero.body':
    'ClassroomPath turns the school digital policy into real operating rules: what opens, what is blocked, and how it is managed, classroom by classroom. Public pricing, lightweight remote activation, and no vendor lock-in.',
  'landing.hero.proof':
    'Up to 30 devices per classroom · remote support for school IT · auditable open source',
  'landing.hero.cardLabel': 'Managed service on OpenPath',
  'landing.hero.card1':
    'ClassroomPath is not a generic teaching suite. It organizes classroom web access so the school can apply a clear digital policy.',
  'landing.hero.card2':
    'The focus is deciding what opens, what is blocked, and how that decision is sustained without more daily load for the IT team.',
  'landing.hero.card3':
    'If you need a quote, you go by classroom pricing. If you want to start small, request remote activation.',
  'landing.positioning.title': 'We do not sell more screen time.',
  'landing.positioning.body':
    'We help make Internet available when it adds educational value, under a clear and sustainable school criterion.',
  'landing.flow.label': 'Operations',
  'landing.flow.title': 'How it works in practice',
  'landing.flow.body':
    'The improvement is not only blocking. It is turning the school digital policy into a clear operation: what is allowed, who decides it, and how it is sustained without constant improvisation.',
  'landing.roles.label': 'Profiles',
  'landing.roles.title': 'What each profile gains',
  'landing.fit.label': 'Fit',
  'landing.fit.title': 'ClassroomPath fits if your school needs...',
  'landing.fit.body':
    'It is designed for schools that have already decided they need a clear access policy and simpler operations.',
  'landing.campaign.badge': 'Active campaign · limited places',
  'landing.campaign.title': 'Initial access for public schools',
  'landing.campaign.body':
    'If your school is publicly owned, you can access ClassroomPath at no cost for up to 5 classrooms while places are available.',
  'landing.campaign.detail1':
    'Includes a remote session with school IT, startup checklist, and standard email support.',
  'landing.campaign.detail2': 'No later commitment.',
  'landing.campaign.detail3': 'Places subject to availability and public-ownership verification.',
  'landing.campaign.cta': 'Check availability',
  'landing.request.title': 'Coordinate the next step with your IT team',
  'landing.request.body':
    'Tell us how many classrooms you want to control, who leads the technical side, and whether you need a quote, activation, or demo. We respond within 48 h.',
  'landing.benefit.price.title': 'Classroom pricing, not loose licenses',
  'landing.benefit.price.text':
    'The school budgets and scales with a unit it understands: the classroom.',
  'landing.benefit.activation.title': 'Remote activation with school IT',
  'landing.benefit.activation.text':
    'We support the technical owner so startup is on track without becoming another parallel project.',
  'landing.benefit.open.title': 'Open software, managed service',
  'landing.benefit.open.text':
    'You operate with support and guidance, without giving up code auditability or the option to migrate someday.',
  'landing.step.one': 'Step 1',
  'landing.step.two': 'Step 2',
  'landing.step.three': 'Step 3',
  'landing.step.criteria.title': 'The school defines the criterion',
  'landing.step.criteria.text':
    'The school digital policy is translated into clear rules by classroom, stage, or teaching need.',
  'landing.step.activation.title': 'Initial activation is prepared with school IT',
  'landing.step.activation.text':
    'ClassroomPath remotely supports the technical owner to validate network, devices, and the first classrooms startup.',
  'landing.step.friction.title': 'Access is managed with less friction',
  'landing.step.friction.text':
    'Teachers work with useful resources, the IT team keeps classroom-level control, and the policy no longer lives only in a document.',
  'landing.role.leadership.title': 'Leadership',
  'landing.role.leadership.text':
    'An explainable digital policy, coherent with the educational project and actually applicable.',
  'landing.role.teachers.title': 'Teachers',
  'landing.role.teachers.text':
    'Less classroom noise and a clear flow to request openings when a resource has educational value.',
  'landing.role.it.title': 'IT team',
  'landing.role.it.text':
    'Classroom access control without deploying another infrastructure or turning maintenance into another daily load.',
  'landing.fitSignal.filter.title': 'Classroom web filtering',
  'landing.fitSignal.filter.text':
    'Decide which resources are allowed and which are not by stage, classroom, or teaching use.',
  'landing.fitSignal.devices.title': 'Control for school devices',
  'landing.fitSignal.devices.text':
    'Apply a clear policy on laptops, carts, shared classrooms, labs, or vocational training.',
  'landing.fitSignal.deployment.title': 'Deployment with your IT team',
  'landing.fitSignal.deployment.text':
    'Start with bounded remote support without depending on heavy provider-led implementation.',
  'landing.fitSignal.open.title': 'Transparency and autonomy',
  'landing.fitSignal.open.text':
    'Operate on open source and keep a real exit path if the school wants to migrate to OpenPath.',
  'public.pricing.title': 'Classroom web filtering pricing | ClassroomPath',
  'public.pricing.description':
    'Calculate the cost of ClassroomPath by classroom count. Public pricing, separate onboarding, lightweight remote activation, and managed service on OpenPath.',
  // --- Section: pricing (public pricing page content) ---
  'pricing.hero.badge': 'Public classroom pricing · no surprises',
  'pricing.hero.title': 'Calculate the first year in seconds and decide the next step.',
  'pricing.hero.body':
    'First year = annual classroom fee + one-time onboarding. From the second year, you keep only the annual classroom fee. If you want to start small, use lightweight remote activation and validate the fit with your IT team before expanding.',
  'pricing.hero.proof':
    'Up to 30 devices per classroom · remote support for school IT · managed service on OpenPath',
  'pricing.hero.demo': 'Request demo',
  'pricing.hero.recommended': 'Most common tier',
  'pricing.hero.mediumSchool': 'Medium school',
  'pricing.hero.perClassroomYear': 'per classroom / year',
  'pricing.hero.remoteActivation': 'Remote activation',
  'pricing.hero.activationLimit': 'Up to {classrooms} classrooms with remote IT support',
  'pricing.hero.onboarding': 'Onboarding',
  'pricing.hero.onboardingPrice': 'Separate · from €490',
  'pricing.hero.onboardingBody':
    'The essentials to control access by classroom, without modules you will not use.',
  'pricing.next.title': 'What step suits you now',
  'pricing.next.body':
    'Each school arrives with a different need. Choose the path that best fits now.',
  'pricing.next.calculate.title': 'Calculate a quote',
  'pricing.next.calculate.text':
    'If you need a quick budget figure, use the calculator and get a first-year estimate.',
  'pricing.next.calculate.cta': 'Go to calculator',
  'pricing.next.activation.title': 'Request remote activation',
  'pricing.next.activation.text':
    'If you want to start small, we align startup with school IT and leave 1-2 classrooms operational.',
  'pricing.next.activation.cta': 'See activation',
  'pricing.next.demo.title': 'Request demo',
  'pricing.next.demo.text':
    'If you are already comparing options, we review policy, scope, and deployment with you.',
  'pricing.next.demo.cta': 'Request demo',
  'pricing.included.label': 'What each classroom includes',
  'pricing.included.title':
    'A managed service to organize Internet access without adding more load to the IT team',
  'pricing.campaign.label': 'Active campaign',
  'pricing.campaign.title': 'Initial access for public schools',
  'pricing.campaign.body': 'Up to {classrooms} classrooms at no cost. Limited places.',
  'pricing.activation.title': 'Activate 1-2 classrooms with your IT team for €149',
  'pricing.activation.body':
    'Includes a technical checklist, one remote session with school IT, and support to leave 1-2 classrooms operational without assuming a full implementation.',
  'pricing.tiers.label': 'Pricing tiers',
  'pricing.tiers.title': 'One classroom price. More classrooms, lower cost per classroom.',
  'pricing.tiers.body':
    'ClassroomPath charges by controlled classroom, not loose licenses. That helps the school understand the cost quickly, identify the common tier, and know when it needs a more specific commercial validation.',
  'pricing.tiers.recommended': 'Most common',
  'pricing.tiers.footer': 'All tiers require initial onboarding. VAT not included.',
  'pricing.onboarding.title': 'Separate onboarding so renewal stays clear',
  'pricing.onboarding.body':
    'We separate startup from the recurring fee so the school can compare annual classroom cost and see the initial effort separately.',
  'pricing.onboarding.covers': 'What onboarding covers',
  'pricing.onboarding.item.criteria': 'Startup session and criterion definition',
  'pricing.onboarding.item.configuration': 'Initial setup and validation with school IT',
  'pricing.onboarding.item.review': 'Startup review and next steps',
  'pricing.value.label': 'Why this model is easier to understand',
  'pricing.calculator.label': 'Calculator',
  'pricing.calculator.title': 'Estimate the first-year cost in 10 seconds',
  'pricing.calculator.body':
    'Enter the number of classrooms and you will see: applied tier, annual fee, onboarding, and first-year total before asking for a detailed proposal.',
  'pricing.calculator.classrooms': 'Number of classrooms',
  'pricing.calculator.classroomHelp':
    'Controlled classroom = up to 30 devices under a defined access policy.',
  'pricing.calculator.estimate': 'First-year estimate',
  'pricing.calculator.appliedTier': 'Applied tier',
  'pricing.calculator.annualFee': 'Annual fee',
  'pricing.calculator.totalFirstYear': 'Total first year',
  'pricing.calculator.classroomLine': '{classrooms} classrooms x {price}',
  'pricing.calculator.example':
    'Example: 12 classrooms x {price} = {annualTotal} / year · Onboarding: {onboarding} · First-year total: {total}',
  'pricing.calculator.customOnboarding':
    'For deployments of 101 classrooms or more, onboarding is defined with a specific proposal by site, scope, and rollout pace.',
  'pricing.calculator.onboardingTier':
    'Onboarding for {classrooms} classrooms is in the {rangeLabel} tier.',
  'pricing.model.label': 'Why we charge by classroom',
  'pricing.model.title': 'A price closer to the school operating reality',
  'pricing.model.commercial': 'Commercial model',
  'pricing.notIncluded.label': 'Base plan transparency',
  'pricing.notIncluded.title': 'What is not included in the standard recurring fee',
  'pricing.notIncluded.body':
    'These capabilities are available, but quoted separately so the base plan is not more expensive for schools that do not need them.',
  'pricing.contact.title': 'Ask for a quote, activation, or deployment review',
  'pricing.contact.body':
    'We review the number of classrooms, the intended access policy, and whether remote activation, an annual proposal, or an implementation partner makes sense. We respond within 48 h.',
  'pricing.data.included.devices': 'Up to 30 devices per classroom',
  'pricing.data.included.policies': 'Internet access policies',
  'pricing.data.included.requests': 'Unblock request queue',
  'pricing.data.included.admin': 'Admin panel',
  'pricing.data.included.hosting': 'Hosting and operations included',
  'pricing.data.included.updates': 'Updates included',
  'pricing.data.included.support': 'Standard email support',
  'pricing.data.included.openpath': 'Managed service on OpenPath',
  'pricing.data.notIncluded.sso': 'Enterprise SSO',
  'pricing.data.notIncluded.sla': 'Premium SLA',
  'pricing.data.notIncluded.migration': 'Advanced migration',
  'pricing.data.notIncluded.training': 'Onsite training',
  'pricing.data.notIncluded.priority': 'Priority support',
  'pricing.data.notIncluded.customPolicies': 'Highly customized policies by site or stage',
  'pricing.data.value.public': 'Public pricing from the first click',
  'pricing.data.value.unit': 'Clear purchasing unit: the classroom',
  'pricing.data.value.activation': 'Remote activation to start with limited scope',
  'pricing.data.value.open': 'Managed service on open software',
  'pricing.data.value.noLockIn': 'No mandatory vendor dependency',
  'pricing.data.points.operation':
    'The school organizes operations by spaces and teaching groups, not by an abstract sum of licenses.',
  'pricing.data.points.budget': 'Easier to explain in a budget',
  'pricing.data.points.scale': 'Easier to scale by real spaces',
  'pricing.data.points.renewal': 'Clearer when separating startup and renewal',
  'pricing.data.points.service': 'More coherent with a managed service',
  'pricing.tier.small.name': 'Small school',
  'pricing.tier.small.range': '1-10 classrooms',
  'pricing.tier.small.tagline':
    'For first deployments or one teaching space with school-owned devices.',
  'pricing.tier.small.bestFor': 'First deployment or one teaching space with school-owned devices.',
  'pricing.tier.medium.name': 'Medium school',
  'pricing.tier.medium.range': '11-25 classrooms',
  'pricing.tier.medium.tagline':
    'The most common tier for schools that already want a stable classroom policy.',
  'pricing.tier.medium.bestFor':
    'The most common tier for schools that already want a stable classroom policy.',
  'pricing.tier.large.name': 'Large school',
  'pricing.tier.large.range': '26-50 classrooms',
  'pricing.tier.large.tagline': 'Designed for schools with several lines, labs, or staged growth.',
  'pricing.tier.large.bestFor': 'Schools with several lines, labs, or staged growth.',
  'pricing.tier.organization.name': 'Educational organization',
  'pricing.tier.organization.range': '51-100 classrooms',
  'pricing.tier.organization.tagline':
    'For structures with central IT coordination and several sites or stages.',
  'pricing.tier.organization.bestFor':
    'For structures with central IT coordination and several sites or stages.',
  'pricing.tier.network.name': 'School network',
  'pricing.tier.network.range': '101+ classrooms',
  'pricing.tier.network.tagline':
    'Optimized pricing for school networks and multi-site deployments.',
  'pricing.tier.network.bestFor':
    'Optimized pricing for multi-site deployments and education networks.',
  'pricing.onboarding.tier.small.range': 'Up to 25 classrooms',
  'pricing.onboarding.tier.medium.range': '26-100 classrooms',
  'pricing.onboarding.tier.large.range': '101+ classrooms',
  'pricing.onboarding.tier.contact': 'Contact us',
  // --- Section: contact (contact / quote request form) ---
  'contact.sent.title': 'Request sent',
  'contact.sent.body': 'We will respond within 48 h.',
  'contact.sent.again': 'Send another request',
  'contact.name.label': 'Name',
  'contact.name.placeholder': 'Your name',
  'contact.center.label': 'School',
  'contact.center.placeholder': 'School name',
  'contact.email.label': 'Contact email',
  'contact.email.placeholder': 'email@school.edu',
  'contact.classrooms.label': 'Classrooms (optional)',
  'contact.technicalOwner.label': 'Technical owner (optional)',
  'contact.technicalOwner.placeholder': 'IT owner name',
  'contact.partner.label': 'Do you need an implementation partner?',
  'contact.intent.label': 'What do you need?',
  'contact.intent.quote': 'Quote',
  'contact.intent.remoteActivation': 'Remote activation',
  'contact.intent.demo': 'Demo',
  'contact.yes': 'Yes',
  'contact.no': 'No',
  'contact.notSure': 'Not sure',
  'contact.sending': 'Sending...',
  'contact.submit': 'Send request',
  'contact.email.subject': 'ClassroomPath request',
  'contact.email.body':
    'Need: {intent}\nName: {name}\nSchool: {center}\nEmail: {email}\nClassrooms (approx.): {classrooms}\nTechnical owner: {technicalOwner}\nNeeds implementation partner?: {deploymentPartnerNeed}',
  'contact.notProvided': 'Not provided',
  // --- Section: faq (frequently asked questions: landing and pricing) ---
  'faq.landing.screenTime.q': 'Does ClassroomPath promote more screen use?',
  'faq.landing.screenTime.a':
    'No. ClassroomPath is designed for schools that want to use technology with more intent. It does not sell more digital exposure; it helps limit Internet access to contexts and resources that make educational sense.',
  'faq.landing.filter.q': 'Is it just another school filter?',
  'faq.landing.filter.a':
    'No. It is not only filtering. ClassroomPath adds management: who decides what opens, why, and with what operation it is sustained.',
  'faq.landing.openSource.q': 'Is it open source or proprietary?',
  'faq.landing.openSource.a':
    'OpenPath is the open engine and ClassroomPath is the managed service on top of it. The school can audit it and migrate if needed.',
  'faq.landing.fit.q': 'What schools is it best for?',
  'faq.landing.fit.a':
    'Especially schools with school-owned devices, computer rooms, vocational training, labs, or shared spaces where clear access control is needed.',
  'faq.landing.time.q': 'How long does implementation take?',
  'faq.landing.time.a':
    'With IT available, initial activation is usually handled in a remote session and leaves the next expansion step defined.',
  'faq.pricing.classroom.q': 'What counts as a classroom?',
  'faq.pricing.classroom.a': 'A set of up to 30 devices under a defined access policy.',
  'faq.pricing.activation.q': 'How does remote activation work?',
  'faq.pricing.activation.a':
    'Lightweight remote activation costs €149. It includes a technical checklist, a remote session with school IT, and support to leave 1-2 classrooms operational. Implementation is performed by the school or its partner.',
  'faq.pricing.onboarding.q': 'Is onboarding included in the recurring fee?',
  'faq.pricing.onboarding.a':
    'No. It is charged separately to keep the annual classroom cost clean and comparable.',
  'faq.pricing.unit.q': 'Why do you charge by classroom and not by device?',
  'faq.pricing.unit.a':
    'Because the school organizes operations by spaces and teaching groups, not by an abstract sum of licenses.',
  'faq.pricing.largeClassroom.q': 'What happens if a classroom has more than 30 devices?',
  'faq.pricing.largeClassroom.a':
    'We recommend counting it as two classrooms or moving to a custom tier.',
  'faq.pricing.support.q': 'Does it include support?',
  'faq.pricing.support.a': 'Yes, standard email support. Premium SLA separately.',
  'faq.pricing.public.q': 'Is there an option for public schools?',
  'faq.pricing.public.a':
    'Yes. There is no-cost access for up to 5 classrooms while availability lasts and public ownership is verified.',
  'faq.pricing.difference.q': 'How is ClassroomPath different from a proxy or standard DNS filter?',
  'faq.pricing.difference.a':
    'ClassroomPath adds management: policy aligned with the educational project, an unblock request queue, and a managed operations layer on OpenPath.',
};

type ClassroomPathI18nKey = keyof typeof classroomPathI18nEn;

const classroomPathI18nEs: Record<ClassroomPathI18nKey, string> = {
  'cp.offlineInstaller.action': 'Descargar instalador Windows',
  'cp.offlineInstaller.generating': 'Generando instalador…',
  'cp.offlineInstaller.error': 'No se pudo generar el instalador.',
  'cp.offlineInstaller.metadata': 'v{version} · SHA-256 {sha256}… · el token expira {expiresAt}',
  // --- Section (es): app.loader + app.common (application chrome, loader, and universal UI labels) ---
  'app.loader.preparing': 'Preparando ClassroomPath...',
  'app.loader.panel': 'Cargando tu panel...',
  'app.common.pending': 'pendiente',
  'app.common.cancel': 'Cancelar',
  'app.common.close': 'Cerrar',
  'app.common.backToHome': 'Volver al inicio',
  'app.common.backToLogin': 'Volver al inicio de sesión',
  'app.common.login': 'Inicia sesión',
  'app.common.openDashboard': 'Acceder al panel',
  'app.common.error': 'Error:',
  'app.common.retry': 'Reintentar',
  'app.common.processing': 'Procesando...',
  'app.common.loading': 'Cargando...',
  'app.common.logout': 'Cerrar sesión',
  'app.common.email': 'Email',
  'app.common.name': 'Nombre',
  'app.common.password': 'Contraseña',
  'app.common.confirmPassword': 'Confirmar contraseña',
  'app.common.role': 'Rol',
  'app.common.teacher': 'Profesor',
  'app.common.admin': 'Administrador',
  'app.common.user': 'Usuario',
  'app.common.active': 'Activo',
  'app.common.inactive': 'Inactivo',
  'app.common.approve': 'Aprobar',
  'app.common.reject': 'Rechazar',
  // --- Section (es): groupLibrary (policy library UI) ---
  'groupLibrary.openAriaLabel': 'Abrir biblioteca de políticas',
  'groupLibrary.openSrLabel': 'Biblioteca',
  'groupLibrary.openButtonLabel': 'Importar de la biblioteca',
  'groupLibrary.title': 'Biblioteca de políticas',
  'groupLibrary.description': 'Consulta y clona políticas compartidas en tu organización.',
  'groupLibrary.searchPlaceholder': 'Buscar por nombre...',
  'groupLibrary.libraryTab': 'Biblioteca',
  'groupLibrary.templatesTab': 'Plantillas',
  'groupLibrary.manageTab': 'Gestionar',
  'groupLibrary.manageVisibilityPrefix': 'Marca una política como',
  'groupLibrary.manageVisibilitySuffix': 'para que aparezca en la biblioteca de la organización.',
  'groupLibrary.visibility.private': 'Privada',
  'groupLibrary.visibility.public': 'Pública',
  'groupLibrary.visibility.instancePublic': 'Pública (org)',
  'groupLibrary.publishTemplate': 'Publicar plantilla',
  'groupLibrary.noPublishedTemplates': 'No hay plantillas publicadas.',
  'groupLibrary.emptyOrg': 'No hay políticas para mostrar.',
  'groupLibrary.emptyLibrary': 'No hay políticas públicas en esta organización.',
  'groupLibrary.templatesDescription':
    'Plantillas disponibles para todas las organizaciones. Se copian al importarlas.',
  'groupLibrary.domains': 'Dominios',
  'groupLibrary.rules': 'Reglas',
  'groupLibrary.previewAction': 'Vista previa',
  'groupLibrary.clone': 'Clonar',
  'groupLibrary.import': 'Importar',
  'groupLibrary.previous': 'Anterior',
  'groupLibrary.next': 'Siguiente',
  'groupLibrary.preview.groupTitle': 'Vista previa (solo lectura)',
  'groupLibrary.preview.groupSubtitle': 'Puedes clonar para editar.',
  'groupLibrary.preview.templateTitle': 'Vista previa de plantilla',
  'groupLibrary.preview.templateSubtitle': 'Puedes importar para editar.',
  'groupLibrary.preview.empty': 'No hay reglas para mostrar.',
  'groupLibrary.preview.searchPlaceholder': 'Buscar dominio...',
  'groupLibrary.preview.loadingRules': 'Cargando reglas...',
  'groupLibrary.preview.total': 'Total: {total} (mostrando {count})',
  'groupLibrary.preview.type': 'Tipo',
  'groupLibrary.preview.domain': 'Dominio',
  'groupLibrary.ruleType.allow': 'Permitir',
  'groupLibrary.ruleType.deny': 'Bloquear',
  'groupLibrary.ruleType.blockPath': 'Bloquear ruta',
  // --- Section (es): app.title (page and section titles) ---
  'app.title.dashboard.admin': 'Vista General',
  'app.title.dashboard.user': 'Mi Panel',
  'app.title.classrooms.admin': 'Gestión de Aulas',
  'app.title.classrooms.user': 'Aulas',
  'app.title.groups.admin': 'Grupos y Políticas',
  'app.title.groups.user': 'Mis Políticas',
  'app.title.rules.default': 'Gestión de Reglas',
  'app.title.rules.group': 'Reglas: {groupName}',
  'app.title.users.admin': 'Administración de Usuarios',
  'app.title.domainRequests.admin': 'Solicitudes de Acceso',
  'app.title.settings': 'Configuración',
  // --- Section (es): domainApproval (domain unblock approval flow) ---
  'domainApproval.loading': 'Cargando solicitud...',
  'domainApproval.approved.title': 'Dominio aprobado',
  'domainApproval.approved.body': 'La solicitud ya se ha añadido a la whitelist.',
  'domainApproval.backToRequests': 'Volver a solicitudes',
  'domainApproval.unavailable.title': 'Solicitud no disponible',
  'domainApproval.unavailable.body':
    'La solicitud puede haber sido aprobada, rechazada o ya no estar asignada a tus grupos.',
  'domainApproval.pending.label': 'Solicitud pendiente',
  'domainApproval.pending.title': 'Aprobar dominio',
  'domainApproval.domain.label': 'Dominio',
  'domainApproval.group.label': 'Grupo',
  'domainApproval.approve.pending': 'Aprobando...',
  'domainApproval.approve.action': 'Aprobar dominio',
  // --- Section (es): validation (form validation messages) ---
  'validation.invalidEmail': 'Correo electrónico inválido',
  'validation.weakPassword':
    'La contraseña debe tener al menos 8 caracteres, incluyendo mayúsculas, minúsculas y números',
  'validation.passwordMismatch': 'Las contraseñas no coinciden',
  'validation.termsRequired': 'Debes aceptar los términos de servicio',
  'validation.registrationFailed': 'No se pudo crear la cuenta. Inténtalo de nuevo.',
  'validation.loginFailed': 'No se pudo iniciar sesión. Verifica tus credenciales.',
  'validation.minLength': 'Al menos 8 caracteres',
  // --- Section (es): passwordStrength (password strength indicator) ---
  'passwordStrength.hasUpper': 'Una mayúscula',
  'passwordStrength.hasLower': 'Una minúscula',
  'passwordStrength.hasDigit': 'Un número',
  'passwordStrength.aria': 'Fortaleza de contraseña: {strength} de 4 requisitos cumplidos',
  // --- Section (es): google (Google OAuth button) ---
  'google.loading.aria': 'Cargando botón de Google...',
  'google.retry': 'Reintentar Google',
  // --- Section (es): auth (authentication flows: login, register, invitation, reset) ---
  'auth.email.label': 'Correo electrónico',
  'auth.email.placeholder': 'admin@institucion.edu',
  'auth.email.genericPlaceholder': 'usuario@dominio.com',
  'auth.email.schoolPlaceholder': 'email@centro.es',
  'auth.password.placeholder': 'Crea una contraseña segura',
  'auth.password.repeatPlaceholder': 'Repite tu contraseña',
  'auth.login.title': 'Acceso',
  'auth.login.submit': 'Entrar',
  'auth.login.resetPrompt': '¿Necesitas restablecer tu acceso?',
  'auth.login.divider': 'O también',
  'auth.login.noAccount': '¿No tienes cuenta?',
  'auth.login.register': 'Regístrate',
  'auth.login.registerAria': 'Ir a página de registro',
  'auth.login.verifyingEmail': 'Verificando tu correo...',
  'auth.login.emailVerified': 'Correo verificado. Ya puedes iniciar sesión.',
  'auth.login.verifyFailed': 'No se pudo verificar tu correo',
  'auth.login.enterEmailForVerification': 'Introduce tu correo para reenviar la verificación',
  'auth.login.verificationSent': 'Te enviamos un nuevo enlace de verificación.',
  'auth.login.verificationDeliveryUnconfirmed':
    'No pudimos confirmar la entrega del correo. Usa el enlace manual.',
  'auth.login.resendFailed': 'No se pudo reenviar la verificación',
  'auth.login.requiresVerification': 'Debes verificar tu correo antes de iniciar sesión.',
  'auth.login.invalidCredentials': 'Credenciales inválidas o error de conexión',
  'auth.login.googleFailed': 'Error al iniciar sesión con Google',
  'auth.login.manualVerificationLink': 'Enlace manual de verificación',
  'auth.login.resendVerification': 'Reenviar verificación',
  'auth.register.title': 'Crear cuenta',
  'auth.register.reviewEmail': 'Revisa tu correo',
  'auth.register.manualVerificationLink': 'Enlace manual de verificación',
  'auth.register.goToLogin': 'Ir a iniciar sesión',
  'auth.register.fullName.placeholder': 'Tu nombre completo',
  'auth.register.acceptTermsPrefix': 'Acepto los',
  'auth.register.termsLink': 'términos de servicio',
  'auth.register.creating': 'Creando cuenta...',
  'auth.register.submit': 'Registrarse',
  'auth.register.hasAccount': '¿Ya tienes cuenta?',
  'auth.register.login': 'Inicia sesión',
  'auth.register.googleFailed': 'No se pudo continuar con Google',
  'auth.invitation.hero': 'Activa tu acceso',
  'auth.invitation.invalidTitle': 'Invitación inválida',
  'auth.invitation.missingToken':
    'Falta el token de activación. Abre el enlace que recibiste por correo.',
  'auth.invitation.validating': 'Validando invitación...',
  'auth.invitation.expiredTitle': 'Invitación vencida o inválida',
  'auth.invitation.expiredBody': 'Pide a tu administrador que te envíe una nueva invitación.',
  'auth.invitation.acceptTitle': 'Acepta tu invitación',
  'auth.invitation.completeRegistration': 'Completa tu registro',
  'auth.invitation.activateFailed': 'No se pudo activar la invitación',
  'auth.invitation.acceptFailed': 'No se pudo aceptar la invitación',
  'auth.invitation.termsRequired': 'Debes aceptar los términos para activar tu acceso',
  'auth.invitation.existingAccount':
    'Ya tienes una cuenta. Inicia sesión para revisar y aceptar esta invitación.',
  'auth.invitation.transferWarning':
    'Aceptar esta invitación te cambiará de organización en ClassroomPath.',
  'auth.invitation.currentOrg': 'Organización actual: {organization}',
  'auth.invitation.noCurrentOrg': 'Sin organización actual',
  'auth.invitation.newOrg': 'Nueva organización: {organization}',
  'auth.invitation.accepting': 'Aceptando invitación...',
  'auth.invitation.acceptTransfer': 'Aceptar cambio de organización',
  'auth.invitation.accept': 'Aceptar invitación',
  'auth.invitation.loginToContinue': 'Inicia sesión para continuar',
  'auth.invitation.activating': 'Activando acceso...',
  'auth.invitation.activate': 'Activar acceso',
  'auth.reset.hero': 'Recupera tu acceso',
  'auth.reset.updatedTitle': 'Contraseña actualizada',
  'auth.reset.updatedBody': 'Ya puedes iniciar sesión con tu nueva contraseña.',
  'auth.reset.title': 'Restablecer contraseña',
  'auth.reset.token': 'Token de recuperación',
  'auth.reset.tokenPlaceholder': 'Pega aquí tu token',
  'auth.reset.newPassword': 'Nueva contraseña',
  'auth.reset.failed': 'No se pudo restablecer la contraseña',
  'auth.reset.updating': 'Actualizando...',
  'auth.reset.submit': 'Actualizar contraseña',
  // --- Section (es): onboarding (new school onboarding and billing setup) ---
  'onboarding.title': '¡Bienvenido a ClassroomPath!',
  'onboarding.subtitle': 'Elige cómo quieres comenzar a gestionar tus salas',
  'onboarding.orgNameRequired': 'Debes ingresar un nombre para la organización',
  'onboarding.classroomRequired': 'Debes indicar al menos un aula',
  'onboarding.checkoutFailed': 'No se pudo iniciar el checkout',
  'onboarding.manualNote': 'Solicitud de centro público desde onboarding',
  'onboarding.manualSuccess':
    'Solicitud enviada. Revisaremos la activación antes de habilitar el centro.',
  'onboarding.manualFailed': 'No se pudo enviar la solicitud',
  'onboarding.selectOrg': 'Selecciona una organización para solicitar acceso',
  'onboarding.waitFailed': 'Error al procesar solicitud',
  'onboarding.billing.contract': 'Contratar centro',
  'onboarding.billing.activate': 'Activar centro',
  'onboarding.billing.contractBody':
    'Activa el centro con checkout seguro antes de crear la organización. La cuota anual incluye Stripe Tax y el onboarding queda separado en la primera factura.',
  'onboarding.billing.publicBody':
    'Los centros públicos pueden solicitar activación sin pago online. Revisaremos la solicitud antes de habilitar la organización.',
  'onboarding.billing.orgName': 'Nombre de la organización',
  'onboarding.billing.orgPlaceholder': 'Ej: Colegio San José',
  'onboarding.billing.classrooms': 'Número de aulas',
  'onboarding.billing.preparing': 'Preparando...',
  'onboarding.billing.annual': 'Contratar cuota anual',
  'onboarding.billing.pilot': 'Empezar piloto',
  'onboarding.billing.publicCenter': 'Soy un centro público',
  'onboarding.invitation.waitTitle': 'Esperar invitación',
  'onboarding.invitation.body':
    'Si tu institución ya utiliza ClassroomPath, puedes solicitar acceso y esperar a que un administrador te agregue. Tu solicitud seguirá un flujo institucional trazable.',
  'onboarding.invitation.organization': 'Organización',
  'onboarding.invitation.selectOrg': 'Seleccionar organización...',
  'onboarding.invitation.loadFailed': 'No se pudieron cargar organizaciones.',
  'onboarding.invitation.policyNotice':
    'Un administrador de tu institución debe autorizar tu acceso. No mostraremos el directorio ni los nombres de otras organizaciones desde este portal.',
  'onboarding.invitation.requestAccess': 'Solicitar acceso',
  'onboarding.feature.open.title': 'Open source en la base',
  'onboarding.feature.open.text': 'OpenPath aporta un core auditable para la política digital.',
  'onboarding.feature.flows.title': 'Flujos trazables',
  'onboarding.feature.flows.text': 'Invitaciones, aprobaciones y cambios siguen un proceso claro.',
  'onboarding.feature.eu.title': 'Producción oficial en la UE',
  'onboarding.feature.eu.text': 'ClassroomPath está alojado en servidores de la UE.',
  'onboarding.gate.pendingTitle': 'Tienes una invitación pendiente',
  'onboarding.gate.pendingBody':
    'Ya formas parte de otra organización. Si aceptas esta invitación, ClassroomPath te moverá a la nueva organización.',
  'onboarding.gate.changeOrg': 'Cambiar de organización',
  'onboarding.gate.keepOrg': 'Seguir con mi organización actual',
  'onboarding.gate.slowTitle': 'Esto está tardando demasiado',
  'onboarding.gate.slowBody':
    'No se pudo verificar tu estado a tiempo. Reintenta o vuelve a iniciar sesión.',
  'onboarding.gate.accessFailedTitle': 'No se pudo verificar tu acceso',
  'onboarding.gate.accessFailedBody':
    // --- Section (es): waiting (pending invitation waiting screen) ---
    'Reintenta en unos segundos. Si el problema persiste, vuelve a iniciar sesión.',
  'onboarding.gate.verifying': 'Verificando estado...',
  'waiting.title': 'Esperando invitación',
  'waiting.body':
    'Un administrador de tu institución debe agregarte a la organización. Te redirigiremos automáticamente cuando esto suceda.',
  'waiting.traceability':
    'Tu solicitud sigue un flujo institucional trazable sobre una base open source con alojamiento en servidores de la UE.',
  'waiting.privacy':
    'Por privacidad, este portal no mostrará el directorio de organizaciones mientras tu solicitud siga pendiente.',
  'waiting.checking': 'Verificando...',
  'waiting.checkNow': 'Verificar ahora',
  // --- Section (es): billing (billing events, banners, and success/cancel flows) ---
  'waiting.cancel': 'Cambiar de opinión',
  'waiting.autoRefresh': 'Esta página se actualiza automáticamente cada 30 segundos.',
  'billing.cancel.title': 'Checkout cancelado',
  'billing.cancel.body':
    'No se activó ningún centro. Puedes volver al onboarding y retomar el proceso cuando quieras.',
  'billing.cancel.back': 'Volver al onboarding',
  'billing.success.initial': 'Confirmando el alta del centro...',
  'billing.success.waiting': 'Esperando la confirmación de billing...',
  'billing.success.manual': 'La activación del centro está en revisión manual.',
  'billing.success.missing': 'La activación todavía no aparece. Reintenta en unos segundos.',
  'billing.success.refreshFailed': 'No se pudo refrescar la sesión',
  'billing.success.title': 'Activando el centro',
  'billing.banner.grace':
    'El centro sigue activo temporalmente mientras resolvemos el cobro. Fecha límite:',
  // --- Section (es): platform (platform admin: entitlements, manual requests, audit) ---
  'billing.banner.cancel':
    'La suscripción está marcada para finalizar al cierre del periodo actual:',
  'billing.banner.pilot':
    'El piloto termina el {date}. Conviene cerrar la renovación antes de esa fecha.',
  'platform.title': 'Administración de plataforma',
  'platform.subtitle':
    'Revisa excepciones comerciales, vigila el estado de los centros y conserva la trazabilidad.',
  'platform.noteRequired': 'Cada resolución manual requiere una nota.',
  'platform.manualRequests': 'Solicitudes manuales',
  'platform.loadingRequests': 'Cargando solicitudes...',
  'platform.noRequests': 'No hay solicitudes registradas.',
  'platform.classrooms': '{count} aulas',
  'platform.resolution': 'Resolución:',
  'platform.notePlaceholder': 'Nota obligatoria para soporte y auditoría',
  'platform.approveException': 'Aprobar excepción',
  'platform.pendingNow': 'Pendientes ahora: {count}. Cada acción exige nota de resolución.',
  'platform.entitlements': 'Derechos activos y recientes',
  'platform.loadingSchools': 'Cargando centros...',
  'platform.noEntitlements': 'Aún no hay derechos registrados.',
  'platform.source': 'Fuente:',
  'platform.periodEnd': 'Fin de periodo:',
  'platform.graceEnd': 'Fin de gracia:',
  'platform.expires': 'Expira:',
  'platform.updated': 'Última actualización:',
  'platform.billingTimeline': 'Timeline de billing',
  'platform.loadingActivity': 'Cargando actividad...',
  'platform.noBillingEvents': 'Todavía no hay eventos de billing.',
  'platform.billingKind.public_campaign': 'Campaña pública',
  'platform.billingKind.custom_quote': 'Presupuesto personalizado',
  'platform.billingKind.annual': 'Anual',
  'platform.billingKind.pilot': 'Piloto',
  'platform.billingStatus.pending': 'Pendiente',
  'platform.billingStatus.approved': 'Aprobada',
  'platform.billingStatus.rejected': 'Rechazada',
  'platform.billingStatus.active': 'Activa',
  'platform.billingStatus.grace_period': 'Periodo de gracia',
  'platform.billingStatus.canceled': 'Cancelada',
  'platform.billingStatus.expired': 'Expirada',
  'platform.billingSource.manual': 'Manual',
  'platform.billingSource.stripe': 'Stripe',
  'platform.billingSource.pilot': 'Piloto',
  'platform.auditActor.platform_admin': 'Administrador de plataforma',
  'platform.auditActor.system': 'Sistema',
  'platform.auditActor.user': 'Usuario',
  'platform.auditTarget.manual_request': 'Solicitud manual',
  'platform.auditTarget.entitlement': 'Derecho',
  // --- Section (es): admin (organization admin banners and access requests) ---
  'platform.auditTarget.organization': 'Organización',
  'platform.auditAction.manual-request.approved': 'Solicitud manual aprobada',
  'platform.auditAction.manual-request.rejected': 'Solicitud manual rechazada',
  'platform.auditAction.entitlement.updated': 'Derecho actualizado',
  'admin.pendingUsersBanner': '{count} usuarios esperando aprobación',
  'admin.pendingUsersBanner.one': '{count} usuario esperando aprobación',
  'admin.pendingUsersBanner.many': '{count} usuarios esperando aprobación',
  'admin.review': 'Revisar',
  'admin.accessRequests': 'Solicitudes de acceso',
  // --- Section (es): pendingUsers (pending user access request list) ---
  'admin.pendingUsersSummary': '{count} usuarios pendientes',
  'admin.pendingUsersSummary.one': '{count} usuario pendiente',
  'admin.pendingUsersSummary.many': '{count} usuarios pendientes',
  'admin.closePanel': 'Cerrar panel',
  'pendingUsers.loading': 'Cargando solicitudes pendientes...',
  'pendingUsers.loadError': 'Error al cargar solicitudes',
  'pendingUsers.title': 'Solicitudes de acceso',
  'pendingUsers.subtitle': 'Usuarios esperando aprobación para unirse a tu organización.',
  'pendingUsers.emptyTitle': 'No hay solicitudes pendientes',
  'pendingUsers.emptyBody': 'Cuando un usuario solicite unirse a tu organización, aparecerá aquí.',
  'pendingUsers.user': 'Usuario',
  'pendingUsers.requested': 'Solicitado',
  'pendingUsers.roleToAssign': 'Rol a asignar',
  'pendingUsers.actions': 'Acciones',
  'pendingUsers.unknownDate': 'Fecha desconocida',
  'pendingUsers.summary': '{count} solicitudes pendientes',
  // --- Section (es): orgUsers (organization user management table and invite flow) ---
  'pendingUsers.summary.one': '{count} solicitud pendiente',
  'pendingUsers.summary.many': '{count} solicitudes pendientes',
  'pendingUsers.rejectConfirm': '¿Estás seguro de que quieres rechazar esta solicitud?',
  'orgUsers.title': 'Gestión de usuarios',
  'orgUsers.subtitle':
    'Invita nuevos miembros, revoca accesos y genera recuperaciones sin pedir contraseñas.',
  'orgUsers.inviteUser': 'Invitar usuario',
  'orgUsers.searchPlaceholder': 'Buscar por nombre o correo',
  'orgUsers.revokeInvitation': 'Revocar invitación',
  'orgUsers.revokeAccess': 'Revocar acceso',
  'orgUsers.revokeInvitationBody': 'Se eliminará la invitación pendiente de {email}.',
  'orgUsers.revokeAccessBody': 'Se quitará el acceso de {email} a esta organización.',
  'orgUsers.generateRecovery': 'Generar recuperación',
  'orgUsers.generateLink': 'Generar enlace',
  'orgUsers.generateRecoveryBody': 'Se generará un enlace de recuperación para {email}.',
  'orgUsers.statusPending': 'Pendiente',
  'orgUsers.showingNone': 'Mostrando 0-0 de 0 usuarios',
  'orgUsers.showing': 'Mostrando 1-{count} de {count} usuarios',
  'orgUsers.invitationSent': 'Invitación enviada',
  'orgUsers.invitationSentBody': 'Se envió la invitación a {email}.',
  'orgUsers.invitationPending': 'Invitación pendiente de envío',
  'orgUsers.invitationPendingBody':
    'No se pudo confirmar el envío a {email}. Reintenta la invitación desde esta pantalla.',
  'orgUsers.resetSent': 'Enlace de recuperación enviado',
  'orgUsers.resetSentBody': 'Se envió un correo de recuperación a {email}.',
  'orgUsers.resetPending': 'Recuperación pendiente de envío',
  'orgUsers.resetPendingBody':
    'No se pudo confirmar el envío a {email}. Genera un nuevo correo de recuperación para reintentar.',
  'orgUsers.loadError': 'Error al cargar usuarios',
  'orgUsers.inviteFailed': 'No se pudo crear la invitación',
  'orgUsers.revokeFailed': 'No se pudo revocar el acceso seleccionado',
  'orgUsers.resetFailed': 'No se pudo generar el enlace de recuperación',
  'orgUsers.table.user': 'Usuario',
  'orgUsers.table.email': 'Correo',
  'orgUsers.table.status': 'Estado',
  'orgUsers.table.loading': 'Cargando usuarios...',
  'orgUsers.table.empty': 'No hay usuarios ni invitaciones para mostrar.',
  'orgUsers.table.invitationValidUntil': 'Invitación válida hasta',
  'orgUsers.table.resetAccess': 'Restablecer acceso',
  'orgUsers.invite.fullNamePlaceholder': 'Nombre completo',
  'orgUsers.invite.emailPlaceholder': 'usuario@dominio.com',
  // --- Section (es): pwa (push notification and PWA install prompts) ---
  'orgUsers.invite.passwordNote':
    'La contraseña no se define aquí. El usuario la creará al aceptar su invitación.',
  'orgUsers.invite.send': 'Enviar invitación',
  'pwa.permissionDenied': 'Permiso de notificación denegado',
  'pwa.notConfigured': 'Notificaciones no configuradas',
  'pwa.enabled': 'Notificaciones activas',
  'pwa.enableFailed': 'No se pudieron activar',
  'pwa.enabling': 'Activando...',
  'pwa.enable': 'Activar notificaciones',
  'pwa.iosTitle': 'Instala ClassroomPath en este iPhone',
  // --- Section (es): public.nav + public.faq + public.contact (public marketing pages shared navigation) ---
  'pwa.iosBody':
    'En Safari, abre compartir y pulsa Añadir a pantalla de inicio. Después abre ClassroomPath desde el icono y activa las notificaciones.',
  'pwa.requestAlerts': 'Avisos de solicitudes',
  'public.landing.title': 'Filtrado web escolar por aula | ClassroomPath',
  'public.landing.description':
    'Controla qué se abre y qué se bloquea en cada aula. Servicio gestionado sobre OpenPath, precio por aula y activación remota con el IT del centro.',
  'public.nav.tagline': 'Filtrado web escolar por aula',
  'public.nav.pricing': 'Precios',
  'public.nav.home': 'Inicio',
  'public.nav.access': 'Acceder',
  'public.nav.calculatePrice': 'Calcular precio',
  'public.nav.requestActivation': 'Solicitar activación',
  'public.nav.footerManaged': 'Servicio gestionado sobre',
  'public.nav.legalNotice': 'Aviso legal',
  'public.nav.privacyPolicy': 'Política de privacidad',
  'public.faq.label': 'Preguntas frecuentes',
  'public.faq.landingTitle': 'Lo que suelen preguntar los centros',
  // --- Section (es): landing (public landing / home page content) ---
  'public.faq.pricingTitle': 'Respuestas directas para evaluación institucional',
  'public.contact.requestLabel': 'Solicitar presupuesto, activación o demo',
  'public.contact.loginPrompt': '¿Ya tienes cuenta?',
  'landing.hero.badge': 'Filtrado web escolar por aula · servicio gestionado sobre OpenPath',
  'landing.hero.title': 'Decide qué Internet entra en cada aula, sin cargar más al equipo TIC.',
  'landing.hero.body':
    'ClassroomPath convierte la política digital del centro en reglas operativas reales: qué se abre, qué se bloquea y cómo se gestiona, aula por aula. Con precio público, activación remota ligera y sin dependencia de proveedor.',
  'landing.hero.proof':
    'Hasta 30 dispositivos por aula · apoyo remoto al IT del centro · código abierto auditable',
  'landing.hero.cardLabel': 'Servicio gestionado sobre OpenPath',
  'landing.hero.card1':
    'ClassroomPath no vende una suite docente generalista. Ordena el acceso web por aula para que el centro pueda aplicar una política digital clara.',
  'landing.hero.card2':
    'El foco está en decidir qué se abre, qué se bloquea y cómo se sostiene esa decisión sin más carga diaria para el equipo TIC.',
  'landing.hero.card3':
    'Si necesitas presupuesto, vas a precio por aula. Si quieres empezar con poco alcance, solicitas una activación remota.',
  'landing.positioning.title': 'No vendemos más tiempo de pantalla.',
  'landing.positioning.body':
    'Ayudamos a que Internet esté disponible cuando aporta valor pedagógico, bajo un criterio claro y sostenible para el centro.',
  'landing.flow.label': 'Operación',
  'landing.flow.title': 'Cómo funciona en la práctica',
  'landing.flow.body':
    'La mejora no está solo en bloquear. Está en convertir la política digital del centro en una operación clara: qué se permite, quién lo decide y cómo se sostiene sin improvisación continua.',
  'landing.roles.label': 'Perfiles',
  'landing.roles.title': 'Qué gana cada perfil',
  'landing.fit.label': 'Encaje',
  'landing.fit.title': 'ClassroomPath encaja si tu centro necesita...',
  'landing.fit.body':
    'Está pensado para centros que ya han decidido que necesitan una política de acceso clara y una operación más sencilla.',
  'landing.campaign.badge': 'Campaña activa · plazas limitadas',
  'landing.campaign.title': 'Acceso inicial para centros públicos',
  'landing.campaign.body':
    'Si tu centro es de titularidad pública, puedes acceder a ClassroomPath sin coste para hasta 5 aulas mientras haya disponibilidad.',
  'landing.campaign.detail1':
    'Incluye sesión remota con el IT del centro, checklist de arranque y soporte estándar por email.',
  'landing.campaign.detail2': 'Sin compromiso posterior.',
  'landing.campaign.detail3':
    'Plazas sujetas a disponibilidad y verificación de titularidad pública.',
  'landing.campaign.cta': 'Consultar disponibilidad',
  'landing.request.title': 'Coordina el siguiente paso con tu equipo IT',
  'landing.request.body':
    'Cuéntanos cuántas aulas quieres controlar, quién lidera la parte técnica y si necesitas presupuesto, activación o demo. Respondemos en 48 h.',
  'landing.benefit.price.title': 'Precio por aula, no por licencias sueltas',
  'landing.benefit.price.text':
    'El centro presupuesta y escala con una unidad que entiende: el aula.',
  'landing.benefit.activation.title': 'Activación remota con el IT del centro',
  'landing.benefit.activation.text':
    'Acompañamos al responsable técnico para dejar el arranque encarrilado sin convertirlo en otro proyecto paralelo.',
  'landing.benefit.open.title': 'Software abierto, servicio gestionado',
  'landing.benefit.open.text':
    'Operas con soporte y acompañamiento, sin renunciar a auditar el código ni a migrar si algún día lo necesitas.',
  'landing.step.one': 'Paso 1',
  'landing.step.two': 'Paso 2',
  'landing.step.three': 'Paso 3',
  'landing.step.criteria.title': 'El centro define el criterio',
  'landing.step.criteria.text':
    'Se traduce la política digital del centro a reglas claras por aula, etapa o necesidad docente.',
  'landing.step.activation.title': 'La activación inicial se prepara con el IT del centro',
  'landing.step.activation.text':
    'ClassroomPath acompaña en remoto al responsable técnico para validar red, dispositivos y el arranque de las primeras aulas.',
  'landing.step.friction.title': 'El acceso se gestiona con menos fricción',
  'landing.step.friction.text':
    'El profesorado trabaja con recursos útiles, el equipo TIC mantiene control por aula y la política deja de vivir solo en un documento.',
  'landing.role.leadership.title': 'Dirección',
  'landing.role.leadership.text':
    'Una política digital explicable, coherente con el proyecto educativo y aplicable de verdad.',
  'landing.role.teachers.title': 'Profesorado',
  'landing.role.teachers.text':
    'Menos ruido en clase y un flujo claro para solicitar aperturas cuando un recurso sí tiene sentido pedagógico.',
  'landing.role.it.title': 'Equipo TIC',
  'landing.role.it.text':
    'Control de acceso por aula sin montar otra infraestructura ni convertir el mantenimiento en otra carga diaria.',
  'landing.fitSignal.filter.title': 'Filtrado web escolar por aula',
  'landing.fitSignal.filter.text':
    'Decidir qué recursos se permiten y cuáles no según etapa, aula o uso docente.',
  'landing.fitSignal.devices.title': 'Control para dispositivos del centro',
  'landing.fitSignal.devices.text':
    'Aplicar una política clara en portátiles, carros, aulas compartidas, laboratorios o FP.',
  'landing.fitSignal.deployment.title': 'Despliegue con tu equipo IT',
  'landing.fitSignal.deployment.text':
    'Arrancar con apoyo remoto acotado sin depender de una implantación pesada por parte del proveedor.',
  'landing.fitSignal.open.title': 'Transparencia y autonomía',
  'landing.fitSignal.open.text':
    'Operar sobre código abierto y conservar una salida real si el centro quiere migrar a OpenPath.',
  // --- Section (es): pricing (public pricing page content) ---
  'public.pricing.title': 'Precios de filtrado web escolar por aula | ClassroomPath',
  'public.pricing.description':
    'Calcula el coste de ClassroomPath por número de aulas. Precio público, onboarding separado, activación remota ligera y servicio gestionado sobre OpenPath.',
  'pricing.hero.badge': 'Precios públicos por aula · sin sorpresas',
  'pricing.hero.title': 'Calcula el primer año en segundos y decide el siguiente paso.',
  'pricing.hero.body':
    'Primer año = cuota anual por aula + onboarding único. Desde el segundo año, solo mantienes la cuota anual por aula. Si quieres empezar con poco alcance, usa la activación remota ligera y valida el encaje con tu equipo IT antes de ampliar.',
  'pricing.hero.proof':
    'Hasta 30 dispositivos por aula · apoyo remoto al IT del centro · servicio gestionado sobre OpenPath',
  'pricing.hero.demo': 'Solicitar demo',
  'pricing.hero.recommended': 'Tramo más habitual',
  'pricing.hero.mediumSchool': 'Centro mediano',
  'pricing.hero.perClassroomYear': 'por aula / año',
  'pricing.hero.remoteActivation': 'Activación remota',
  'pricing.hero.activationLimit': 'Hasta {classrooms} aulas con apoyo remoto al IT',
  'pricing.hero.onboarding': 'Onboarding',
  'pricing.hero.onboardingPrice': 'Separado · desde 490 €',
  'pricing.hero.onboardingBody':
    'Lo esencial para controlar el acceso por aula, sin módulos que no vas a usar.',
  'pricing.next.title': 'Qué paso te conviene ahora',
  'pricing.next.body':
    'Cada centro llega con una necesidad distinta. Elige el recorrido que mejor te convenga ahora.',
  'pricing.next.calculate.title': 'Calcular presupuesto',
  'pricing.next.calculate.text':
    'Si necesitas una cifra rápida para presupuesto, usa la calculadora y obtén una estimación del primer año.',
  'pricing.next.calculate.cta': 'Ir a calculadora',
  'pricing.next.activation.title': 'Solicitar activación remota',
  'pricing.next.activation.text':
    'Si quieres empezar con poco alcance, acompasamos el arranque con el IT del centro y dejamos 1-2 aulas operativas.',
  'pricing.next.activation.cta': 'Ver activación',
  'pricing.next.demo.title': 'Solicitar demo',
  'pricing.next.demo.text':
    'Si ya estás comparando opciones, revisamos política, alcance y despliegue contigo.',
  'pricing.next.demo.cta': 'Solicitar demo',
  'pricing.included.label': 'Qué incluye cada aula',
  'pricing.included.title':
    'Un servicio gestionado para ordenar el acceso a Internet sin cargar más al equipo TIC',
  'pricing.campaign.label': 'Campaña activa',
  'pricing.campaign.title': 'Acceso inicial para centros públicos',
  'pricing.campaign.body': 'Hasta {classrooms} aulas sin coste. Plazas limitadas.',
  'pricing.activation.title': 'Activa 1-2 aulas con tu equipo IT por 149 €',
  'pricing.activation.body':
    'Incluye checklist técnica, una sesión remota con el IT del centro y apoyo para dejar 1-2 aulas operativas sin asumir una implantación completa.',
  'pricing.tiers.label': 'Tramos de precio',
  'pricing.tiers.title': 'Un precio por aula. Más aulas, menos coste por cada una.',
  'pricing.tiers.body':
    'ClassroomPath cobra por aula controlada, no por licencias sueltas. Así el centro entiende el coste rápido, identifica el tramo habitual y sabe cuándo necesita una validación comercial más específica.',
  'pricing.tiers.recommended': 'Más habitual',
  'pricing.tiers.footer': 'Todos los tramos requieren onboarding inicial. IVA no incluido.',
  'pricing.onboarding.title': 'Onboarding separado para que la renovación sea clara',
  'pricing.onboarding.body':
    'Separamos el arranque del recurrente para que el centro compare mejor el coste anual por aula y vea el esfuerzo inicial por separado.',
  'pricing.onboarding.covers': 'Qué cubre el onboarding',
  'pricing.onboarding.item.criteria': 'Sesión de arranque y definición de criterio',
  'pricing.onboarding.item.configuration':
    'Configuración inicial y validación con el IT del centro',
  'pricing.onboarding.item.review': 'Revisión del arranque y siguientes pasos',
  'pricing.value.label': 'Por qué este modelo se entiende más rápido',
  'pricing.calculator.label': 'Calculadora',
  'pricing.calculator.title': 'Estima el coste del primer año en 10 segundos',
  'pricing.calculator.body':
    'Introduce el número de aulas y verás: tramo aplicado, cuota anual, onboarding y total del primer año antes de pedir una propuesta detallada.',
  'pricing.calculator.classrooms': 'Número de aulas',
  'pricing.calculator.classroomHelp':
    'Aula controlada = hasta 30 dispositivos bajo una política de acceso definida.',
  'pricing.calculator.estimate': 'Estimación del primer año',
  'pricing.calculator.appliedTier': 'Tramo aplicado',
  'pricing.calculator.annualFee': 'Cuota anual',
  'pricing.calculator.totalFirstYear': 'Total primer año',
  'pricing.calculator.classroomLine': '{classrooms} aulas × {price}',
  'pricing.calculator.example':
    'Ejemplo: 12 aulas × {price} = {annualTotal} / año · Onboarding: {onboarding} · Total primer año: {total}',
  'pricing.calculator.customOnboarding':
    'En despliegues de 101 aulas o más, el onboarding se define con una propuesta específica por sede, alcance y ritmo de implantación.',
  'pricing.calculator.onboardingTier':
    'El onboarding para {classrooms} aulas queda en el tramo {rangeLabel}.',
  'pricing.model.label': 'Por qué cobramos por aula',
  'pricing.model.title': 'Un precio más cercano a la realidad operativa del centro',
  'pricing.model.commercial': 'Modelo comercial',
  'pricing.notIncluded.label': 'Transparencia del plan base',
  'pricing.notIncluded.title': 'Lo que no está incluido en el recurrente estándar',
  'pricing.notIncluded.body':
    'Estas funcionalidades están disponibles, pero se presupuestan aparte para no encarecer el plan base a quienes no las necesitan.',
  'pricing.contact.title': 'Pide presupuesto, activación o revisión de despliegue',
  'pricing.contact.body':
    'Revisamos el número de aulas, la política de acceso prevista y si conviene activación remota, propuesta anual o partner de implantación. Respondemos en 48 h.',
  'pricing.data.included.devices': 'Hasta 30 dispositivos por aula',
  'pricing.data.included.policies': 'Políticas de acceso a Internet',
  'pricing.data.included.requests': 'Cola de solicitudes de desbloqueo',
  'pricing.data.included.admin': 'Panel de administración',
  'pricing.data.included.hosting': 'Hosting y operación incluidos',
  'pricing.data.included.updates': 'Actualizaciones incluidas',
  'pricing.data.included.support': 'Soporte estándar por email',
  'pricing.data.included.openpath': 'Servicio gestionado sobre OpenPath',
  'pricing.data.notIncluded.sso': 'SSO empresarial',
  'pricing.data.notIncluded.sla': 'SLA premium',
  'pricing.data.notIncluded.migration': 'Migración avanzada',
  'pricing.data.notIncluded.training': 'Formación onsite',
  'pricing.data.notIncluded.priority': 'Soporte prioritario',
  'pricing.data.notIncluded.customPolicies': 'Políticas muy personalizadas por sede o etapa',
  'pricing.data.value.public': 'Precio público desde el primer clic',
  'pricing.data.value.unit': 'Unidad de compra clara: el aula',
  'pricing.data.value.activation': 'Activación remota para empezar con poco alcance',
  'pricing.data.value.open': 'Servicio gestionado sobre software abierto',
  'pricing.data.value.noLockIn': 'Sin dependencia obligatoria de proveedor',
  'pricing.data.points.operation':
    'El centro organiza su operación por espacios y grupos docentes, no por una suma abstracta de licencias.',
  'pricing.data.points.budget': 'Más fácil de explicar en presupuesto',
  'pricing.data.points.scale': 'Más fácil de escalar por espacios reales',
  'pricing.data.points.renewal': 'Más claro al separar arranque y renovación',
  'pricing.data.points.service': 'Más coherente con un servicio gestionado',
  'pricing.tier.small.name': 'Centro pequeño',
  'pricing.tier.small.range': '1-10 aulas',
  'pricing.tier.small.tagline':
    'Para primeros despliegues o un espacio docente con dispositivos del centro.',
  'pricing.tier.small.bestFor':
    'Primer despliegue o un espacio docente con dispositivos del centro.',
  'pricing.tier.medium.name': 'Centro mediano',
  'pricing.tier.medium.range': '11-25 aulas',
  'pricing.tier.medium.tagline':
    'El tramo más común para centros que ya quieren una política de aula estable.',
  'pricing.tier.medium.bestFor':
    'El tramo más común para centros que ya quieren una política de aula estable.',
  'pricing.tier.large.name': 'Centro grande',
  'pricing.tier.large.range': '26-50 aulas',
  'pricing.tier.large.tagline':
    'Pensado para centros con varias líneas, laboratorios o crecimiento por fases.',
  'pricing.tier.large.bestFor': 'Centros con varias líneas, laboratorios o crecimiento por fases.',
  'pricing.tier.organization.name': 'Organización educativa',
  'pricing.tier.organization.range': '51-100 aulas',
  'pricing.tier.organization.tagline':
    'Para estructuras con coordinación TIC central y varias sedes o etapas.',
  'pricing.tier.organization.bestFor':
    'Para estructuras con coordinación TIC central y varias sedes o etapas.',
  'pricing.tier.network.name': 'Red de centros',
  'pricing.tier.network.range': '101+ aulas',
  'pricing.tier.network.tagline':
    'Precio optimizado para redes de centros y despliegues multisede.',
  // --- Section (es): contact (contact / quote request form) ---
  'pricing.tier.network.bestFor':
    'Precio optimizado para despliegues multisede y redes educativas.',
  'pricing.onboarding.tier.small.range': 'Hasta 25 aulas',
  'pricing.onboarding.tier.medium.range': '26-100 aulas',
  'pricing.onboarding.tier.large.range': '101+ aulas',
  'pricing.onboarding.tier.contact': 'Contacta con nosotros',
  'contact.sent.title': 'Solicitud enviada',
  'contact.sent.body': 'Te responderemos en 48 h.',
  'contact.sent.again': 'Enviar otra solicitud',
  'contact.name.label': 'Nombre',
  'contact.name.placeholder': 'Tu nombre',
  'contact.center.label': 'Centro educativo',
  'contact.center.placeholder': 'Nombre del centro',
  'contact.email.label': 'Email de contacto',
  'contact.email.placeholder': 'email@centro.es',
  'contact.classrooms.label': 'N.º de aulas (opcional)',
  'contact.technicalOwner.label': 'Responsable técnico (opcional)',
  'contact.technicalOwner.placeholder': 'Nombre del responsable IT',
  'contact.partner.label': '¿Necesitáis partner de implantación?',
  'contact.intent.label': 'Qué necesitas',
  'contact.intent.quote': 'Presupuesto',
  'contact.intent.remoteActivation': 'Activación remota',
  'contact.intent.demo': 'Demo',
  'contact.yes': 'Sí',
  'contact.no': 'No',
  'contact.notSure': 'No lo sé',
  // --- Section (es): faq (frequently asked questions: landing and pricing) ---
  'contact.sending': 'Enviando...',
  'contact.submit': 'Enviar solicitud',
  'contact.email.subject': 'Solicitud ClassroomPath',
  'contact.email.body':
    'Qué necesitas: {intent}\nNombre: {name}\nCentro: {center}\nEmail: {email}\nN.º de aulas (aprox.): {classrooms}\nResponsable técnico: {technicalOwner}\n¿Necesita partner de implantación?: {deploymentPartnerNeed}',
  'contact.notProvided': 'No indicado',
  'faq.landing.screenTime.q': '¿ClassroomPath promueve más uso de pantallas?',
  'faq.landing.screenTime.a':
    'No. ClassroomPath está pensado para centros que quieren usar tecnología con más criterio. No vende más exposición digital; ayuda a limitar Internet a contextos y recursos que sí tienen sentido pedagógico.',
  'faq.landing.filter.q': '¿Es un filtro escolar más?',
  'faq.landing.filter.a':
    'No es solo filtrar. ClassroomPath añade gestión: quién decide qué se abre, por qué y con qué operación se sostiene.',
  'faq.landing.openSource.q': '¿Es software libre o propietario?',
  'faq.landing.openSource.a':
    'OpenPath es el motor abierto y ClassroomPath es el servicio gestionado sobre esa base. El centro puede auditar y, si lo necesita, migrar.',
  'faq.landing.fit.q': '¿Para qué centros encaja mejor?',
  'faq.landing.fit.a':
    'Especialmente para centros con dispositivos del centro, aulas de informática, FP, laboratorios o espacios compartidos donde hace falta control claro del acceso.',
  'faq.landing.time.q': '¿Cuánto tiempo lleva implantarlo?',
  'faq.landing.time.a':
    'Con equipo IT disponible, la activación inicial suele resolverse en una sesión remota y deja definido el siguiente paso para ampliar el despliegue.',
  'faq.pricing.classroom.q': '¿Qué cuenta como un aula?',
  'faq.pricing.classroom.a':
    'Un conjunto de hasta 30 dispositivos bajo una política de acceso definida.',
  'faq.pricing.activation.q': '¿Cómo funciona la activación remota?',
  'faq.pricing.activation.a':
    'La activación remota ligera cuesta 149 €. Incluye checklist técnica, una sesión remota con el IT del centro y apoyo para dejar 1-2 aulas operativas. La implantación la ejecuta el centro o su partner.',
  'faq.pricing.onboarding.q': '¿El onboarding está incluido en el recurrente?',
  'faq.pricing.onboarding.a':
    'No. Se cobra aparte para mantener el coste anual por aula limpio y comparable.',
  'faq.pricing.unit.q': '¿Por qué cobráis por aula y no por dispositivo?',
  'faq.pricing.unit.a':
    'Porque el centro organiza su operación por espacios y grupos docentes, no por una suma abstracta de licencias.',
  'faq.pricing.largeClassroom.q': '¿Qué pasa si un aula tiene más de 30 dispositivos?',
  'faq.pricing.largeClassroom.a':
    'Se recomienda contarla como dos aulas o pasar a un tramo personalizado.',
  'faq.pricing.support.q': '¿Incluye soporte?',
  'faq.pricing.support.a': 'Sí, soporte estándar por email. SLA premium aparte.',
  'faq.pricing.public.q': '¿Hay opción para centros públicos?',
  'faq.pricing.public.a':
    'Sí. Hay acceso sin coste para hasta 5 aulas mientras haya disponibilidad y se verifique titularidad pública.',
  'faq.pricing.difference.q':
    '¿Qué diferencia a ClassroomPath de un proxy o un filtro DNS estándar?',
  'faq.pricing.difference.a':
    'ClassroomPath añade gestión: política alineada con el proyecto pedagógico, cola de solicitudes de desbloqueo y una capa de operación gestionada sobre OpenPath.',
};

export const classroomPathI18nCatalogs: Record<
  ProductLocale,
  Record<ClassroomPathI18nKey, string>
> = {
  en: classroomPathI18nEn,
  es: classroomPathI18nEs,
};

export type ClassroomPathT = (key: ClassroomPathI18nKey, params?: ProductI18nParams) => string;

interface ClassroomPathI18nContextValue {
  locale: ProductLocale;
  t: ClassroomPathT;
}

const ClassroomPathI18nContext = createContext<ClassroomPathI18nContextValue | null>(null);

function formatMessage(message: string, params: ProductI18nParams = {}): string {
  return message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      return match;
    }
    return String(params[name]);
  });
}

export function translateClassroomPathText(
  locale: ProductLocale,
  key: ClassroomPathI18nKey,
  params?: ProductI18nParams
): string {
  return formatMessage(classroomPathI18nCatalogs[locale][key], params);
}

function getHydrationLocale(): string | null {
  if (typeof document === 'undefined') return null;

  return (
    document.documentElement.dataset.classroompathLocale ??
    document.getElementById('root')?.dataset.classroompathLocale ??
    null
  );
}

export function resolveClassroomPathLocale(
  locale?: string | readonly string[] | null
): ProductLocale {
  return resolveProductLocale(locale ?? getHydrationLocale());
}

export function ClassroomPathI18nProvider({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale?: string | readonly string[] | null;
}) {
  const resolvedLocale = resolveClassroomPathLocale(locale);
  const value = useMemo<ClassroomPathI18nContextValue>(
    () => ({
      locale: resolvedLocale,
      t: (key, params) => translateClassroomPathText(resolvedLocale, key, params),
    }),
    [resolvedLocale]
  );

  return (
    <OpenPathI18nProvider locale={resolvedLocale}>
      <ClassroomPathI18nContext.Provider value={value}>
        {children}
      </ClassroomPathI18nContext.Provider>
    </OpenPathI18nProvider>
  );
}

export function useClassroomPathI18n(): ClassroomPathI18nContextValue {
  const value = useContext(ClassroomPathI18nContext);
  if (value) return value;

  const locale = resolveClassroomPathLocale();
  return {
    locale,
    t: (key, params) => translateClassroomPathText(locale, key, params),
  };
}

export function useClassroomPathT(): ClassroomPathT {
  return useClassroomPathI18n().t;
}
