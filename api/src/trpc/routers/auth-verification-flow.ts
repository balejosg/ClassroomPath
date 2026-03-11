import {
  deliverEmailVerification,
  issueOpenPathEmailVerificationToken,
  type EmailVerificationDeliveryResult,
  type EmailVerificationTokenIssueResult,
} from './auth-email-delivery.js';
import type { OpenPathRegistrationPayload } from '../../lib/openpath-auth-schema.js';

type ResolveRegistrationEmailVerificationParams = {
  registration: OpenPathRegistrationPayload;
};

type VerificationFlowDependencies = {
  deliverVerification: typeof deliverEmailVerification;
  issueVerificationToken: typeof issueOpenPathEmailVerificationToken;
};

const defaultDependencies: VerificationFlowDependencies = {
  deliverVerification: deliverEmailVerification,
  issueVerificationToken: issueOpenPathEmailVerificationToken,
};

export async function resolveRegistrationEmailVerification(
  params: ResolveRegistrationEmailVerificationParams,
  dependencies: Pick<VerificationFlowDependencies, 'issueVerificationToken'> = defaultDependencies
): Promise<EmailVerificationTokenIssueResult> {
  const { registration } = params;

  if (
    typeof registration.verificationToken === 'string' &&
    typeof registration.verificationExpiresAt === 'string'
  ) {
    return {
      verificationToken: registration.verificationToken,
      verificationExpiresAt: registration.verificationExpiresAt,
    };
  }

  return dependencies.issueVerificationToken(registration.user.id);
}

export async function deliverRegistrationEmailVerification(
  params: ResolveRegistrationEmailVerificationParams,
  dependencies: VerificationFlowDependencies = defaultDependencies
): Promise<EmailVerificationDeliveryResult> {
  const verification = await resolveRegistrationEmailVerification(params, dependencies);
  const { user } = params.registration;

  return dependencies.deliverVerification({
    email: user.email,
    name: user.name,
    verificationToken: verification.verificationToken,
    verificationExpiresAt: verification.verificationExpiresAt,
  });
}
