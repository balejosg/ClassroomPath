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
