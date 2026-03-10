import { router } from '../trpc.js';
import { authInvitationProcedures } from './auth-invitation-procedures.js';
import { authRecoveryProcedures } from './auth-recovery-procedures.js';
import { authRegistrationProcedures } from './auth-registration-procedures.js';
import { authSessionProcedures } from './auth-session-procedures.js';

export const authRouter = router({
  ...authSessionProcedures,
  ...authRegistrationProcedures,
  ...authInvitationProcedures,
  ...authRecoveryProcedures,
});
