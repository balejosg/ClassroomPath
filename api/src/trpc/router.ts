import { router } from './trpc.js';
import { onboardingRouter } from './routers/onboarding.js';

export const appRouter = router({
    onboarding: onboardingRouter,
});

export type AppRouter = typeof appRouter;
