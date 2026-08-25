import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  MAX_WINDOWS_OFFLINE_INSTALLER_CAPTIVE_PORTAL_DOMAINS,
  MAX_WINDOWS_OFFLINE_INSTALLER_CAPTIVE_PORTAL_DOMAIN_LENGTH,
  WINDOWS_OFFLINE_INSTALLER_SCHEMA_VERSION,
  WINDOWS_OFFLINE_INSTALLER_CONFIG_SCHEMA as windowsOfflineInstallerConfigSchema,
} from '../openpath/windows-offline-installer.js';
import { z } from 'zod';

import { getClassroomById } from '../db/openpath-repos/classrooms.repo.js';
import { assertOrgClassroomAccess } from '../lib/tenant-access.js';
import { applyWindowsOfflineOverlay } from '../lib/windows-offline-installer-overlay.js';
import { loadWindowsOfflineInstallerConfig } from '../lib/windows-offline-installer-config.js';
import { callOpenPathEnrollmentTicket } from '../lib/windows-offline-installer-ticket-client.js';
import { logger } from '../lib/logger.js';
import {
  loadCachedWindowsOfflineTemplate,
  WindowsOfflineTemplateCacheError,
} from './windows-offline-installer-template-cache.service.js';
import {
  createWindowsOfflineDownloadRefsService,
  type WindowsOfflineDownloadRefsService,
} from './windows-offline-installer-download-refs.service.js';
import { recordWindowsOfflineInstallerGeneration } from './windows-offline-installer-audit.service.js';

export class WindowsOfflineInstallerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'WindowsOfflineInstallerError';
  }
}

export interface GenerateWindowsOfflineInstallerInput {
  organizationId: string;
  actorUserId: string;
  classroomId: string;
}

export interface WindowsOfflineInstallerArtifact {
  fileName: string;
  version: string;
  sha256: string;
  tokenExpiresAt: string;
  downloadUrl: string;
  artifactPath: string;
  reference: string;
  expiresAt: Date;
}

export interface ArtifactServiceDeps {
  refs?: WindowsOfflineDownloadRefsService;
  ticketClient?: typeof callOpenPathEnrollmentTicket;
  now?: () => Date;
  assertAccess?: typeof assertOrgClassroomAccess;
  findClassroom?: typeof getClassroomById;
  renameArtifact?: typeof renameSync;
}

const TTL_TOLERANCE_MS = 5 * 60 * 1000;

export function sanitizeWindowsInstallerFileName(classroomName: string): string {
  const sanitized = classroomName
    .normalize('NFKD')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F]/g, '')
    .replace(/[^A-Za-z0-9 _.-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80);

  const safeName = sanitized.length > 0 ? sanitized : 'classroom';
  return `OpenPath-${safeName.replace(/\s+/g, '-')}-Windows-Setup.exe`;
}

