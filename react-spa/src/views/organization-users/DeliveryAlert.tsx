import { DeliveryNotice } from '../organization-users-helpers';

export function DeliveryAlert({
  notice,
  onDismiss,
}: {
  notice: DeliveryNotice;
  onDismiss: () => void;
}) {
  const toneClasses =
    notice.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-amber-200 bg-amber-50 text-amber-900';

  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`} role="status">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-sm font-semibold">{notice.title}</p>
          <p className="text-sm">{notice.description}</p>
          {'url' in notice ? (
            <div className="space-y-2">
              <label
                htmlFor="delivery-alert-url"
                className="block text-xs font-semibold uppercase tracking-wide"
              >
                Enlace manual
              </label>
              <input
                id="delivery-alert-url"
                type="text"
                readOnly
                value={notice.url}
                className="w-full rounded-lg border border-current/20 bg-white px-3 py-2 text-xs text-slate-700"
              />
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-semibold uppercase tracking-wide opacity-75 hover:opacity-100"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
