export const WINDOWS_AUTO_ALLOW_ORIGIN_HOST = 'ajax-auto-allow-origin.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_TARGET_HOST = 'ajax-auto-allow-target.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_ASSET_HOST = 'ajax-auto-allow-asset.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_SCRIPT_HOST = 'ajax-auto-allow-script.127.0.0.1.sslip.io';
export const WINDOWS_AUTO_ALLOW_STYLESHEET_HOST = 'ajax-auto-allow-stylesheet.127.0.0.1.sslip.io';

export const WINDOWS_AUTO_ALLOW_PROBES = Object.freeze([
  {
    id: 'ajax-fetch',
    kind: 'fetch',
    host: WINDOWS_AUTO_ALLOW_TARGET_HOST,
    path: '/data.json',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_TARGET_HOST,
    failureMessage: 'Auto-allow AJAX target was not written to whitelist',
  },
  {
    id: 'image-subresource',
    kind: 'image',
    host: WINDOWS_AUTO_ALLOW_ASSET_HOST,
    path: '/pixel.png',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_ASSET_HOST,
    failureMessage: 'Auto-allow image target was not written to whitelist',
  },
  {
    id: 'script-subresource',
    kind: 'script',
    host: WINDOWS_AUTO_ALLOW_SCRIPT_HOST,
    path: '/asset.js',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_SCRIPT_HOST,
    failureMessage: 'Auto-allow script target was not written to whitelist',
  },
  {
    id: 'stylesheet-subresource',
    kind: 'stylesheet',
    host: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    path: '/style.css',
    expectedWhitelistHost: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    failureMessage: 'Auto-allow stylesheet target was not written to whitelist',
  },
]);

export function buildWindowsAutoAllowProbeUrl(probe, port) {
  return `http://${probe.host}:${port}${probe.path}`;
}

export function redactSensitiveWindowsCanaryValue(value) {
  return String(value)
    .replace(/\/w\/[^/?#]+\/whitelist\.txt/gi, '/w/[redacted]/whitelist.txt')
    .replace(/("?(?:machineToken|token)"?\s*[:=]\s*)"?[^",\s}]+"?/gi, '$1"[redacted]"');
}

export function redactWindowsCanaryObject(value) {
  if (typeof value === 'string') {
    return redactSensitiveWindowsCanaryValue(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactWindowsCanaryObject(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token/i.test(key) && typeof item === 'string'
          ? '[redacted]'
          : redactWindowsCanaryObject(item),
      ])
    );
  }

  return value;
}

function findProbeEvidence(probeEvidence, id) {
  return probeEvidence.find((probe) => probe.id === id);
}

export function buildWindowsAutoAllowCanarySummary({
  result,
  probeEvidence,
  originHits,
  attempts,
  completedProbes,
  lastAttemptAt,
  whitelistPath,
  firefoxExtensionWarmup,
  firefoxOutput,
  diagnostics,
}) {
  const ajaxEvidence = findProbeEvidence(probeEvidence, 'ajax-fetch');
  const imageEvidence = findProbeEvidence(probeEvidence, 'image-subresource');
  const scriptEvidence = findProbeEvidence(probeEvidence, 'script-subresource');
  const stylesheetEvidence = findProbeEvidence(probeEvidence, 'stylesheet-subresource');

  return {
    ...result,
    originHost: WINDOWS_AUTO_ALLOW_ORIGIN_HOST,
    targetHost: WINDOWS_AUTO_ALLOW_TARGET_HOST,
    assetHost: WINDOWS_AUTO_ALLOW_ASSET_HOST,
    scriptHost: WINDOWS_AUTO_ALLOW_SCRIPT_HOST,
    stylesheetHost: WINDOWS_AUTO_ALLOW_STYLESHEET_HOST,
    targetUrl: ajaxEvidence?.url ?? result?.targetUrl,
    assetUrl: imageEvidence?.url ?? result?.assetUrl,
    originHits,
    targetHits: ajaxEvidence?.hits ?? 0,
    assetHits: imageEvidence?.hits ?? 0,
    scriptHits: scriptEvidence?.hits ?? 0,
    stylesheetHits: stylesheetEvidence?.hits ?? 0,
    attempts: result?.attempts ?? attempts,
    completedProbes: result?.completedProbes ?? completedProbes,
    lastAttemptAt: result?.lastAttemptAt ?? lastAttemptAt,
    probeEvidence,
    whitelistPath,
    whitelistContainsTarget: ajaxEvidence?.whitelistContainsExpectedHost ?? false,
    whitelistContainsAsset: imageEvidence?.whitelistContainsExpectedHost ?? false,
    firefoxExtensionWarmup,
    firefoxOutput,
    diagnostics,
  };
}

export function assertWindowsAutoAllowCanarySuccess(summary, probes = WINDOWS_AUTO_ALLOW_PROBES) {
  if (!summary.success) {
    throw new Error(`Windows AJAX auto-allow canary failed: ${JSON.stringify(summary)}`);
  }

  for (const probe of probes) {
    const evidence = summary.probeEvidence?.find((item) => item.id === probe.id);
    if (!evidence?.whitelistContainsExpectedHost) {
      throw new Error(probe.failureMessage);
    }
  }
}