export function createWindowsOfflineInstallerService(deps: ArtifactServiceDeps = {}) {
  const refs = deps.refs ?? createWindowsOfflineDownloadRefsService();
  const ticketClient = deps.ticketClient ?? callOpenPathEnrollmentTicket;
  const now = deps.now ?? (() => new Date());
  const assertAccess = deps.assertAccess ?? assertOrgClassroomAccess;
  const findClassroom = deps.findClassroom ?? getClassroomById;
  const renameArtifact = deps.renameArtifact ?? renameSync;

  function resolveTemplateDir(config = loadWindowsOfflineInstallerConfig()): string {
    return config.templateDir;
  }

  async function generate(
    input: GenerateWindowsOfflineInstallerInput,
    authContext: { accessToken?: string | null }
  ): Promise<WindowsOfflineInstallerArtifact> {
    let config: ReturnType<typeof loadWindowsOfflineInstallerConfig>;
    try {
      config = loadWindowsOfflineInstallerConfig();
    } catch {
      logger.error('offline_installer_config_invalid');
      throw new WindowsOfflineInstallerError(
        'CONFIG_INVALID',
        'Offline installer configuration invalid'
      );
    }

    await assertAccess(input.organizationId, input.classroomId);

    const classroom = await findClassroom(input.classroomId);
    if (!classroom) {
      throw new WindowsOfflineInstallerError('NOT_FOUND', 'Classroom not found');
    }

    if (!authContext.accessToken) {
      throw new WindowsOfflineInstallerError('UNAUTHORIZED', 'Upstream authorization missing');
    }

    const requestedExpiresIn = `${config.tokenTtlHours}h`;
    const issuedAtBeforeMs = now().getTime();
    const ticket = await ticketClient({
      openpathUrl: config.openpathUrl,
      classroomId: input.classroomId,
      expiresIn: requestedExpiresIn,
      accessToken: authContext.accessToken,
    });
    const issuedTtlMs = Date.parse(ticket.expiresAt) - issuedAtBeforeMs;
    const expectedTicketTtlMs = config.tokenTtlHours * 60 * 60 * 1000;
    if (
      !Number.isFinite(issuedTtlMs) ||
      Math.abs(issuedTtlMs - expectedTicketTtlMs) > TTL_TOLERANCE_MS
    ) {
      throw new WindowsOfflineInstallerError(
        'UPSTREAM_TTL',
        'OpenPath did not issue the requested enrollment token lifetime'
      );
    }

    let template: ReturnType<typeof loadCachedWindowsOfflineTemplate>;
    try {
      template = loadCachedWindowsOfflineTemplate(config.templateDir, {
        version: config.templateVersion,
        commit: config.templateCommit,
        sha256: config.templateSha256,
      });
    } catch (error) {
      const templateErrorCode =
        error instanceof WindowsOfflineTemplateCacheError &&
        !['TEMPLATE_MISSING', 'SIDECAR_MISSING'].includes(error.code)
          ? 'TEMPLATE_INVALID'
          : 'TEMPLATE_UNAVAILABLE';
      logger.error(
        error instanceof WindowsOfflineTemplateCacheError
          ? `offline_installer_${error.code.toLowerCase()}`
          : 'offline_installer_template_unavailable',
        { templateVersion: config.templateVersion }
      );
      throw new WindowsOfflineInstallerError(
        templateErrorCode,
        templateErrorCode === 'TEMPLATE_INVALID'
          ? 'Template cache invalid'
          : 'Template cache unavailable'
      );
    }

    const payloadConfig = windowsOfflineInstallerConfigSchema.parse({
      schemaVersion: WINDOWS_OFFLINE_INSTALLER_SCHEMA_VERSION,
      apiUrl: config.openpathUrl,
      classroomId: input.classroomId,
      enrollmentToken: ticket.enrollmentToken,
      enrollmentTokenExpiresAt: ticket.expiresAt,
      captivePortalDomains: readCaptivePortalDomains(classroom),
      options: {
        approvedStudentBrowsers: ['Firefox'],
        installFirefoxIfMissing: true,
        enforceManagedBrowserBoundary: true,
      },
    });

    const artifactsDir = config.artifactsDir;
    try {
      mkdirSync(artifactsDir, { recursive: true });
    } catch {
      logger.error('offline_installer_artifacts_not_writable', {
        templateVersion: config.templateVersion,
      });
      throw new WindowsOfflineInstallerError(
        'ARTIFACTS_UNAVAILABLE',
        'Offline installer artifact storage unavailable'
      );
    }

    refs.cleanupExpired?.(artifactsDir).catch(() => undefined);

    const stagingPath = path.join(
      artifactsDir,
      `.${Date.now().toString(36)}-${process.pid}.staging.exe`
    );

    try {
      await applyWindowsOfflineOverlay(template.filePath, stagingPath, payloadConfig);
    } catch {
      rmSync(stagingPath, { force: true });
      logger.error('offline_installer_overlay_failed', {
        templateVersion: config.templateVersion,
      });
      throw new WindowsOfflineInstallerError('OVERLAY_FAILED', 'Template customization failed');
    }

    let artifactBytes: Buffer;
    try {
      artifactBytes = readFileSync(stagingPath);
    } catch {
      rmSync(stagingPath, { force: true });
      logger.error('offline_installer_artifact_read_failed', {
        templateVersion: config.templateVersion,
      });
      throw new WindowsOfflineInstallerError(
        'ARTIFACT_READ_FAILED',
        'Installer artifact unavailable'
      );
    }
    const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex');
    const artifactSize = artifactBytes.length;

    let minted: Awaited<ReturnType<typeof refs.mintReference>>;
    try {
      minted = await refs.mintReference({
        organizationId: input.organizationId,
        classroomId: input.classroomId,
        classroomName: classroom.name,
        createdBy: input.actorUserId,
        artifactSha256,
        artifactSize,
        ttlMinutes: config.downloadRefTtlMinutes,
        maxAttempts: config.downloadRefMaxAttempts,
      });
    } catch {
      rmSync(stagingPath, { force: true });
      logger.error('offline_installer_reference_mint_failed', {
        templateVersion: config.templateVersion,
      });
      throw new WindowsOfflineInstallerError(
        'REFERENCE_MINT_FAILED',
        'Could not mint download reference'
      );
    }

    const publishedPath = path.join(artifactsDir, `${minted.ref.referenceHash.slice(0, 32)}.exe`);
    try {
      renameArtifact(stagingPath, publishedPath);
    } catch {
      rmSync(stagingPath, { force: true });
      try {
        await refs.invalidateReference?.(minted.rawToken);
      } catch {
        logger.error('offline_installer_reference_invalidate_failed', {
          templateVersion: config.templateVersion,
        });
      }
      logger.error('offline_installer_artifact_publish_failed', {
        templateVersion: config.templateVersion,
      });
      throw new WindowsOfflineInstallerError(
        'ARTIFACT_PUBLISH_FAILED',
        'Installer artifact could not be published'
      );
    }

    await recordWindowsOfflineInstallerGeneration({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      classroomId: input.classroomId,
      templateVersion: template.version,
      templateCommit: template.commit,
      templateSha256: template.sha256,
      artifactSha256,
      artifactSize,
      tokenExpiresAt: ticket.expiresAt,
    }).catch(() => undefined);

    return {
      fileName: sanitizeWindowsInstallerFileName(classroom.name),
      version: template.version,
      sha256: artifactSha256,
      tokenExpiresAt: ticket.expiresAt,
      downloadUrl: `/cp/api/windows-offline-installer/download?ref=${encodeURIComponent(minted.rawToken)}`,
      artifactPath: publishedPath,
      reference: minted.rawToken,
      expiresAt: minted.ref.expiresAt,
    };
  }

  return { generate, refs, resolveTemplateDir };
}

const CAPTIVE_DOMAIN_SCHEMA = z
  .array(z.string().min(1).max(MAX_WINDOWS_OFFLINE_INSTALLER_CAPTIVE_PORTAL_DOMAIN_LENGTH))
  .max(MAX_WINDOWS_OFFLINE_INSTALLER_CAPTIVE_PORTAL_DOMAINS)
  .catch([]);

function readCaptivePortalDomains(classroom: { captivePortalDomains?: unknown }): string[] {
  return CAPTIVE_DOMAIN_SCHEMA.parse(classroom.captivePortalDomains);
}

export function hashArtifactFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function ensureArtifactsDir(artifactsDir: string): string {
  if (!existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true });
  }
  return artifactsDir;
}
