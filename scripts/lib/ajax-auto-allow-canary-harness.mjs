import { createServer } from 'node:http';

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);
const MINIMAL_WOFF2 = Buffer.from('d09GMgABAAAAAA==', 'base64');

export function buildAjaxAutoAllowProbeUrl(probe, port) {
  return `http://${probe.host}:${port}${probe.path}`;
}

export function createAjaxAutoAllowCanaryState(probes, { redditDiagnosticProbes = [] } = {}) {
  return {
    originHits: 0,
    originPageHits: 0,
    attemptHits: 0,
    probeHits: Object.fromEntries(probes.map((probe) => [probe.id, 0])),
    completedProbes: {},
    completedCandidateEvents: {},
    completedRedditDiagnosticEvents: Object.fromEntries(
      redditDiagnosticProbes.map((probe) => [probe.id, false])
    ),
    pageResourceCandidateEvents: [],
    pageObserverInstalled: false,
    pageObserverState: null,
    browserAttempts: [],
    resultPayload: null,
    lastAttemptAt: null,
  };
}

export function isTransientBrowserContextError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Browsing context has been discarded|Failed to decode response from marionette/i.test(
    message
  );
}

export async function openUrlWithTransientBrowserRetry({
  url,
  maxAttempts = 2,
  createSession,
  openSessionUrl = async (session, targetUrl) => {
    await session.get(targetUrl);
  },
  closeSession = async () => {},
  onTransientError = () => {},
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const session = await createSession();
    try {
      await openSessionUrl(session, url);
      return { attempt, opened: true, session };
    } catch (error) {
      lastError = error;
      if (!isTransientBrowserContextError(error) || attempt === maxAttempts) {
        return {
          attempt,
          error: error instanceof Error ? error.message : String(error),
          opened: false,
          session,
        };
      }

      onTransientError(error, { attempt, maxAttempts });
      await closeSession(session).catch(() => {});
    }
  }

  return {
    attempt: maxAttempts,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    opened: false,
    session: null,
  };
}

export function buildCompletedProbesFromHits(probes, probeHits) {
  return Object.fromEntries(
    probes.map((probe) => [probe.id, Number(probeHits?.[probe.id] ?? 0) > 0])
  );
}

export function hasAllAjaxAutoAllowProbesCompleted(probes, completedProbes) {
  return probes
    .filter((probe) => probe.requiresTraffic !== false)
    .every((probe) => completedProbes?.[probe.id] === true);
}

function browserProbe(probe, port) {
  return {
    ...probe,
    url: buildAjaxAutoAllowProbeUrl(probe, port),
    stylesheetUrl:
      probe.kind === 'stylesheet-font'
        ? `http://${probe.stylesheetHost}:${port}${probe.stylesheetPath}`
        : null,
  };
}

function browserDiagnosticProbe(probe, port) {
  return {
    ...probe,
    url: probe.url ?? buildAjaxAutoAllowProbeUrl(probe, port),
    stylesheetUrl:
      probe.kind === 'stylesheet-font'
        ? (probe.stylesheetUrl ?? `http://${probe.stylesheetHost}:${port}${probe.stylesheetPath}`)
        : null,
  };
}

