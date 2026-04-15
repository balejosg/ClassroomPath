import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@classroompath/trpc-contract';

export const cpTrpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/cp/trpc',
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: 'include',
        });
      },
    }),
  ],
});
