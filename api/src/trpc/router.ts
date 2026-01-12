import { router } from './trpc.js';
import { onboardingRouter } from './routers/onboarding.js';
import { classroomsRouter } from './routers/classrooms.js';
import { groupsRouter } from './routers/groups.js';
import { usersRouter } from './routers/users.js';

export const appRouter = router({
    onboarding: onboardingRouter,
    classrooms: classroomsRouter,
    groups: groupsRouter,
    users: usersRouter,
});

export type AppRouter = typeof appRouter;
