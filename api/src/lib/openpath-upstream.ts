export {
  buildOpenPathHeaders,
  getForwardHeaders,
  type OpenPathForwardRequest,
} from './openpath/headers.js';
export {
  extractUpstreamErrorMessage,
  mapUpstreamStatusToTrpcCode,
  readUpstreamErrorMessage,
} from './openpath/errors.js';
export { extractTrpcData } from './openpath/response.js';
export {
  callOpenPathTrpc,
  openPathTrpcUrl,
  type OpenPathTrpcCallOptions,
  type UpstreamFailureMessage,
} from './openpath/trpc-client.js';
export {
  fetchOpenPathMeProfile,
  generateOpenPathEmailVerificationToken,
  googleLoginOpenPathUser,
  loginOpenPathUser,
  registerOpenPathUser,
  validateOpenPathAccessToken,
  type AuthenticatedOpenPathUser,
  type OpenPathAuthValidationResult,
} from './openpath/auth-client.js';
