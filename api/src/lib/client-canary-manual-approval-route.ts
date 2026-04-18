import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { approveManualBillingRequest } from '../services/billing.service.js';

const CANARY_MARKER = '[client-canary]';

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function extractPresentedToken(
  authorization: string | undefined,
  headerToken: unknown
): string | null {
  const bearerPrefix = 'Bearer ';
  if (authorization?.startsWith(bearerPrefix)) {
    return trimToNull(authorization.slice(bearerPrefix.length));
  }

  return typeof headerToken === 'string' ? trimToNull(headerToken) : null;
}

function tokenMatches(expected: string, presented: string | null): boolean {
  if (!presented) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const presentedBuffer = Buffer.from(presented);
  return (
    expectedBuffer.length === presentedBuffer.length &&
    timingSafeEqual(expectedBuffer, presentedBuffer)
  );
}

function isCanaryRequest(request: { organizationName: string; note: string | null }): boolean {
  return (
    request.organizationName.includes(CANARY_MARKER) || (request.note ?? '').includes(CANARY_MARKER)
  );
}

export const clientCanaryManualBillingApprovalHandler: RequestHandler = async (req, res, next) => {
  try {
    const configuredToken = trimToNull(process.env.CP_CLIENT_CANARY_ADMIN_TOKEN);
    const presentedToken = extractPresentedToken(
      req.get('authorization'),
      req.get('x-classroompath-canary-token')
    );

    if (!configuredToken || !tokenMatches(configuredToken, presentedToken)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const requestId = trimToNull(firstString(req.params.requestId));
    if (!requestId) {
      res.status(400).json({ error: 'request_id_required' });
      return;
    }

    const [request] = await db
      .select({
        id: schema.cpBillingManualRequests.id,
        organizationName: schema.cpBillingManualRequests.organizationName,
        note: schema.cpBillingManualRequests.note,
        status: schema.cpBillingManualRequests.status,
      })
      .from(schema.cpBillingManualRequests)
      .where(eq(schema.cpBillingManualRequests.id, requestId))
      .limit(1);

    if (!request) {
      res.status(404).json({ error: 'manual_request_not_found' });
      return;
    }

    if (request.status !== 'pending') {
      res.status(409).json({ error: 'manual_request_not_pending' });
      return;
    }

    if (!isCanaryRequest(request)) {
      res.status(403).json({ error: 'manual_request_not_canary_scoped' });
      return;
    }

    const result = await approveManualBillingRequest({
      requestId,
      reviewedBy: 'system:client-canary',
      resolutionNote: 'Automated production client canary manual billing approval',
    });

    res.json({
      status: 'approved',
      organizationId: result.organizationId,
    });
  } catch (error) {
    next(error);
  }
};
