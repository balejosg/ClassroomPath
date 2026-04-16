import { router } from './trpc.js';
import { authRouter } from './routers/auth.js';
import { onboardingRouter } from './routers/onboarding.js';
import { classroomsRouter } from './routers/classrooms.js';
import { groupsRouter } from './routers/groups.js';
import { usersRouter } from './routers/users.js';
import { requestsRouter } from './routers/requests.js';
import { pendingUsersRouter } from './routers/pending-users.js';
import { healthcheckRouter } from './routers/healthcheck.js';
import { apiTokensRouter } from './routers/api-tokens.js';
import { schedulesRouter } from './routers/schedules.js';
import { templatesRouter } from './routers/templates.js';
import { clientTelemetryRouter } from './routers/client-telemetry.js';
import { billingRouter } from './routers/billing.js';
import { pushRouter } from './routers/push.js';

export const appRouter = router({
  auth: authRouter,
  onboarding: onboardingRouter,
  classrooms: classroomsRouter,
  groups: groupsRouter,
  templates: templatesRouter,
  users: usersRouter,
  requests: requestsRouter,
  schedules: schedulesRouter,
  pendingUsers: pendingUsersRouter,
  healthcheck: healthcheckRouter,
  apiTokens: apiTokensRouter,
  clientTelemetry: clientTelemetryRouter,
  billing: billingRouter,
  push: pushRouter,
});

export type AppRouter = typeof appRouter;