export function buildAjaxAutoAllowCanaryPage({
  platform,
  probes,
  redditDiagnosticProbes = [],
  originHost,
  port,
  timeoutMs,
  probeTimeoutMs,
  redditDiagnosticTimeoutMs = 1500,
  stateGlobalName = '__openpathAjaxAutoAllowCanaryState',
  statusElement = false,
}) {
  const title = `${platform} AJAX Auto-Allow Canary`;
  const statusMarkup = statusElement ? '<pre id="status">starting</pre>' : '';
  const statusInit = statusElement
    ? "const statusEl = document.getElementById('status');"
    : "const statusEl = { textContent: '' };";
  const browserProbes = probes.map((probe) => browserProbe(probe, port));
  const browserRedditDiagnosticProbes = redditDiagnosticProbes.map((probe) =>
    browserDiagnosticProbe(probe, port)
  );

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
${statusMarkup}
<script>
${statusInit}
const probes = ${JSON.stringify(browserProbes)};
const redditDiagnosticProbes = ${JSON.stringify(browserRedditDiagnosticProbes)};
const requiredProbeIds = new Set(
  probes.filter((probe) => probe.requiresTraffic !== false).map((probe) => probe.id)
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PROBE_TIMEOUT_MS = ${probeTimeoutMs};
const REDDIT_DIAGNOSTIC_TIMEOUT_MS = ${redditDiagnosticTimeoutMs};
const CANARY_TIMEOUT_MS = ${timeoutMs};
const pageResourceCandidateEvents = [];
const completedCandidateEvents = Object.fromEntries(probes.map((probe) => [probe.id, false]));
const completedRedditDiagnosticEvents = Object.fromEntries(
  redditDiagnosticProbes.map((probe) => [probe.id, false])
);
const canaryState = window.${stateGlobalName} = {
  startedAt: new Date().toISOString(),
  lastPhase: 'init',
  attempts: [],
  completedCandidateEvents,
  completedRedditDiagnosticEvents,
  pageResourceCandidateEvents,
  errors: [],
};

function isOpenPathPageObserverInstalled() {
  return window.__openpathPageResourceObserverInstalled === true;
}

function normalizeCandidateUrl(url) {
  try {
    const parsed = new URL(String(url));
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return String(url || '');
  }
}

function recordPageResourceCandidate(candidate) {
  if (!candidate || candidate.source !== 'openpath-page-resource-candidate') return;
  const normalizedCandidateUrl = normalizeCandidateUrl(candidate.url);
  const matchedProbe = probes.find(
    (probe) => normalizeCandidateUrl(probe.url) === normalizedCandidateUrl
  );
  const matchedRedditProbe = redditDiagnosticProbes.find(
    (probe) => normalizeCandidateUrl(probe.url) === normalizedCandidateUrl
  );
  if (matchedProbe) completedCandidateEvents[matchedProbe.id] = true;
  if (matchedRedditProbe) completedRedditDiagnosticEvents[matchedRedditProbe.id] = true;
  pageResourceCandidateEvents.push({
    ...candidate,
    matchedProbeId: matchedProbe ? matchedProbe.id : null,
    matchedRedditProbeId: matchedRedditProbe ? matchedRedditProbe.id : null,
    seenAt: new Date().toISOString(),
  });
  if (pageResourceCandidateEvents.length > 100) {
    pageResourceCandidateEvents.splice(0, pageResourceCandidateEvents.length - 100);
  }
}

window.addEventListener('message', (event) => recordPageResourceCandidate(event.data));
window.addEventListener('openpath-page-resource-candidate', (event) =>
  recordPageResourceCandidate(event.detail)
);
window.addEventListener('error', (event) => {
  canaryState.errors.push({
    type: 'error',
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});
window.addEventListener('unhandledrejection', (event) => {
  canaryState.errors.push({
    type: 'unhandledrejection',
    message: String(event.reason?.message || event.reason || 'unknown'),
  });
});

async function report(payload) {
  await fetch('/result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

async function reportAttempt(attemptResult, completed) {
  await fetch('/attempt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attempt: attemptResult,
      completedProbes: completed,
      completedCandidateEvents,
      completedRedditDiagnosticEvents,
      pageResourceCandidateEvents,
      pageObserverInstalled: isOpenPathPageObserverInstalled(),
      pageObserverState: window.__openpathPageResourceObserverState ?? null,
    }),
  }).catch((error) => {
    canaryState.errors.push({
      type: 'attempt-post-error',
      message: String(error?.message || error || 'unknown'),
    });
  });
}

function withTimeout(promise, timeoutMs, probeId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: probeId + ' timed out after ' + timeoutMs + 'ms' });
    }, timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(typeof result === 'object' ? result : { ok: result === true });
      })
      .catch((error) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: String(error?.message || error) });
      });
  });
}

const bust = (url) => url + (url.includes('?') ? '&' : '?') + 'attempt=' + Date.now();

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ ok: true });
    image.onerror = () => resolve({ ok: false, error: 'image load failed' });
    image.src = bust(url);
  });
}

function loadXhr(url) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', bust(url), true);
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 400, status: xhr.status });
    xhr.onerror = () => resolve({ ok: false, error: 'xhr load failed' });
    xhr.ontimeout = () => resolve({ ok: false, error: 'xhr timed out' });
    xhr.timeout = PROBE_TIMEOUT_MS;
    xhr.send();
  });
}

function loadScript(url) {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.onload = () => resolve({ ok: true });
    script.onerror = () => resolve({ ok: false, error: 'script load failed' });
    script.src = bust(url);
    document.body.appendChild(script);
  });
}

