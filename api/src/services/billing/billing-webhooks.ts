import { eq } from 'drizzle-orm';

import { config } from '../../config.js';
import { db, schema } from '../../db/index.js';
import type { StripeWebhookEvent } from './billing-types.js';
import { dispatchStripeWebhookEvent } from './billing-webhook-event.service.js';
import { verifyStripeSignature } from './billing-webhook-signature.js';
import { isStripeBillingEnabled } from './billing-utils.js';

export async function processStripeWebhook(params: {
  rawBody: Buffer;
  signature: string | undefined;
}): Promise<void> {
  if (!isStripeBillingEnabled()) {
    return;
  }

  const secret = config.stripe.webhookSecret;
  if (!secret) {
    throw new Error('Stripe webhook secret is not configured');
  }
  if (!params.signature) {
    throw new Error('Missing Stripe signature');
  }

  const payload = params.rawBody.toString('utf8');
  verifyStripeSignature(payload, params.signature, secret);
  const event = JSON.parse(payload) as StripeWebhookEvent;

  const [existing] = await db
    .select({ id: schema.cpStripeWebhookEvents.id })
    .from(schema.cpStripeWebhookEvents)
    .where(eq(schema.cpStripeWebhookEvents.id, event.id))
    .limit(1);

  if (existing) return;

  await dispatchStripeWebhookEvent(event);

  await db.insert(schema.cpStripeWebhookEvents).values({
    id: event.id,
    type: event.type,
    processedAt: new Date(),
  });
}
