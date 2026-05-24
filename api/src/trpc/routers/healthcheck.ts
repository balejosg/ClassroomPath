import { router, publicProcedure } from '../trpc.js';
import {
  createOpenPathGateway,
  forwardOpenPathHealthcheck,
  getOpenPathGatewaySystemInfo,
  type OpenPathGatewaySystemInfoStatus,
} from '../../lib/openpath/gateway.js';

export type GatewaySystemInfo = OpenPathGatewaySystemInfoStatus;

export async function getGatewaySystemInfo(
  fetchImpl: typeof fetch = fetch
): Promise<GatewaySystemInfo> {
  return getOpenPathGatewaySystemInfo(createOpenPathGateway({ fetchImpl }));
}

export const healthcheckRouter = router({
  /**
   * Liveness probe - forwards to OpenPath API
   */
  live: publicProcedure.query(async () => forwardOpenPathHealthcheck('healthcheck.live')),

  /**
   * Readiness probe - forwards to OpenPath API
   */
  ready: publicProcedure.query(async () => forwardOpenPathHealthcheck('healthcheck.ready')),

  /**
   * System info for Settings page - forwards to OpenPath API
   */
  systemInfo: publicProcedure.query(async () => getGatewaySystemInfo()),
});
