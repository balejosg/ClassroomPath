import { TRPCError } from '@trpc/server';

import { config } from '../../config.js';

export function requireStripeSecret(): string {
  const secret = config.stripe.secretKey;
  if (!secret) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Stripe checkout is not configured',
    });
  }

  return secret;
}

export function formEncodeCheckout(input: {
  mode: 'payment' | 'subscription';
  lineItems: Array<{ price: string; quantity: number }>;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  email: string;
  metadata: Record<string, string>;
}): URLSearchParams {
  const body = new URLSearchParams();
  body.set('mode', input.mode);
  body.set('success_url', input.successUrl);
  body.set('cancel_url', input.cancelUrl);
  body.set('client_reference_id', input.clientReferenceId);
  body.set('customer_email', input.email);
  body.set('automatic_tax[enabled]', 'true');
  body.set('billing_address_collection', 'required');
  body.set('tax_id_collection[enabled]', 'true');

  input.lineItems.forEach((item, index) => {
    body.set(`line_items[${index}][price]`, item.price);
    body.set(`line_items[${index}][quantity]`, String(item.quantity));
  });

  for (const [key, value] of Object.entries(input.metadata)) {
    body.set(`metadata[${key}]`, value);
  }

  return body;
}

export async function createStripeCheckoutSession(body: URLSearchParams): Promise<{
  id: string;
  url: string;
}> {
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireStripeSecret()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const payload = (await response.json().catch(() => null)) as {
    id?: unknown;
    url?: unknown;
    error?: { message?: unknown };
  } | null;

  if (!response.ok) {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message:
        typeof payload?.error?.message === 'string'
          ? payload.error.message
          : 'Stripe checkout session failed',
    });
  }

  if (typeof payload?.id !== 'string' || typeof payload.url !== 'string') {
    throw new TRPCError({
      code: 'BAD_GATEWAY',
      message: 'Invalid Stripe checkout session payload',
    });
  }

  return { id: payload.id, url: payload.url };
}
