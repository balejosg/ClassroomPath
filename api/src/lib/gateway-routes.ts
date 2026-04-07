export {
  registerGatewayApplicationRoutes,
  type GatewayApplicationRoutesOptions,
} from './gateway/application-routes.js';
export {
  registerGatewayBaseMiddleware,
  type GatewayBaseMiddlewareOptions,
} from './gateway/base-middleware.js';
export { composeGatewayApp, type ComposeGatewayAppOptions } from './gateway/compose-gateway.js';
export {
  registerGatewayHealthRoutes,
  type GatewayHealthRoutesOptions,
} from './gateway/health-routes.js';
export {
  registerGatewayProxyRoutes,
  type GatewayProxyRoutesOptions,
} from './gateway/proxy-routes.js';
export { registerGatewaySpaRoutes, type GatewaySpaRoutesOptions } from './gateway/spa-routes.js';
