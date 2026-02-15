import type { BrowserContext, Page, TestInfo } from '@playwright/test';

type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

export type NavDebugDump = {
  meta: {
    startedAt: string;
    url: string;
    path: string;
    heading: string | null;
  };
  overlays: Array<{
    tag: string;
    role: string | null;
    ariaModal: string | null;
    zIndex: string | null;
    position: string;
    pointerEvents: string;
    display: string;
    visibility: string;
    opacity: string;
    width: number;
    height: number;
    textSnippet: string;
  }>;
  sidebar: Array<{
    label: string;
    disabled: boolean | null;
    ariaCurrent: string | null;
    className: string;
  }>;
  browser: {
    navdbg: JsonValue | null;
  };
  playwright: {
    console: Array<{ t: string; type: string; text: string }>; // includes errors
    pageErrors: Array<{ t: string; message: string }>;
    requestFailed: Array<{ t: string; method: string; url: string; failure: string | null }>;
    badResponses: Array<{ t: string; method: string; url: string; status: number }>;
    frameNavigations: Array<{ t: string; url: string; name: string | null }>;
  };
};

function isoNow(): string {
  return new Date().toISOString();
}

function pushRing<T>(arr: T[], item: T, limit: number): void {
  arr.push(item);
  if (arr.length > limit) {
    arr.splice(0, arr.length - limit);
  }
}

async function installBrowserNavDbg(page: Page, maxEntries: number): Promise<void> {
  await page.addInitScript(
    ({ max }) => {
      const now = () => new Date().toISOString();
      const push = (arr: unknown[], item: unknown) => {
        arr.push(item);
        if (arr.length > max) arr.splice(0, arr.length - max);
      };

      const w = window as unknown as {
        __navdbg?: any;
        __navdbgInstalled?: boolean;
        __navdbgOriginalFetch?: typeof fetch;
      };

      // Re-init navdbg per document so we always have a fresh buffer.
      w.__navdbg = {
        startedAt: now(),
        clicks: [],
        history: [],
        fetches: [],
        errors: [],
        unhandled: [],
        notes: [],
      };

      if (w.__navdbgInstalled) {
        push(w.__navdbg.notes, { t: now(), msg: 'navdbg already installed' });
        return;
      }

      w.__navdbgInstalled = true;
      push(w.__navdbg.notes, { t: now(), msg: 'navdbg installed' });

      // History hooks
      try {
        const origPush = history.pushState.bind(history);
        const origReplace = history.replaceState.bind(history);

        history.pushState = function (state, title, url) {
          try {
            push(w.__navdbg.history, {
              t: now(),
              kind: 'pushState',
              url: String(url),
              path: location.pathname,
              state: state ?? null,
            });
          } catch {}
          return origPush(state, title, url);
        };

        history.replaceState = function (state, title, url) {
          try {
            push(w.__navdbg.history, {
              t: now(),
              kind: 'replaceState',
              url: String(url),
              path: location.pathname,
              state: state ?? null,
            });
          } catch {}
          return origReplace(state, title, url);
        };

        window.addEventListener('popstate', (e) => {
          try {
            push(w.__navdbg.history, {
              t: now(),
              kind: 'popstate',
              path: location.pathname,
              state: (e as PopStateEvent).state ?? null,
            });
          } catch {}
        });
      } catch {}

      // Global errors
      try {
        window.addEventListener('error', (e) => {
          try {
            push(w.__navdbg.errors, {
              t: now(),
              message: String((e as ErrorEvent).message || ''),
              filename: String((e as ErrorEvent).filename || ''),
              lineno: (e as ErrorEvent).lineno || null,
            });
          } catch {}
        });

        window.addEventListener('unhandledrejection', (e) => {
          try {
            push(w.__navdbg.unhandled, {
              t: now(),
              reason: String((e as PromiseRejectionEvent).reason),
            });
          } catch {}
        });
      } catch {}

      // Click capture (esp. sidebar)
      try {
        document.addEventListener(
          'click',
          (e) => {
            try {
              const target = e.target as Element | null;
              const btn = target?.closest?.('button');
              if (!btn) return;
              const inAside = !!target?.closest?.('aside, [role="complementary"]');
              const label = (btn.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120);
              push(w.__navdbg.clicks, {
                t: now(),
                inAside,
                label,
                defaultPrevented: (e as MouseEvent).defaultPrevented,
                path: location.pathname,
              });
            } catch {}
          },
          true
        );
      } catch {}

      // Fetch wrapper (API calls only)
      try {
        if (!w.__navdbgOriginalFetch) {
          w.__navdbgOriginalFetch = window.fetch.bind(window);
        }

        window.fetch = async (...args) => {
          const started = Date.now();
          const input = args[0] as any;
          const init = (args[1] || {}) as RequestInit;
          const method = String(init.method || 'GET').toUpperCase();
          const url =
            typeof input === 'string' ? input : input?.url ? String(input.url) : String(input);
          try {
            const res = await w.__navdbgOriginalFetch!(...args);
            if (url.includes('/cp/trpc/') || url.includes('/trpc/')) {
              push(w.__navdbg.fetches, {
                t: now(),
                method,
                url: url.split('?')[0],
                status: res.status,
                ms: Date.now() - started,
              });
            }
            return res;
          } catch (err) {
            if (url.includes('/cp/trpc/') || url.includes('/trpc/')) {
              push(w.__navdbg.fetches, {
                t: now(),
                method,
                url: url.split('?')[0],
                status: 'ERR',
                ms: Date.now() - started,
              });
            }
            throw err;
          }
        };
      } catch {}
    },
    { max: maxEntries }
  );
}

