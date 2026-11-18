/**
 * Read-only fleet health route for the operator canary view.
 *
 * `GET /cp/internal/client-canary/fleet-health?hostname=<pc>&hostname=<pc>`
 * returns the latest classroom health report for each requested hostname. It
 * is mounted under the token-protected internal canary namespace and exists so
 * the operator machine can see reports without holding the admin token that
 * approves billing requests.
 *
 * Non-obvious constraint: the token is read through `config.fleetHealthReadToken`
 * and not from `process.env` directly, so the singleton config stays the only
 * environment reader (this module's test scans the source text for that).
 */
import { timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { and, eq, inArray, max } from 'drizzle-orm';

import { healthReports, openpathDb } from '../db/openpath.js';
import { config } from '../config.js';

export const FLEET_HEALTH_MAX_HOSTNAMES = 50;

export interface FleetHealthReport {
  status: string;
  reasonCodes: string[];
  version: string | null;
  reportedAt: string | null;
}

export type FleetHealthLookup = (hostnames: string[]) => Promise<Record<string, FleetHealthReport>>;

export interface ClientCanaryFleetHealthOptions {
  lookup?: FleetHealthLookup;
  readToken?: () => string | null;
}

function trimToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function extractPresentedToken(req: Request): string | null {
  const authorization = req.get('authorization');
  const bearerPrefix = 'Bearer ';
  if (authorization?.startsWith(bearerPrefix)) {
    return trimToNull(authorization.slice(bearerPrefix.length));
  }

  return trimToNull(req.get('x-classroompath-fleet-health-token'));
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

function normalizeHostnames(query: unknown): { hostnames: string[]; overflow: boolean } {
  const rawValues = Array.isArray(query) ? query : [query];
  const seen = new Set<string>();
  for (const value of rawValues.flatMap((item) =>
    typeof item === 'string' ? item.split(',') : []
  )) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length > 0 && normalized.length <= 255) {
      seen.add(normalized);
    }
  }

  const hostnames = [...seen];
  return {
    hostnames: hostnames.slice(0, FLEET_HEALTH_MAX_HOSTNAMES),
    overflow: hostnames.length > FLEET_HEALTH_MAX_HOSTNAMES,
  };
}

function serializeTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : String(value);
}

async function lookupLatestHealthReports(
  hostnames: string[]
): Promise<Record<string, FleetHealthReport>> {
  if (hostnames.length === 0) {
    return {};
  }

  const latest = openpathDb
    .select({
      hostname: healthReports.hostname,
      reportedAt: max(healthReports.reportedAt).as('reported_at'),
    })
    .from(healthReports)
    .where(inArray(healthReports.hostname, hostnames))
    .groupBy(healthReports.hostname)
    .as('latest_health_reports');

  const rows = await openpathDb
    .select({
      hostname: healthReports.hostname,
      status: healthReports.status,
      reasonCodes: healthReports.reasonCodes,
      version: healthReports.version,
      reportedAt: healthReports.reportedAt,
    })
    .from(healthReports)
    .innerJoin(
      latest,
      and(
        eq(healthReports.hostname, latest.hostname),
        eq(healthReports.reportedAt, latest.reportedAt)
      )
    )
    .where(inArray(healthReports.hostname, hostnames));

  const reports: Record<string, FleetHealthReport> = {};
  for (const row of rows) {
    const hostname = row.hostname.trim().toLowerCase();
    if (reports[hostname]) {
      continue;
    }
    reports[hostname] = {
      status: row.status,
      reasonCodes: row.reasonCodes ?? [],
      version: row.version ?? null,
      reportedAt: serializeTimestamp(row.reportedAt),
    };
  }

  return reports;
}

export function createClientCanaryFleetHealthHandler(
  options: ClientCanaryFleetHealthOptions = {}
): RequestHandler {
  const lookup = options.lookup ?? lookupLatestHealthReports;
  const readToken = options.readToken ?? (() => config.fleetHealthReadToken);

  return async (req, res, next) => {
    try {
      const expectedToken = readToken();
      const presentedToken = extractPresentedToken(req);
      if (!expectedToken || !tokenMatches(expectedToken, presentedToken)) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }

      const { hostnames, overflow } = normalizeHostnames(req.query.hostname);
      if (overflow) {
        res.status(400).json({ error: 'too_many_hostnames' });
        return;
      }
      if (hostnames.length === 0) {
        res.status(400).json({ error: 'hostname_required' });
        return;
      }

      const found = await lookup(hostnames);
      const reports: Record<string, FleetHealthReport> = {};
      for (const hostname of hostnames) {
        const report = found[hostname];
        if (!report) {
          continue;
        }
        reports[hostname] = {
          status: report.status,
          reasonCodes: report.reasonCodes,
          version: report.version,
          reportedAt: serializeTimestamp(report.reportedAt),
        };
      }

      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.json({ reports });
    } catch (error) {
      next(error);
    }
  };
}

export const clientCanaryFleetHealthHandler = createClientCanaryFleetHealthHandler();
