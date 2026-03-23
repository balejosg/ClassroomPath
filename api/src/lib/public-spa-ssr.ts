import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

type RenderedPublicPage = {
  appHtml: string;
  canonicalPath: '/' | '/pricing';
  description: string;
  title: string;
};

type PublicRendererModule = {
  renderPublicPage: (pathname: string) => RenderedPublicPage | null;
};

type RenderPublicSpaOptions = {
  origin: string;
  pathname: string;
};

export interface PublicSpaRenderer {
  canRender: boolean;
  render(options: RenderPublicSpaOptions): Promise<string | null>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function injectHeadMetadata(indexHtml: string, page: RenderedPublicPage, origin: string): string {
  const titleTag = `<title>${escapeHtml(page.title)}</title>`;
  const canonicalUrl = `${origin}${page.canonicalPath}`;
  const metadata = [
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
  ].join('');

  const withTitle = indexHtml.replace(/<title>[\s\S]*?<\/title>/i, titleTag);
  return withTitle.replace('</head>', `${metadata}</head>`);
}

function injectAppHtml(indexHtml: string, appHtml: string): string {
  return indexHtml.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
}

export function createPublicSpaRenderer(reactSpaPath: string): PublicSpaRenderer {
  const indexHtmlPath = path.join(reactSpaPath, 'index.html');
  const ssrEntryPath = path.join(reactSpaPath, '../dist-ssr/ssr-entry.js');

  if (!fs.existsSync(indexHtmlPath) || !fs.existsSync(ssrEntryPath)) {
    return {
      canRender: false,
      async render() {
        return null;
      },
    };
  }

  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  let rendererPromise: Promise<PublicRendererModule> | null = null;

  const loadRenderer = () => {
    rendererPromise ??= import(pathToFileURL(ssrEntryPath).href) as Promise<PublicRendererModule>;
    return rendererPromise;
  };

  return {
    canRender: true,
    async render(options) {
      const renderer = await loadRenderer();
      const page = renderer.renderPublicPage(options.pathname);
      if (!page) return null;

      const htmlWithHead = injectHeadMetadata(indexHtml, page, options.origin);
      return injectAppHtml(htmlWithHead, page.appHtml);
    },
  };
}
