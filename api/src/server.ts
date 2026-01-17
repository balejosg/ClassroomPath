import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { config } from './config.js';

const app = express();

app.use(cors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
}));

// IMPORTANT: Proxy routes MUST be defined BEFORE express.json() middleware
// express.json() consumes the request body stream, which prevents
// http-proxy-middleware from forwarding the body to the target server.
// This caused POST requests to /trpc to hang indefinitely.

// Proxy OpenPath API routes to internal API container
// These routes are from OpenPath and must be forwarded to port 3000
const openPathApiTarget = process.env.OPENPATH_API_URL ?? 'http://api:3000';

// Proxy /health endpoint to OpenPath API
app.get('/health', createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
}));

// Proxy /trpc to OpenPath API (must be before express.json())
app.use('/trpc', createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
    ws: true,
}));

// Proxy /api to OpenPath API (must be before express.json())
app.use('/api', createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
}));

// Proxy /w (whitelist exports) to OpenPath API
app.use('/w', createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
}));

// NOW apply express.json() for ClassroomPath-specific routes that need body parsing
app.use(express.json());

// ClassroomPath-specific health endpoint
app.get('/cp/health', (_req, res) => {
    res.json({ status: 'ok', service: 'classroompath-gateway' });
});

// ClassroomPath-specific config endpoint (overrides proxy for /api/config)
// Note: This won't be reached because /api proxy is above. 
// The SPA fetches /api/config which is handled by OpenPath API.

// ClassroomPath-specific tRPC endpoints
app.use('/cp/trpc', createExpressMiddleware({
    router: appRouter,
    createContext,
}));

app.listen(config.port, () => {
    console.log(`ClassroomPath Gateway listening on port ${config.port}`);
    console.log(`Proxying OpenPath API routes to ${openPathApiTarget}`);
});

export { app };
