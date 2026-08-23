import { createReadStream, existsSync, rmSync, statSync } from 'node:fs';
import type { RequestHandler } from 'express';
import {
  DownloadReferenceError,
  type WindowsOfflineDownloadRefsService,
} from '../services/windows-offline-installer-download-refs.service.js';
import { sanitizeWindowsInstallerFileName } from '../services/windows-offline-installer-artifact.service.js';
import { logger } from './logger.js';

export interface WindowsOfflineInstallerRouteDeps {
  refs: Pick<WindowsOfflineDownloadRefsService, 'consumeAttempt' | 'markConsumed'>;
  resolveArtifactPath: (referenceHash: string) => string;
}

const STATUS_BY_CODE: Record<DownloadReferenceError['code'], number> = {
  INVALID: 404,
  EXPIRED: 410,
  EXHAUSTED: 410,
  CONSUMED: 410,
};

/**
 * Builds the authenticated binary download handler. The opaque short-lived
 * reference is the credential; the attempt counter increments when the
 * connection starts and the reference is invalidated only after a successful
 * full transfer.
 */
export function createWindowsOfflineInstallerDownloadHandler(
  deps: WindowsOfflineInstallerRouteDeps
): RequestHandler {
  return (req, res) => {
    const reference = req.query.ref;
    if (typeof reference !== 'string' || reference.length === 0) {
      res.status(400).json({ error: 'Missing download reference' });
      return;
    }

    deps.refs
      .consumeAttempt(reference)
      .then(async (record) => {
        const artifactPath = deps.resolveArtifactPath(record.referenceHash);
        if (!existsSync(artifactPath) || !statSync(artifactPath).isFile()) {
          logger.warn('Offline installer artifact missing for an active reference');
          res.status(404).json({ error: 'Installer artifact unavailable' });
          return;
        }

        const fileName = sanitizeWindowsInstallerFileName(record.classroomName);
        res.status(200);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(artifactPath).size));
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        const stream = createReadStream(artifactPath);
        stream.on('error', (error) => {
          logger.warn(`Offline installer download failed before completion: ${error.message}`);
          res.destroy(error);
        });
        stream.on('end', () => {
          deps.refs
            .markConsumed(reference)
            .then(() => {
              if (existsSync(artifactPath)) {
                try {
                  rmSync(artifactPath, { force: true });
                } catch {
                  // ignore
                }
              }
            })
            .catch((error: unknown) => {
              logger.error(`Could not mark offline installer reference consumed: ${String(error)}`);
            });
        });
        stream.pipe(res);
      })
      .catch((error: unknown) => {
        if (error instanceof DownloadReferenceError) {
          res.status(STATUS_BY_CODE[error.code]).json({ error: error.message });
          return;
        }
        logger.error(`Offline installer download crashed: ${String(error)}`);
        res.status(500).json({ error: 'Download failed' });
      });
  };
}
