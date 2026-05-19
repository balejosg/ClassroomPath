import React from 'react';
import { useClassroomPathI18n } from '../i18n/classroompath-i18n';
import type { ProductLocale } from '../openpath/public-i18n';
type BillingInfo = {
  status: string | null;
  productKind: string | null;
  expiresAt: string | null;
  graceEndsAt?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
};

function formatDate(value: string | null | undefined, locale: ProductLocale): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function isPilotExpiringSoon(billing: BillingInfo): boolean {
  if (billing.productKind !== 'pilot' || !billing.expiresAt) return false;
  const expiresAt = new Date(billing.expiresAt).getTime();
  const now = Date.now();
  return expiresAt > now && expiresAt - now <= 14 * 24 * 60 * 60 * 1000;
}

export function BillingStatusBanner({ billing }: { billing: BillingInfo | null | undefined }) {
  const { locale, t } = useClassroomPathI18n();
  if (!billing) return null;

  if (billing.status === 'grace_period') {
    return (
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        {t('billing.banner.grace')}{' '}
        <strong>{formatDate(billing.graceEndsAt, locale) ?? t('app.common.pending')}</strong>.
      </div>
    );
  }

  if (billing.cancelAtPeriodEnd === true) {
    return (
      <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
        {t('billing.banner.cancel')}{' '}
        <strong>{formatDate(billing.currentPeriodEnd, locale) ?? t('app.common.pending')}</strong>.
      </div>
    );
  }

  if (isPilotExpiringSoon(billing)) {
    return (
      <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        {t('billing.banner.pilot', { date: formatDate(billing.expiresAt, locale) ?? '' })}
      </div>
    );
  }

  return null;
}
