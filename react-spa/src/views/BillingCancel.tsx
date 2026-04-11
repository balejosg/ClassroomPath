import React from 'react';
import { Button } from '@openpath/public-ui';

type BillingCancelProps = {
  onBack: () => void;
  onLogout: () => void;
};

export function BillingCancel({ onBack, onLogout }: BillingCancelProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Checkout cancelado</h1>
        <p className="mt-3 text-sm text-slate-600">
          No se activó ningún centro. Puedes volver al onboarding y retomar el proceso cuando
          quieras.
        </p>
        <div className="mt-6 flex gap-3">
          <Button type="button" onClick={onBack}>
            Volver al onboarding
          </Button>
          <Button type="button" variant="outline" onClick={onLogout}>
            Cerrar sesión
          </Button>
        </div>
      </div>
    </div>
  );
}
