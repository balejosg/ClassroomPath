import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createTRPCReact, httpBatchLink } from '@trpc/react-query';
import type { AppRouter } from '@classroompath/trpc-contract';

// Cliente React Query para ClassroomPath endpoints
export const cpTrpcReact = createTRPCReact<AppRouter>();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const cpTrpcClient = cpTrpcReact.createClient({
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

export function DualTRPCProvider({ children }: { children: React.ReactNode }) {
  return (
    <cpTrpcReact.Provider client={cpTrpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </cpTrpcReact.Provider>
  );
}
