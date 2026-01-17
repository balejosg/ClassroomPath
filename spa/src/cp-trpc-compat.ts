import { cpTrpc } from './cp-trpc.js';

// Re-export cpTrpc as trpc for OpenPath compatibility
export const trpc = cpTrpc;
export default trpc;
