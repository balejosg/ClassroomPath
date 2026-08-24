import React, { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { useClassroomPathT } from '../i18n/classroompath-i18n';

interface Props {
  classroomId: string;
}

interface InstallerResult {
  fileName: string;
  version: string;
  sha256: string;
  tokenExpiresAt: string;
  downloadUrl: string;
  downloadExpiresAt: string;
}

const DOWNLOAD_CACHE_SAFETY_MARGIN_MS = 30_000;
const installerCache = new Map<string, InstallerResult>();

function hasFreshDownloadUrl(result: InstallerResult, now = Date.now()): boolean {
  const expiresAt = Date.parse(result.downloadExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt - now > DOWNLOAD_CACHE_SAFETY_MARGIN_MS;
}

export default function WindowsOfflineInstallerAction({ classroomId }: Props): React.ReactElement {
  const t = useClassroomPathT();
  const [progress, setProgress] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InstallerResult | null>(null);
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  const programmaticNavigationRef = useRef(false);

  useEffect(() => {
    setProgress('idle');
    setError(null);
    setResult(null);
  }, [classroomId]);

  const navigateWithResult = useCallback((nextResult: InstallerResult) => {
    flushSync(() => {
      setResult(nextResult);
      setProgress('ready');
      setError(null);
    });

    const anchor = anchorRef.current;
    if (!anchor) return;

    programmaticNavigationRef.current = true;
    anchor.click();
    programmaticNavigationRef.current = false;
  }, []);

  const generateMutation = cpTrpcReact.windowsOfflineInstaller.generate.useMutation({
    onSuccess: (data) => {
      installerCache.set(classroomId, data);
      navigateWithResult(data);
    },
    onError: () => {
      setResult(null);
      setError(t('cp.offlineInstaller.error'));
      setProgress('error');
    },
  });

  const isGenerating = progress === 'generating' || generateMutation.isPending;
  const linkLabel = isGenerating
    ? t('cp.offlineInstaller.generating')
    : progress === 'error'
      ? t('cp.offlineInstaller.retryAction')
      : t('cp.offlineInstaller.linkAction');

  const handleDownloadClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (programmaticNavigationRef.current) return;

    event.preventDefault();
    if (isGenerating) return;

    setError(null);
    const cachedResult = installerCache.get(classroomId);
    if (cachedResult && hasFreshDownloadUrl(cachedResult)) {
      navigateWithResult(cachedResult);
      return;
    }

    if (cachedResult) {
      installerCache.delete(classroomId);
    }

    setResult(null);
    setProgress('generating');
    generateMutation.mutate({ classroomId });
  };

  const handleDownloadKeyDown = (event: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.currentTarget.click();
  };

  return (
    <div className="flex flex-col items-end gap-1" data-testid="windows-offline-installer-action">
      <a
        ref={anchorRef}
        href={result?.downloadUrl}
        download={result?.fileName}
        role="link"
        aria-disabled={isGenerating ? 'true' : undefined}
        tabIndex={isGenerating ? -1 : 0}
        onClick={handleDownloadClick}
        onKeyDown={handleDownloadKeyDown}
        className={`text-xs font-medium underline underline-offset-2 transition-colors ${
          isGenerating
            ? 'pointer-events-none cursor-wait text-slate-400'
            : 'cursor-pointer text-blue-600 hover:text-blue-700'
        }`}
      >
        {linkLabel}
      </a>
      {isGenerating ? (
        <span className="text-[11px] text-slate-500">{t('cp.offlineInstaller.generating')}</span>
      ) : null}
      {error ? (
        <span role="alert" className="text-[11px] text-red-600">
          {error}
        </span>
      ) : null}
      {result ? (
        <span
          className="text-[11px] text-slate-500 max-w-md text-right"
          data-testid="windows-offline-installer-metadata"
        >
          {t('cp.offlineInstaller.metadata', {
            version: result.version,
            sha256: result.sha256.slice(0, 12),
            expiresAt: result.tokenExpiresAt,
          })}
        </span>
      ) : null}
    </div>
  );
}
