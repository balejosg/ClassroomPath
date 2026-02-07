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

export const appRouter = router({
  auth: authRouter,
  onboarding: onboardingRouter,
  classrooms: classroomsRouter,
  groups: groupsRouter,
  users: usersRouter,
  requests: requestsRouter,
  pendingUsers: pendingUsersRouter,
  healthcheck: healthcheckRouter,
  apiTokens: apiTokensRouter,
});

export type AppRouter = typeof appRouter;
