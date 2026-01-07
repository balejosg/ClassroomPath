import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface JWTPayload {
    sub: string;
    email: string;
    name: string;
    roles: Array<{ role: string; groupIds: string[] }>;
}

export interface Context {
    user: JWTPayload | null;
    req: CreateExpressContextOptions['req'];
    res: CreateExpressContextOptions['res'];
}

export async function createContext({ req, res }: CreateExpressContextOptions): Promise<Context> {
    const authHeader = req.headers.authorization;
    let user: JWTPayload | null = null;

    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
            user = jwt.verify(token, config.jwtSecret) as JWTPayload;
        } catch {
            // Invalid token, user remains null
        }
    }

    return { user, req, res };
}
