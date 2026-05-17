import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

type RenderedPublicPage = {
  appHtml: string;
  canonicalPath: '/' | '/pricing';
  description: string;
  title: string;
};

export type ProductLocale = 'en' | 'es';

type PublicRendererModule = {
  renderPublicPage: (options: {
    pathname: string;
    locale: ProductLocale;
  }) => RenderedPublicPage | null;
};

type RenderPublicSpaOptions = {
  locale: ProductLocale;
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

function injectLocale(indexHtml: string, locale: ProductLocale): string {
  return indexHtml.replace(/<html([^>]*)>/i, (_match, attributes: string) => {
    const withoutLang = attributes.replace(/\s+lang=(?:"[^"]*"|'[^']*'|[^\s>]*)/i, '');
    return `<html${withoutLang} lang="${locale}">`;
  });
}

function injectAppHtml(indexHtml: string, appHtml: string, locale: ProductLocale): string {
  const hydrationState = `<script>window.__CLASSROOMPATH_PRODUCT_LOCALE__=${JSON.stringify(locale)};</script>`;
  return indexHtml.replace(
    '<div id="root"></div>',
    `<div id="root" data-classroompath-public-ssr="true" data-classroompath-locale="${locale}" data-product-locale="${locale}">${appHtml}</div>${hydrationState}`
  );
}

export function resolveProductLocaleFromAcceptLanguage(
  acceptLanguage: string | string[] | undefined
): ProductLocale {
  const headerValue = Array.isArray(acceptLanguage) ? acceptLanguage.join(',') : acceptLanguage;
  if (!headerValue) return 'en';

  const candidates = headerValue
    .split(',')
    .map((entry) => {
      const [language = '', ...params] = entry.trim().split(';');
      const qParam = params.find((param) => param.trim().toLowerCase().startsWith('q='));
      const parsedQ = qParam ? Number.parseFloat(qParam.split('=')[1] ?? '') : 1;
      return {
        language: language.trim().toLowerCase(),
        q: Number.isFinite(parsedQ) ? parsedQ : 0,
      };
    })
    .filter((candidate) => candidate.language.length > 0 && candidate.q > 0)
    .sort((left, right) => right.q - left.q);

  for (const candidate of candidates) {
    const [baseLocale = ''] = candidate.language.split('-');
    if (baseLocale === 'en' || baseLocale === 'es') {
      return baseLocale;
    }
  }

  return 'en';
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
      const page = renderer.renderPublicPage({
        pathname: options.pathname,
        locale: options.locale,
      });
      if (!page) return null;

      const htmlWithLocale = injectLocale(indexHtml, options.locale);
      const htmlWithHead = injectHeadMetadata(htmlWithLocale, page, options.origin);
      return injectAppHtml(htmlWithHead, page.appHtml, options.locale);
    },
  };
}
