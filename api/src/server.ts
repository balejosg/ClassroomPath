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

app.use(express.json());

// ClassroomPath-specific health endpoint
app.get('/cp/health', (_req, res) => {
    res.json({ status: 'ok', service: 'classroompath-gateway' });
});

// ClassroomPath-specific config endpoint
app.get('/api/config', (_req, res) => {
    res.json({
        googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
    });
});

// ClassroomPath-specific tRPC endpoints
app.use('/cp/trpc', createExpressMiddleware({
    router: appRouter,
    createContext,
}));

// Proxy OpenPath API routes to internal API container
// These routes are from OpenPath and must be forwarded to port 3000
const openPathApiTarget = process.env.OPENPATH_API_URL ?? 'http://api:3000';

// Proxy /health endpoint to OpenPath API
// MUST come before /api handler to avoid being caught by /api/* route
app.get('/health', createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
}));

app.use('/api', createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
}));

app.use('/trpc', createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
    ws: true,
}));

app.use('/w', createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
}));

app.listen(config.port, () => {
    console.log(`ClassroomPath Gateway listening on port ${config.port}`);
    console.log(`Proxying OpenPath API routes to ${openPathApiTarget}`);
});

export { app };
