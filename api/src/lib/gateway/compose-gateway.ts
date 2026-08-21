import type { Express, RequestHandler } from 'express';

import type { GatewayAppOptions } from '../gateway-config.js';
import type { GatewayReadiness } from '../gateway-readiness.js';
import {
  registerGatewayApplicationRoutes,
  type GatewayApplicationRoutesOptions,
} from './application-routes.js';
import {
  registerGatewayBaseMiddleware,
  type GatewayBaseMiddlewareOptions,
} from './base-middleware.js';
import { registerGatewayHealthRoutes, type GatewayHealthRoutesOptions } from './health-routes.js';
import { registerGatewayProxyRoutes, type GatewayProxyRoutesOptions } from './proxy-routes.js';
import { registerGatewaySpaRoutes, type GatewaySpaRoutesOptions } from './spa-routes.js';

export interface ComposeGatewayAppOptions {
  app: Express;
  corsOrigins: GatewayBaseMiddlewareOptions['corsOrigins'];
  publicOrigin: GatewayBaseMiddlewareOptions['publicOrigin'];
  rateLimitMiddleware?: RequestHandler | null;
  openPathApiTarget: GatewayProxyRoutesOptions['openPathApiTarget'];
  getGatewayReadiness: GatewayHealthRoutesOptions['getGatewayReadiness'];
  jsonBodyLimit: GatewayApplicationRoutesOptions['jsonBodyLimit'];
  trpcMiddleware: GatewayApplicationRoutesOptions['trpcMiddleware'];
  stripeWebhookHandler: GatewayApplicationRoutesOptions['stripeWebhookHandler'];
  notificationApproveDomainRequestHandler: GatewayApplicationRoutesOptions['notificationApproveDomainRequestHandler'];
  clientCanaryManualBillingApprovalHandler: GatewayApplicationRoutesOptions['clientCanaryManualBillingApprovalHandler'];
  clientCanaryGroupDiagnosticsHandler: GatewayApplicationRoutesOptions['clientCanaryGroupDiagnosticsHandler'];
  windowsOfflineInstallerDownloadHandler: GatewayApplicationRoutesOptions['windowsOfflineInstallerDownloadHandler'];
  serveSpa: boolean;
  reactSpaPath: GatewaySpaRoutesOptions['reactSpaPath'];
}

export function composeGatewayApp(options: ComposeGatewayAppOptions): Express {
  registerGatewayBaseMiddleware(options.app, {
    corsOrigins: options.corsOrigins,
    publicOrigin: options.publicOrigin,
    rateLimitMiddleware: options.rateLimitMiddleware,
  });
  registerGatewayProxyRoutes(options.app, {
    openPathApiTarget: options.openPathApiTarget,
  });
  registerGatewayHealthRoutes(options.app, {
    getGatewayReadiness: options.getGatewayReadiness,
  });
  registerGatewayApplicationRoutes(options.app, {
    jsonBodyLimit: options.jsonBodyLimit,
    trpcMiddleware: options.trpcMiddleware,
    stripeWebhookHandler: options.stripeWebhookHandler,
    notificationApproveDomainRequestHandler: options.notificationApproveDomainRequestHandler,
    clientCanaryManualBillingApprovalHandler: options.clientCanaryManualBillingApprovalHandler,
    clientCanaryGroupDiagnosticsHandler: options.clientCanaryGroupDiagnosticsHandler,
    windowsOfflineInstallerDownloadHandler: options.windowsOfflineInstallerDownloadHandler,
  });

  if (options.serveSpa) {
    registerGatewaySpaRoutes(options.app, {
      reactSpaPath: options.reactSpaPath,
    });
  }

  return options.app;
}
