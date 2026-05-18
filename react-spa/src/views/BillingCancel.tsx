import React from 'react';
import { Button } from '../openpath/public-ui';
import { useClassroomPathT } from '../i18n/classroompath-i18n';

type BillingCancelProps = {
  onBack: () => void;
  onLogout: () => void;
};

export function BillingCancel({ onBack, onLogout }: BillingCancelProps) {
  const t = useClassroomPathT();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">{t('billing.cancel.title')}</h1>
        <p className="mt-3 text-sm text-slate-600">{t('billing.cancel.body')}</p>
        <div className="mt-6 flex gap-3">
          <Button type="button" onClick={onBack}>
            {t('billing.cancel.back')}
          </Button>
          <Button type="button" variant="outline" onClick={onLogout}>
            {t('app.common.logout')}
          </Button>
        </div>
      </div>
    </div>
  );
}
