import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../api/src/trpc/router';

export const cpTrpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/cp/trpc',
      headers() {
        const token = localStorage.getItem('openpath_access_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    }),
  ],
});
