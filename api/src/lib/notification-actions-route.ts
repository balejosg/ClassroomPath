import { TRPCError } from '@trpc/server';
import type { RequestHandler, Response } from 'express';

import { getSingleMembershipOrThrow } from './tenant-memberships.js';
import { approveTenantRequest } from '../services/request-approve.service.js';
import { assertOrganizationEntitled } from '../services/billing.service.js';
import { createContext } from '../trpc/context.js';
import type { TenantProcedureContext } from '../trpc/tenant-procedure-helpers.js';

type NotificationActionErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_SERVER_ERROR';

function sendNotificationActionError(
  res: Response,
  status: number,
  code: NotificationActionErrorCode,
  message: string
): void {
  res.status(status).json({
    error: {
      message,
      code,
      data: { code },
    },
  });
}

export function mapNotificationActionTrpcError(error: TRPCError): {
  status: number;
  code: NotificationActionErrorCode;
} {
  if (error.code === 'UNAUTHORIZED') return { status: 401, code: 'UNAUTHORIZED' };
  if (error.code === 'FORBIDDEN') return { status: 403, code: 'FORBIDDEN' };
  if (error.code === 'NOT_FOUND') return { status: 404, code: 'NOT_FOUND' };
  if (error.code === 'CONFLICT') return { status: 409, code: 'CONFLICT' };
  if (error.code === 'BAD_REQUEST' && error.message === 'Request is not pending') {
    return { status: 409, code: 'CONFLICT' };
  }
  if (error.code === 'BAD_REQUEST') return { status: 400, code: 'BAD_REQUEST' };
  return { status: 500, code: 'INTERNAL_SERVER_ERROR' };
}

export const notificationApproveDomainRequestHandler: RequestHandler = async (req, res, next) => {
  try {
    const requestId = typeof req.body?.requestId === 'string' ? req.body.requestId.trim() : '';
    if (!requestId) {
      sendNotificationActionError(res, 400, 'BAD_REQUEST', 'requestId is required');
      return;
    }

    const context = await createContext({ req, res } as never);
    if (!context.user) {
      sendNotificationActionError(res, 401, 'UNAUTHORIZED', 'Not authenticated');
      return;
    }

    const membership = await getSingleMembershipOrThrow(context.user.sub);
    if (!membership) {
      sendNotificationActionError(res, 403, 'FORBIDDEN', 'No organization membership found');
      return;
    }

    await assertOrganizationEntitled(membership.organizationId);

    const tenantContext: TenantProcedureContext = {
      ...context,
      user: context.user,
      organizationId: membership.organizationId,
      userRole: membership.role,
    };

    await approveTenantRequest(tenantContext, requestId);
    res.status(200).json({ status: 'approved', requestId });
  } catch (error) {
    if (error instanceof TRPCError) {
      const mapped = mapNotificationActionTrpcError(error);
      sendNotificationActionError(res, mapped.status, mapped.code, error.message);
      return;
    }

    next(error);
  }
};
