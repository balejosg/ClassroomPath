import express, { type Express } from 'express';
import fs from 'fs';
import path from 'path';

import { logger } from '../logger.js';
import { createPublicSpaRenderer } from '../public-spa-ssr.js';

export interface GatewaySpaRoutesOptions {
  reactSpaPath: string;
}

export function registerGatewaySpaRoutes(app: Express, options: GatewaySpaRoutesOptions): void {
  if (!fs.existsSync(options.reactSpaPath)) {
    logger.warn('ClassroomPath React SPA dist not found', { path: options.reactSpaPath });
    return;
  }

  logger.info('Serving ClassroomPath public SSR routes from SPA build artifacts', {
    path: options.reactSpaPath,
  });
  const publicSpaRenderer = createPublicSpaRenderer(options.reactSpaPath);
  const spaShellPath = path.join(options.reactSpaPath, 'index.html');

  app.get(['/', '/pricing', '/pricing/'], async (req, res) => {
    if (publicSpaRenderer.canRender) {
      try {
        const origin = `${req.protocol}://${req.get('host') ?? 'localhost'}`;
        const renderedHtml = await publicSpaRenderer.render({
          origin,
          pathname: req.path,
        });

        if (renderedHtml) {
          res.type('html').send(renderedHtml);
          return;
        }
      } catch (error) {
        logger.warn('ClassroomPath public SSR failed, falling back to SPA shell', {
          error: error instanceof Error ? error.message : String(error),
          path: req.path,
        });
      }
    }

    res.sendFile(spaShellPath);
  });

  app.use(express.static(options.reactSpaPath, { index: false }));

  app.get(/.*/, (req, res) => {
    if (
      !req.url.startsWith('/cp/') &&
      !req.url.startsWith('/api') &&
      !req.url.startsWith('/trpc')
    ) {
      res.sendFile(spaShellPath);
      return;
    }

    res.status(404).json({ error: 'Not found' });
  });
}