function loadStylesheet(url) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.onload = () => resolve({ ok: true });
    link.onerror = () => resolve({ ok: false, error: 'stylesheet load failed' });
    link.href = bust(url);
    document.head.appendChild(link);
  });
}

async function readProbeHits(probeId) {
  canaryState.lastPhase = 'read-probe-hits:' + probeId;
  const response = await fetch('/probe-state?probe=' + encodeURIComponent(probeId), {
    cache: 'no-store',
  });
  if (!response.ok) return 0;
  const payload = await response.json();
  return Number(payload?.hits ?? 0);
}

function loadFont(url, probeId) {
  return new Promise((resolve) => {
    const attemptUrl = bust(url);
    const family = 'OpenPathAjaxAutoAllowFont' + Date.now();
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.type = 'font/woff2';
    link.crossOrigin = 'anonymous';
    link.href = attemptUrl;
    document.head.appendChild(link);
    const style = document.createElement('style');
    style.textContent = '@font-face { font-family: "' + family + '"; src: url("' + attemptUrl + '") format("woff2"); }';
    document.head.appendChild(style);
    const sample = document.createElement('span');
    sample.textContent = 'font probe';
    sample.style.fontFamily = '"' + family + '", sans-serif';
    sample.style.position = 'absolute';
    sample.style.left = '-9999px';
    document.body.appendChild(sample);
    setTimeout(async () => {
      const hits = await readProbeHits(probeId).catch(() => 0);
      resolve(hits > 0 ? { ok: true, hits } : { ok: false, hits, error: 'font load did not reach canary server' });
    }, 1000);
  });
}

function loadStylesheetFont(url, probeId) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.onload = async () => {
      setTimeout(async () => {
        const hits = await readProbeHits(probeId).catch(() => 0);
        resolve(hits > 0 ? { ok: true, hits } : { ok: false, hits, error: 'stylesheet font load did not reach canary server' });
      }, 1000);
    };
    link.onerror = () => resolve({ ok: false, error: 'stylesheet font CSS load failed' });
    link.href = bust(url);
    document.head.appendChild(link);
    const sample = document.createElement('span');
    sample.textContent = 'stylesheet font probe';
    sample.style.fontFamily = '"OpenPathAjaxAutoAllowStylesheetFont", sans-serif';
    sample.style.position = 'absolute';
    sample.style.left = '-9999px';
    document.body.appendChild(sample);
  });
}

async function runProbeOnce(probe) {
  if (probe.kind === 'fetch') {
    const response = await fetch(bust(probe.url), { cache: 'no-store', mode: 'cors' });
    return { ok: response.ok, status: response.status };
  }
  if (probe.kind === 'xhr') return loadXhr(probe.url);
  if (probe.kind === 'image') return loadImage(probe.url);
  if (probe.kind === 'script') return loadScript(probe.url);
  if (probe.kind === 'stylesheet') return loadStylesheet(probe.url);
  if (probe.kind === 'font') return loadFont(probe.url, probe.id);
  if (probe.kind === 'stylesheet-font') return loadStylesheetFont(probe.stylesheetUrl, probe.id);
  return { ok: false, error: 'unsupported probe kind: ' + probe.kind };
}

async function runRedditDiagnosticProbes() {
  const results = {};
  for (const probe of redditDiagnosticProbes) {
    results[probe.id] = await withTimeout(
      runProbeOnce(probe),
      REDDIT_DIAGNOSTIC_TIMEOUT_MS,
      probe.id
    );
  }
  return results;
}

