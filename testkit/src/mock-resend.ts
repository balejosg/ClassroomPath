export interface MockEmailDelivery {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

const originalFetch = globalThis.fetch.bind(globalThis);
const mockEmailDeliveries: MockEmailDelivery[] = [];
let mockEmailDeliveryCounter = 0;

export function installMockResendDelivery(): void {
  const patchedFetch = globalThis.fetch as typeof globalThis.fetch & {
    __classroompathMockResend?: boolean;
  };

  if (patchedFetch.__classroompathMockResend) {
    return;
  }

  const fetchWithMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url === 'https://api.resend.com/emails') {
      const rawBody =
        typeof init?.body === 'string'
          ? init.body
          : init?.body instanceof URLSearchParams
            ? init.body.toString()
            : '';
      const payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
      const deliveryId = `mock-resend-${String(++mockEmailDeliveryCounter)}`;

      mockEmailDeliveries.push({
        id: deliveryId,
        from: typeof payload.from === 'string' ? payload.from : '',
        to: Array.isArray(payload.to)
          ? payload.to.filter((value): value is string => typeof value === 'string')
          : [],
        subject: typeof payload.subject === 'string' ? payload.subject : '',
        html: typeof payload.html === 'string' ? payload.html : '',
        text: typeof payload.text === 'string' ? payload.text : '',
      });

      return new Response(JSON.stringify({ id: deliveryId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return originalFetch(input, init);
  }) as typeof globalThis.fetch & {
    __classroompathMockResend?: boolean;
  };

  fetchWithMock.__classroompathMockResend = true;
  globalThis.fetch = fetchWithMock;
}

export function getMockEmailDeliveries(): MockEmailDelivery[] {
  return [...mockEmailDeliveries];
}

export function resetMockEmailDeliveries(): void {
  mockEmailDeliveries.length = 0;
}
