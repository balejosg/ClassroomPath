// gateway-hardening.ts — barrel re-export; do not add logic here.
// Layout:
//   gateway-errors.ts      — GatewayErrorCode, createGatewayErrorBody,
//                            isPayloadTooLargeError, createGatewayErrorMiddleware
//   gateway-headers.ts     — CSP builder, security headers, CORS resolver, CSRF middleware
//   gateway-rate-limits.ts — GatewayRateLimitOptions/Rule, rate-limit rules, rate-limit middleware

export {
  type GatewayErrorCode,
  createGatewayErrorBody,
  createGatewayErrorMiddleware,
  isPayloadTooLargeError,
} from './gateway-errors.js';

export {
  applyGatewaySecurityHeaders,
  buildGatewayContentSecurityPolicy,
  createGatewayCorsOriginResolver,
  createGatewayCsrfProtectionMiddleware,
} from './gateway-headers.js';

export {
  type GatewayRateLimitOptions,
  type GatewayRateLimitRule,
  createGatewayRateLimitRules,
  createRateLimitMiddleware,
} from './gateway-rate-limits.js';
