import { randomBytes, createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { WindowsOfflineDownloadRef } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export interface DownloadRefRecord {
  id: string;
  organizationId: string;
  classroomId: string;
  classroomName: string;
  referenceHash: string;
  artifactSha256: string;
  artifactSize: number;
  maxAttempts: number;
  usedAttempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

export class DownloadReferenceError extends Error {
  readonly code: 'INVALID' | 'EXPIRED' | 'EXHAUSTED' | 'CONSUMED';

  constructor(code: DownloadReferenceError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'DownloadReferenceError';
  }
}

export interface RefsRepoDeps {
  db?: typeof db;
  now?: () => Date;
  randomToken?: (bytes: number) => string;
}

export function hashDownloadReference(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function defaultRandomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export function createWindowsOfflineDownloadRefsService(deps: RefsRepoDeps = {}) {
  const database = deps.db ?? db;
  const now = deps.now ?? (() => new Date());
  const randomToken = deps.randomToken ?? defaultRandomToken;

  async function mintReference(input: {
    organizationId: string;
    classroomId: string;
    classroomName: string;
    createdBy: string;
    artifactSha256: string;
    artifactSize: number;
    ttlMinutes: number;
    maxAttempts: number;
  }): Promise<{ ref: DownloadRefRecord; rawToken: string }> {
    const rawToken = randomToken(32);
    const referenceHash = hashDownloadReference(rawToken);
    const expiresAt = new Date(now().getTime() + input.ttlMinutes * 60_000);

    await database.insert(schema.cpWindowsOfflineDownloadRefs).values({
      organizationId: input.organizationId,
      classroomId: input.classroomId,
      classroomName: input.classroomName,
      referenceHash,
      artifactSha256: input.artifactSha256,
      artifactSize: input.artifactSize,
      maxAttempts: input.maxAttempts,
      expiresAt,
      createdBy: input.createdBy,
    });

    const [row] = await database
      .select()
      .from(schema.cpWindowsOfflineDownloadRefs)
      .where(eq(schema.cpWindowsOfflineDownloadRefs.referenceHash, referenceHash))
      .limit(1);

    return { ref: toRecord(row), rawToken };
  }

  /**
   * Marks the start of one download attempt. `used_attempts` increments even
   * when the connection later drops; the reference stays usable until attempts
   * are exhausted or a download completes.
   */
  async function consumeAttempt(rawToken: string): Promise<DownloadRefRecord> {
    const referenceHash = hashDownloadReference(rawToken);
    const [row] = await database
      .select()
      .from(schema.cpWindowsOfflineDownloadRefs)
      .where(eq(schema.cpWindowsOfflineDownloadRefs.referenceHash, referenceHash))
      .limit(1);

    if (!row) {
      throw new DownloadReferenceError('INVALID', 'Unknown download reference');
    }
    if (row.consumedAt) {
      throw new DownloadReferenceError('CONSUMED', 'Download reference already consumed');
    }
    if (row.expiresAt.getTime() <= now().getTime()) {
      throw new DownloadReferenceError('EXPIRED', 'Download reference expired');
    }
    if (row.usedAttempts >= row.maxAttempts) {
      throw new DownloadReferenceError('EXHAUSTED', 'Download attempt limit reached');
    }

    const [updated] = await database
      .update(schema.cpWindowsOfflineDownloadRefs)
      .set({
        usedAttempts: sql`${schema.cpWindowsOfflineDownloadRefs.usedAttempts} + 1`,
      })
      .where(
        and(
          eq(schema.cpWindowsOfflineDownloadRefs.id, row.id),
          isNull(schema.cpWindowsOfflineDownloadRefs.consumedAt),
          lt(
            schema.cpWindowsOfflineDownloadRefs.usedAttempts,
            schema.cpWindowsOfflineDownloadRefs.maxAttempts
          )
        )
      )
      .returning();

    if (!updated) {
      const [latest] = await database
        .select()
        .from(schema.cpWindowsOfflineDownloadRefs)
        .where(eq(schema.cpWindowsOfflineDownloadRefs.id, row.id))
        .limit(1);
      if (!latest) {
        throw new DownloadReferenceError('INVALID', 'Unknown download reference');
      }
      if (latest.consumedAt) {
        throw new DownloadReferenceError('CONSUMED', 'Download reference already consumed');
      }
      if (latest.usedAttempts >= latest.maxAttempts) {
        throw new DownloadReferenceError('EXHAUSTED', 'Download attempt limit reached');
      }
      throw new DownloadReferenceError('EXPIRED', 'Download reference expired');
    }

    return toRecord(updated);
  }

  /** Invalidates the reference after its first successful full download. */
  async function markConsumed(rawToken: string): Promise<void> {
    const referenceHash = hashDownloadReference(rawToken);
    await database
      .update(schema.cpWindowsOfflineDownloadRefs)
      .set({ consumedAt: now() })
      .where(
        and(
          eq(schema.cpWindowsOfflineDownloadRefs.referenceHash, referenceHash),
          isNull(schema.cpWindowsOfflineDownloadRefs.consumedAt)
        )
      );
  }

  /** Cleans up expired, exhausted, or consumed download references and their artifact files. */
  async function cleanupExpired(artifactsDir: string): Promise<number> {
    const expiredCutoff = now();
    const expiredRows = await database
      .select()
      .from(schema.cpWindowsOfflineDownloadRefs)
      .where(
        or(
          isNotNull(schema.cpWindowsOfflineDownloadRefs.consumedAt),
          lte(schema.cpWindowsOfflineDownloadRefs.expiresAt, expiredCutoff),
          gte(
            schema.cpWindowsOfflineDownloadRefs.usedAttempts,
            schema.cpWindowsOfflineDownloadRefs.maxAttempts
          )
        )
      );

    if (existsSync(artifactsDir)) {
      for (const row of expiredRows) {
        const filePath = path.join(artifactsDir, `${row.referenceHash.slice(0, 32)}.exe`);
        if (existsSync(filePath)) {
          try {
            rmSync(filePath, { force: true });
          } catch {
            logger.warn('offline_installer_cleanup_failed', {
              code: 'offline_installer_cleanup_failed',
            });
          }
        }
      }
    }

    if (expiredRows.length === 0) {
      return 0;
    }

    await database.delete(schema.cpWindowsOfflineDownloadRefs).where(
      inArray(
        schema.cpWindowsOfflineDownloadRefs.id,
        expiredRows.map((r) => r.id)
      )
    );

    return expiredRows.length;
  }

  function toRecord(row: WindowsOfflineDownloadRef): DownloadRefRecord {
    return {
      id: row.id,
      organizationId: row.organizationId,
      classroomId: row.classroomId,
      classroomName: row.classroomName,
      referenceHash: row.referenceHash,
      artifactSha256: row.artifactSha256,
      artifactSize: Number(row.artifactSize),
      maxAttempts: row.maxAttempts,
      usedAttempts: row.usedAttempts,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
    };
  }

  return { mintReference, consumeAttempt, markConsumed, cleanupExpired, now };
}

export type WindowsOfflineDownloadRefsService = ReturnType<
  typeof createWindowsOfflineDownloadRefsService
>;

export function logReferenceFailure(code: string): void {
  // Audit-safe: never logs raw tokens or payload contents.
  logger.warn(`offline_installer_reference_${code.toLowerCase()}`);
}
