import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../../api/src/trpc/router';
import { getAuthHeaders } from './auth-storage';

export const cpTrpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: '/cp/trpc',
      headers() {
        return getAuthHeaders();
      },
    }),
  ],
});
