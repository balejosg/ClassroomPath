import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { desc, eq } from 'drizzle-orm';

import { db, schema } from '../db/index.js';
import { openpathDb, requests, whitelistGroups, whitelistRules } from '../db/openpath.js';
import { approveManualBillingRequest } from '../services/billing.service.js';
import { config } from '../config.js';

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

function extractExpectedHosts(hostQuery: unknown): string[] {
  const rawValues = Array.isArray(hostQuery) ? hostQuery : [hostQuery];
  return [
    ...new Set(
      rawValues
        .flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    ),
  ].slice(0, 20);
}

function serializeTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : String(value);
}

function expectedHostState(
  expectedHosts: string[],
  rows: {
    rules: { value: string; type: string }[];
    requests: { domain: string; status: string; createdAt: Date | string | null }[];
  }
) {
  return Object.fromEntries(
    expectedHosts.map((host) => {
      const normalizedHost = host.toLowerCase();
      const matchingRules = rows.rules.filter(
        (rule) => rule.type === 'whitelist' && rule.value.toLowerCase() === normalizedHost
      );
      const matchingRequests = rows.requests.filter(
        (request) => request.domain.toLowerCase() === normalizedHost
      );

      return [
        host,
        {
          whitelistRulePresent: matchingRules.length > 0,
          requestCount: matchingRequests.length,
          requestStatuses: matchingRequests.map((request) => ({
            status: request.status,
            createdAt: serializeTimestamp(request.createdAt),
          })),
        },
      ];
    })
  );
}

export const clientCanaryManualBillingApprovalHandler: RequestHandler = async (req, res, next) => {
  try {
    const configuredToken = config.clientCanaryAdminToken;
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

export const clientCanaryGroupDiagnosticsHandler: RequestHandler = async (req, res, next) => {
  try {
    const configuredToken = config.clientCanaryAdminToken;
    const presentedToken = extractPresentedToken(
      req.get('authorization'),
      req.get('x-classroompath-canary-token')
    );

    if (!configuredToken || !tokenMatches(configuredToken, presentedToken)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const groupId = trimToNull(firstString(req.params.groupId));
    if (!groupId) {
      res.status(400).json({ error: 'group_id_required' });
      return;
    }

    const expectedHosts = extractExpectedHosts(req.query.host);
    const [group] = await openpathDb
      .select({
        id: whitelistGroups.id,
        name: whitelistGroups.name,
        displayName: whitelistGroups.displayName,
        enabled: whitelistGroups.enabled,
      })
      .from(whitelistGroups)
      .where(eq(whitelistGroups.id, groupId))
      .limit(1);

    if (!group) {
      res.status(404).json({ error: 'group_not_found' });
      return;
    }

    const [ruleRows, requestRows] = await Promise.all([
      openpathDb
        .select({
          id: whitelistRules.id,
          type: whitelistRules.type,
          value: whitelistRules.value,
          comment: whitelistRules.comment,
          createdAt: whitelistRules.createdAt,
        })
        .from(whitelistRules)
        .where(eq(whitelistRules.groupId, groupId))
        .orderBy(desc(whitelistRules.createdAt))
        .limit(200),
      openpathDb
        .select({
          id: requests.id,
          domain: requests.domain,
          reason: requests.reason,
          status: requests.status,
          requesterEmail: requests.requesterEmail,
          createdAt: requests.createdAt,
          updatedAt: requests.updatedAt,
          resolvedAt: requests.resolvedAt,
          resolvedBy: requests.resolvedBy,
          resolutionNote: requests.resolutionNote,
        })
        .from(requests)
        .where(eq(requests.groupId, groupId))
        .orderBy(desc(requests.createdAt))
        .limit(200),
    ]);

    const rules = ruleRows.map((rule) => ({
      ...rule,
      createdAt: serializeTimestamp(rule.createdAt),
    }));
    const groupRequests = requestRows.map((request) => ({
      ...request,
      createdAt: serializeTimestamp(request.createdAt),
      updatedAt: serializeTimestamp(request.updatedAt),
      resolvedAt: serializeTimestamp(request.resolvedAt),
    }));

    res.json({
      status: 'ok',
      groupId,
      collectedAt: new Date().toISOString(),
      expectedHosts,
      group,
      rules,
      requests: groupRequests,
      expectedHostState: expectedHostState(expectedHosts, {
        rules: ruleRows,
        requests: requestRows,
      }),
    });
  } catch (error) {
    next(error);
  }
};
