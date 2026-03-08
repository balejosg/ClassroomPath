import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config.js';
import type { RoleInfo } from './openpath-roles.js';
import type { User } from './openpath-users.js';

export interface TokensResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  tokenType: 'Bearer';
}

const JWT_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRY ?? process.env.JWT_EXPIRES_IN ?? '15m';
const JWT_REFRESH_EXPIRES_IN =
  process.env.JWT_REFRESH_EXPIRY ?? process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';

export function generateTokens(user: User, roles: RoleInfo[]): TokensResult {
  const accessPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    roles: roles.map((r) => ({
      role: r.role,
      groupIds: r.groupIds,
    })),
    type: 'access',
  };

  const refreshPayload = {
    sub: user.id,
    type: 'refresh',
  };

  const accessToken = jwt.sign(accessPayload, config.jwtSecret, {
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'openpath-api',
  } as SignOptions);

  const refreshToken = jwt.sign(refreshPayload, config.jwtSecret, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    issuer: 'openpath-api',
  } as SignOptions);

  return {
    accessToken,
    refreshToken,
    expiresIn: JWT_EXPIRES_IN,
    tokenType: 'Bearer',
  };
}
