import express from 'express';
import cors from 'cors';
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

app.get('/cp/health', (_req, res) => {
    res.json({ status: 'ok', service: 'classroompath-gateway' });
});

app.get('/api/config', (_req, res) => {
    res.json({
        googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
    });
});

app.use('/cp/trpc', createExpressMiddleware({
    router: appRouter,
    createContext,
}));

app.listen(config.port, () => {
    console.log(`ClassroomPath Gateway listening on port ${config.port}`);
});

export { app };
