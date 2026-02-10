import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc/router.js';
import { createContext } from './trpc/context.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGINS?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  })
);

// v2 UI and API endpoints are removed.
app.use('/v2', (_req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

// Proxy targets
const openPathApiTarget = process.env.OPENPATH_API_URL ?? 'http://api:3000';

// Proxy /health endpoint to OpenPath API
app.get(
  '/health',
  createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
  })
);

// Block sensitive OpenPath endpoints - force use of /cp/trpc/* for tenant-filtered data
const BLOCKED_OPENPATH_PROCEDURES = [
  'groups.list',
  'groups.getById',
  'groups.getByName',
  'groups.listRules',
  'groups.listRulesGrouped',
  'classrooms.list',
  'classrooms.get',
  'classrooms.listMachines',
  'users.list',
  'users.get',
  'users.listTeachers',
  'requests.list',
  'requests.get',
  'requests.getStatus',
  // Block mutations to prevent tenant-scoping bypass
  'requests.approve',
  'requests.reject',
  'requests.delete',
  'requests.listGroups',
];

app.use((req, res, next) => {
  if (!req.url.startsWith('/trpc')) {
    return next();
  }

  const procedurePath = req.url.slice(5).split('?')[0].replace(/^\//, '');
  const procedures = procedurePath.split(',');

  const blocked = procedures.find((proc) =>
    BLOCKED_OPENPATH_PROCEDURES.some((b) => proc === b || proc.startsWith(b + '.'))
  );

  if (blocked) {
    return res.status(403).json({
      error: {
        message: 'Use /cp/trpc for tenant-scoped data',
        code: 'FORBIDDEN',
        data: { blocked },
      },
    });
  }
  next();
});

// Proxy OpenPath API routes (must be before express.json())
app.use(
  createProxyMiddleware({
    target: openPathApiTarget,
    changeOrigin: true,
    ws: true,
    pathFilter: ['/api', '/trpc', '/w', '/export', '/api-docs'],
  })
);

// Serve ClassroomPath React SPA statically
// Works for both source (api/src) and compiled (api/dist).
const reactSpaPath = path.join(__dirname, '../../react-spa/dist');

if (fs.existsSync(reactSpaPath)) {
  console.log(`Serving ClassroomPath React SPA from: ${reactSpaPath}`);
  app.use(express.static(reactSpaPath));
} else {
  console.warn(`ClassroomPath React SPA dist not found at: ${reactSpaPath}`);
}

// NOW apply express.json() for ClassroomPath-specific routes
app.use(express.json());

// ClassroomPath-specific health endpoint
app.get('/cp/health', (_req, res) => {
  res.json({ status: 'ok', service: 'classroompath-gateway' });
});

// ClassroomPath-specific tRPC endpoints
app.use(
  '/cp/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

// SPA Fallback - must be last
if (fs.existsSync(reactSpaPath)) {
  app.get('/*', (_req, res) => {
    // Only fallback if not an API or TRPC route
    if (
      !_req.url.startsWith('/cp/') &&
      !_req.url.startsWith('/api') &&
      !_req.url.startsWith('/trpc')
    ) {
      res.sendFile(path.join(reactSpaPath, 'index.html'));
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });
}

function startGateway() {
  return app.listen(config.port, () => {
    console.log(`ClassroomPath Gateway listening on port ${config.port}`);
    console.log(`Proxying OpenPath API routes to ${openPathApiTarget}`);
  });
}

// IMPORTANT: Avoid starting the server as an import side-effect.
// Tests import this module to access `app` and manage their own server lifecycle.
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
