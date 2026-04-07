import type { Express } from 'express';

import type { GatewayReadiness } from '../gateway-readiness.js';

export interface GatewayHealthRoutesOptions {
  getGatewayReadiness: () => Promise<GatewayReadiness>;
}

export function registerGatewayHealthRoutes(
  app: Express,
  options: GatewayHealthRoutesOptions
): void {
  app.get('/cp/health', (_req, res) => {
    res.json({ status: 'ok', service: 'classroompath-gateway' });
  });

  app.get('/cp/ready', async (_req, res) => {
    const readiness = await options.getGatewayReadiness();

    if (readiness.ready) {
      res.json({
        status: 'ready',
        ...readiness,
      });
      return;
    }

    res.status(503).json({
      status: 'not_ready',
      ...readiness,
    });
  });
}