export class NavigationDebugger {
  private readonly page: Page;
  private readonly context: BrowserContext;
  private readonly maxEntries: number;
  private readonly enabled: boolean;
  private readonly consoleLogs: Array<{ t: string; type: string; text: string }> = [];
  private readonly pageErrors: Array<{ t: string; message: string }> = [];
  private readonly requestFailed: Array<{
    t: string;
    method: string;
    url: string;
    failure: string | null;
  }> = [];
  private readonly badResponses: Array<{ t: string; method: string; url: string; status: number }> =
    [];
  private readonly frameNavigations: Array<{ t: string; url: string; name: string | null }> = [];

  constructor(
    page: Page,
    context: BrowserContext,
    opts?: { maxEntries?: number; enabled?: boolean }
  ) {
    this.page = page;
    this.context = context;
    this.maxEntries = opts?.maxEntries ?? 250;
    this.enabled = opts?.enabled ?? true;
  }

  async install(): Promise<void> {
    if (!this.enabled) return;
    await installBrowserNavDbg(this.page, this.maxEntries);

    this.page.on('console', (msg) => {
      // Keep all console types; errors are especially important.
      pushRing(
        this.consoleLogs,
        { t: isoNow(), type: msg.type(), text: msg.text() },
        this.maxEntries
      );
    });

    this.page.on('pageerror', (err) => {
      pushRing(
        this.pageErrors,
        { t: isoNow(), message: String(err?.message || err) },
        this.maxEntries
      );
    });

    this.page.on('requestfailed', (req) => {
      const url = req.url();
      if (!url.includes('/cp/trpc/') && !url.includes('/trpc/')) return;
      pushRing(
        this.requestFailed,
        {
          t: isoNow(),
          method: req.method(),
          url: url.split('?')[0],
          failure: req.failure()?.errorText ?? null,
        },
        this.maxEntries
      );
    });

    this.page.on('response', (res) => {
      const url = res.url();
      if (!url.includes('/cp/trpc/') && !url.includes('/trpc/')) return;
      if (res.status() >= 400) {
        pushRing(
          this.badResponses,
          {
            t: isoNow(),
            method: res.request().method(),
            url: url.split('?')[0],
            status: res.status(),
          },
          this.maxEntries
        );
      }
    });

    this.page.on('framenavigated', (frame) => {
      // Keep main frame + any iframe navigations.
      pushRing(
        this.frameNavigations,
        { t: isoNow(), url: frame.url(), name: frame.name() || null },
        this.maxEntries
      );
    });

    // Ensure we don't keep stale references across context reuse.
    this.context.on('page', () => {
      // no-op, but keeps a place to extend later.
    });
  }

  async dump(): Promise<NavDebugDump> {
    const page = this.page;

    const browserState = await page
      .evaluate(() => {
        const heading = document.querySelector('header h1,[role="banner"] h1')?.textContent || null;
        const overlays = [
          ...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .fixed'),
        ]
          .map((el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName,
              role: el.getAttribute('role'),
              ariaModal: el.getAttribute('aria-modal'),
              zIndex: s.zIndex,
              position: s.position,
              pointerEvents: s.pointerEvents,
              display: s.display,
              visibility: s.visibility,
              opacity: s.opacity,
              width: Math.round(r.width),
              height: Math.round(r.height),
              textSnippet: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
            };
          })
          .filter((o) => o.position === 'fixed' || o.role === 'dialog' || o.ariaModal === 'true')
          .sort((a, b) => Number(b.zIndex || 0) - Number(a.zIndex || 0))
          .slice(0, 12);

        const sidebar = [
          ...document.querySelectorAll('aside button, [role="complementary"] button'),
        ]
          .map((b) => ({
            label: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
            disabled: b instanceof HTMLButtonElement ? b.disabled : null,
            ariaCurrent: b.getAttribute('aria-current'),
            className: (b.className || '').slice(0, 160),
          }))
          .filter((x) =>
            /Panel de Control|Aulas Seguras|Políticas de Grupo|Usuarios y Roles|Control de Dominios|Configuración|Cerrar Sesión/.test(
              x.label
            )
          );

        const navdbg = (window as any).__navdbg ?? null;

        return {
          url: location.href,
          path: location.pathname,
          heading,
          overlays,
          sidebar,
          navdbg,
        };
      })
      .catch(() => null);

    const url = page.url();
    const path = page.url().split('#')[0].split('?')[0];

    return {
      meta: {
        startedAt: isoNow(),
        url,
        path,
        heading: browserState?.heading ?? null,
      },
      overlays: browserState?.overlays ?? [],
      sidebar: browserState?.sidebar ?? [],
      browser: {
        navdbg: (browserState?.navdbg as JsonValue) ?? null,
      },
      playwright: {
        console: this.consoleLogs.slice(-this.maxEntries),
        pageErrors: this.pageErrors.slice(-this.maxEntries),
        requestFailed: this.requestFailed.slice(-this.maxEntries),
        badResponses: this.badResponses.slice(-this.maxEntries),
        frameNavigations: this.frameNavigations.slice(-this.maxEntries),
      },
    };
  }

  async attachOnFailure(testInfo: TestInfo): Promise<void> {
    const failed = testInfo.status !== testInfo.expectedStatus;
    if (!failed) return;
    if (!this.enabled) return;

    const dump = await this.dump();
    const json = JSON.stringify(dump, null, 2);
    await testInfo.attach('nav-debug.json', {
      body: Buffer.from(json, 'utf-8'),
      contentType: 'application/json',
    });
  }
}
