import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('cp-trpc', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('configures the ClassroomPath client boundary with cookie credentials', async () => {
    const createTRPCClient = vi.fn((options) => options);
    const httpBatchLink = vi.fn((options) => options);
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}'));

    vi.stubGlobal('fetch', fetchSpy);
    vi.doMock('@trpc/client', () => ({
      createTRPCClient,
      httpBatchLink,
    }));

    const { cpTrpc } = await import('../cp-trpc');

    expect(createTRPCClient).toHaveBeenCalledTimes(1);
    expect(httpBatchLink).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/cp/trpc',
        fetch: expect.any(Function),
      })
    );

    const linkOptions = httpBatchLink.mock.calls[0]?.[0];
    await linkOptions.fetch('/cp/trpc/users.list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/cp/trpc/users.list',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        credentials: 'include',
      })
    );
    expect(cpTrpc).toBe(createTRPCClient.mock.results[0]?.value);
  });
});