(async () => {
  const attempts = [];
  const completed = Object.fromEntries(probes.map((probe) => [probe.id, false]));
  let redditDiagnostics =
    redditDiagnosticProbes.length > 0
      ? { probes: {}, completedRedditDiagnosticEvents, pageResourceCandidateEvents }
      : null;
  const deadline = Date.now() + CANARY_TIMEOUT_MS;
  for (let attempt = 1; Date.now() < deadline; attempt += 1) {
    canaryState.lastPhase = 'attempt-start';
    const attemptResult = { attempt, startedAt: new Date().toISOString(), probes: {} };
    canaryState.attempts.push(attemptResult);
    if (attempt === 1 && redditDiagnosticProbes.length > 0) {
      statusEl.textContent = 'reddit diagnostics';
      redditDiagnostics = {
        probes: await runRedditDiagnosticProbes(),
        completedRedditDiagnosticEvents,
        pageResourceCandidateEvents,
      };
    }
    const results = await Promise.all(
      probes.map(async (probe) => {
        if (completed[probe.id]) return { id: probe.id, result: { ok: true, skipped: true } };
        statusEl.textContent = probe.id + ' attempt ' + attempt;
        return { id: probe.id, result: await withTimeout(runProbeOnce(probe), PROBE_TIMEOUT_MS, probe.id) };
      })
    );
    for (const item of results) {
      attemptResult.probes[item.id] = item.result;
      if (item.result?.ok === true) completed[item.id] = true;
    }
    attemptResult.completedAt = new Date().toISOString();
    attempts.push(attemptResult);
    await reportAttempt(attemptResult, completed);
    canaryState.lastPhase = 'attempt-finished';
    if ([...requiredProbeIds].every((probeId) => completed[probeId] === true)) {
      await report({
        success: true,
        attempts,
        probes,
        completedProbes: completed,
        completedCandidateEvents,
        completedRedditDiagnosticEvents,
        pageResourceCandidateEvents,
        ...(redditDiagnostics ? { redditDiagnostics } : {}),
        pageObserverInstalled: isOpenPathPageObserverInstalled(),
        pageObserverState: window.__openpathPageResourceObserverState ?? null,
      });
      statusEl.textContent = 'success';
      return;
    }
    await sleep(2500);
  }
  await report({
    success: false,
    attempts,
    probes,
    completedProbes: completed,
    completedCandidateEvents,
    completedRedditDiagnosticEvents,
    pageResourceCandidateEvents,
    ...(redditDiagnostics ? { redditDiagnostics } : {}),
    pageObserverInstalled: isOpenPathPageObserverInstalled(),
    pageObserverState: window.__openpathPageResourceObserverState ?? null,
  });
  statusEl.textContent = 'failed';
})().catch((error) => {
  canaryState.errors.push({ type: 'run-error', message: String(error?.message || error) });
});
</script>
</body>
</html>`;
}

function readRequestBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
  });
}

function mergeAttemptState(state, payload, { redact = (value) => value, maxAttempts = 60 } = {}) {
  const safePayload = redact(payload);
  state.browserAttempts.push(safePayload.attempt ?? safePayload);
  if (safePayload.completedProbes && typeof safePayload.completedProbes === 'object') {
    state.completedProbes = safePayload.completedProbes;
  }
  if (
    safePayload.completedCandidateEvents &&
    typeof safePayload.completedCandidateEvents === 'object'
  ) {
    state.completedCandidateEvents = safePayload.completedCandidateEvents;
  }
  if (
    safePayload.completedRedditDiagnosticEvents &&
    typeof safePayload.completedRedditDiagnosticEvents === 'object'
  ) {
    state.completedRedditDiagnosticEvents = safePayload.completedRedditDiagnosticEvents;
  }
  if (Array.isArray(safePayload.pageResourceCandidateEvents)) {
    state.pageResourceCandidateEvents.push(...safePayload.pageResourceCandidateEvents);
    state.pageResourceCandidateEvents.splice(0, state.pageResourceCandidateEvents.length - 100);
  }
  state.pageObserverInstalled ||= safePayload.pageObserverInstalled === true;
  if (safePayload.pageObserverState) state.pageObserverState = safePayload.pageObserverState;
  if (state.browserAttempts.length > maxAttempts) {
    state.browserAttempts.splice(0, state.browserAttempts.length - maxAttempts);
  }
  state.attemptHits += 1;
  state.lastAttemptAt = new Date().toISOString();
}

export function createAjaxAutoAllowCanaryServer({
  platform,
  probes,
  originHost,
  port,
  state,
  buildPage,
  onResult,
  redact = (value) => value,
  maxAttempts = 60,
  scriptGlobalName = '__openpathAjaxAutoAllowScriptProbe',
  stylesheetCss = 'body { --openpath-ajax-auto-allow-style-probe: loaded; }',
}) {
  return createServer(async (req, res) => {
    const host =
      String(req.headers.host ?? '')
        .split(':', 1)[0]
        ?.toLowerCase() ?? '';
    const url = new URL(req.url ?? '/', `http://${host || originHost}:${port}`);
    const matchedProbe = probes.find((probe) => host === probe.host && url.pathname === probe.path);
    const matchedStylesheetFontProbe = probes.find(
      (probe) =>
        probe.kind === 'stylesheet-font' &&
        host === probe.stylesheetHost &&
        url.pathname === probe.stylesheetPath
    );

    if (host === originHost) {
      state.originHits += 1;
      if (req.method === 'GET' && url.pathname === '/') state.originPageHits += 1;
    }

    if (host === originHost && req.method === 'GET' && url.pathname === '/probe-state') {
      const probeId = url.searchParams.get('probe') ?? '';
      res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hits: Number(state.probeHits[probeId] ?? 0), probe: probeId }));
      return;
    }

    if (host === originHost && req.method === 'POST' && url.pathname === '/attempt') {
      const body = await readRequestBody(req);
      try {
        mergeAttemptState(state, JSON.parse(body || '{}'), {
          redact,
          maxAttempts,
        });
      } catch (error) {
        state.browserAttempts.push({
          error: 'invalid attempt payload',
          message: error instanceof Error ? error.message : String(error),
          raw: redact(body.slice(-1000)),
        });
      }
      res.writeHead(204);
      res.end();
      return;
    }

    if (host === originHost && req.method === 'POST' && url.pathname === '/result') {
      const body = await readRequestBody(req);
      try {
        state.resultPayload = redact(JSON.parse(body || '{}'));
      } catch {
        state.resultPayload = { success: false, error: 'invalid result payload' };
      }
      res.writeHead(204);
      res.end();
      onResult?.(state.resultPayload);
      return;
    }

    if (matchedStylesheetFontProbe) {
      const fontUrl = buildAjaxAutoAllowProbeUrl(matchedStylesheetFontProbe, port);
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/css; charset=utf-8',
      });
      res.end(
        [
          '@font-face {',
          '  font-family: "OpenPathAjaxAutoAllowStylesheetFont";',
          `  src: url("${fontUrl}") format("woff2");`,
          '}',
          'body { --openpath-ajax-auto-allow-stylesheet-font-probe: loaded; }',
        ].join('\n')
      );
      return;
    }

    if (matchedProbe) {
      state.probeHits[matchedProbe.id] += 1;
      const headers = { 'Cache-Control': 'no-store' };
      if (matchedProbe.kind === 'fetch' || matchedProbe.kind === 'xhr') {
        res.writeHead(200, {
          ...headers,
          'Access-Control-Allow-Origin': `http://${originHost}:${port}`,
          'Content-Type': 'application/json',
        });
        res.end(JSON.stringify({ ok: true, platform, probe: matchedProbe.id }));
        return;
      }
      if (matchedProbe.kind === 'image') {
        res.writeHead(200, { ...headers, 'Content-Type': 'image/png' });
        res.end(PIXEL_PNG);
        return;
      }
      if (matchedProbe.kind === 'script') {
        res.writeHead(200, { ...headers, 'Content-Type': 'application/javascript; charset=utf-8' });
        res.end(`window.${scriptGlobalName} = true;`);
        return;
      }
      if (matchedProbe.kind === 'stylesheet') {
        res.writeHead(200, { ...headers, 'Content-Type': 'text/css; charset=utf-8' });
        res.end(stylesheetCss);
        return;
      }
      if (matchedProbe.kind === 'font' || matchedProbe.kind === 'stylesheet-font') {
        res.writeHead(200, {
          ...headers,
          'Access-Control-Allow-Origin': `http://${originHost}:${port}`,
          'Content-Type': 'font/woff2',
        });
        res.end(MINIMAL_WOFF2);
        return;
      }
    }

    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildPage());
  });
}

export async function waitForAjaxAutoAllowPageObserver({
  driver,
  originUrl,
  timeoutMs,
  reloadEveryMs = 5000,
  pollMs = 1000,
  collectBrowserNavigationDiagnostics,
  onReloadError = () => {},
}) {
  const deadline = Date.now() + timeoutMs;
  let lastDiagnostics = await collectBrowserNavigationDiagnostics(driver);
  let lastReloadAt = 0;

  while (Date.now() < deadline) {
    if (lastDiagnostics.openpathObserverInstalled === true) {
      return lastDiagnostics;
    }

    const now = Date.now();
    if (now - lastReloadAt >= reloadEveryMs) {
      lastReloadAt = now;
      await driver.get(originUrl).catch(onReloadError);
    } else {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    lastDiagnostics = await collectBrowserNavigationDiagnostics(driver);
  }

  return lastDiagnostics;
}
