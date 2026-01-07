import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../api/src/trpc/router.js';

function getAuthToken(): string {
    return localStorage.getItem('openpath_access_token') ?? '';
}

export const cpTrpc = createTRPCProxyClient<AppRouter>({
    links: [
        httpBatchLink({
            url: '/cp/trpc',
            headers() {
                const token = getAuthToken();
                return token ? { Authorization: `Bearer ${token}` } : {};
            },
        }),
    ],
});
