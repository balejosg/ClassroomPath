import React from 'react';
import { BookOpen } from 'lucide-react';

import { useClassroomPathT } from '../i18n/classroompath-i18n';

export function PolicyLibraryButton({ onClick }: { onClick: () => void }) {
  const t = useClassroomPathT();

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('groupLibrary.openAriaLabel')}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
    >
      <BookOpen size={16} />
      <span>{t('groupLibrary.openButtonLabel')}</span>
    </button>
  );
}
