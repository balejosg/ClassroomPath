export type SessionClientMode = 'web' | 'app';

export function getSessionClientMode(): SessionClientMode {
  if (typeof window === 'undefined') return 'web';

  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    navigatorWithStandalone.standalone === true;

  return isStandalone ? 'app' : 'web';
}
