import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../api/src/trpc/router';

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
