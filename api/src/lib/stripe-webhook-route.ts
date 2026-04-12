import type { RequestHandler } from 'express';

import { config } from '../config.js';
import { processStripeWebhook } from '../services/billing.service.js';
import { logger } from './logger.js';
import { getRequestId } from './request-id.js';

export const stripeWebhookHandler: RequestHandler = (req, res) => {
  if (config.billingMode !== 'stripe') {
    res.status(202).json({ received: false, disabled: true });
    return;
  }

  void (async () => {
    try {
      await processStripeWebhook({
        rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? '')),
        signature: req.get('stripe-signature') ?? undefined,
      });
      res.json({ received: true });
    } catch (error) {
      logger.request(getRequestId(req)).warn('Rejected Stripe webhook', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(400).json({ error: 'Invalid Stripe webhook' });
    }
  })();
};
