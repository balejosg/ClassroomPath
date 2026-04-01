import express from 'express';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createExpressMiddleware } from '@trpc/server/adapters/express';

import { assertRuntimeSecretsConfigured, config } from './config.js';
import { createGatewayRateLimitRules, createRateLimitMiddleware } from './lib/gateway-hardening.js';
import { type GatewayAppOptions, resolveGatewayConfig } from './lib/gateway-config.js';
import { getGatewayReadiness } from './lib/gateway-readiness.js';
import {
  registerGatewayApplicationRoutes,
  registerGatewayBaseMiddleware,
  registerGatewayHealthRoutes,
  registerGatewayProxyRoutes,
  registerGatewaySpaRoutes,
} from './lib/gateway-routes.js';
import { logger } from './lib/logger.js';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';
import { logTrpcError } from './trpc/trpc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createGatewayApp(options: GatewayAppOptions = {}) {
  assertRuntimeSecretsConfigured();

  const app = express();
  const gatewayConfig = resolveGatewayConfig(options);
  const reactSpaPath = path.join(__dirname, '../../react-spa/dist');
  const rateLimitMiddleware = gatewayConfig.enableRateLimit
    ? createRateLimitMiddleware(createGatewayRateLimitRules(gatewayConfig))
    : null;
  const trpcMiddleware = createExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ path, ctx, error }) {
      logTrpcError({ path, ctx, error });
    },
  });

  registerGatewayBaseMiddleware(app, {
    corsOrigins: gatewayConfig.corsOrigins,
    publicOrigin: gatewayConfig.publicOrigin,
    rateLimitMiddleware,
  });
  registerGatewayProxyRoutes(app, {
    openPathApiTarget: config.openpathUrl,
  });
  registerGatewayHealthRoutes(app, {
    getGatewayReadiness,
  });
  registerGatewayApplicationRoutes(app, {
    jsonBodyLimit: gatewayConfig.jsonBodyLimit,
    trpcMiddleware,
  });
  if (gatewayConfig.serveSpa) {
    registerGatewaySpaRoutes(app, {
      reactSpaPath,
    });
  }

  return app;
}

const app = createGatewayApp();

function startGateway() {
  return app.listen(config.port, () => {
    logger.info('ClassroomPath Gateway listening', { port: config.port });
    logger.info('Proxying OpenPath API routes', { target: config.openpathUrl });
  });
}

const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  startGateway();
}

export { app, startGateway };
