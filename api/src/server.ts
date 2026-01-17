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
const openPathSpaTarget = process.env.OPENPATH_SPA_URL ?? 'http://spa:80';

// Proxy /health endpoint to OpenPath API
app.get('/health', createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
}));

// Proxy OpenPath API routes (must be before express.json())
// We use a single proxy with pathFilter to avoid prefix stripping issues with app.use('/path', ...)

// Block sensitive OpenPath endpoints - force use of /cp/trpc/* for tenant-filtered data
const BLOCKED_OPENPATH_PROCEDURES = [
    'groups.list', 'groups.getById', 'groups.getByName', 'groups.listRules',
    'classrooms.list', 'classrooms.get', 'classrooms.listMachines',
    'users.list', 'users.get', 'users.listTeachers',
];

app.use((req, res, next) => {
    if (!req.url.startsWith('/trpc')) {
        return next();
    }

    // req.url starts with /trpc, so we check procedures
    // /trpc/health.ping -> health.ping
    const procedurePath = req.url.slice(5).split('?')[0].replace(/^\//, '');
    const procedures = procedurePath.split(',');

    const blocked = procedures.find(proc =>
        BLOCKED_OPENPATH_PROCEDURES.some(b => proc === b || proc.startsWith(b + '.'))
    );

    if (blocked) {
        return res.status(403).json({
            error: {
                message: 'Use /cp/trpc for tenant-scoped data',
                code: 'FORBIDDEN',
                data: { blocked }
            }
        });
    }
    next();
});

app.use(createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
    ws: true,
    pathFilter: ['/api', '/trpc', '/w', '/export', '/api-docs'],
}));

// Proxy all other routes (except /cp/*) to the SPA container
app.use(createProxyMiddleware({
    target: openPathSpaTarget,
    changeOrigin: true,
    pathFilter: (path) => !path.startsWith('/cp') && !path.startsWith('/api') && !path.startsWith('/trpc') && !path.startsWith('/w') && !path.startsWith('/export') && !path.startsWith('/api-docs') && path !== '/health',
}));

// NOW apply express.json() for ClassroomPath-specific routes that need body parsing
app.use(express.json());

// ClassroomPath-specific health endpoint
app.get('/cp/health', (_req, res) => {
    res.json({ status: 'ok', service: 'classroompath-gateway' });
});

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
