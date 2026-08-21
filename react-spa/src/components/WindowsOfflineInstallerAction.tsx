import React, { useState } from 'react';

import { cpTrpcReact } from '../lib/dual-trpc-provider';
import { useClassroomPathT } from '../i18n/classroompath-i18n';

interface Props {
  classroomId: string;
}

export default function WindowsOfflineInstallerAction({ classroomId }: Props): React.ReactElement {
  const t = useClassroomPathT();
  const [progress, setProgress] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    fileName: string;
    version: string;
    sha256: string;
    tokenExpiresAt: string;
    downloadUrl: string;
  } | null>(null);

  const generateMutation = cpTrpcReact.windowsOfflineInstaller.generate.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setProgress('ready');
      const anchor = document.createElement('a');
      anchor.href = data.downloadUrl;
      anchor.download = data.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    onError: () => {
      setError(t('cp.offlineInstaller.error'));
      setProgress('error');
    },
  });

  return (
    <div className="flex flex-col items-end gap-1" data-testid="windows-offline-installer-action">
      <button
        type="button"
        disabled={generateMutation.isPending}
        onClick={() => {
          setError(null);
          setProgress('generating');
          generateMutation.mutate({ classroomId });
        }}
        className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-2 shadow-sm transition-colors"
      >
        {t('cp.offlineInstaller.action')}
      </button>
      {progress === 'generating' ? (
        <span className="text-[11px] text-slate-500">{t('cp.offlineInstaller.generating')}</span>
      ) : null}
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
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
