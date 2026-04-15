import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@classroompath/api/trpc-router';

export type { AppRouter } from '@classroompath/api/trpc-router';

export type ClassroomPathRouterInputs = inferRouterInputs<AppRouter>;
export type ClassroomPathRouterOutputs = inferRouterOutputs<AppRouter>;
