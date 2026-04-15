import React, { useMemo, useState } from 'react';
import { Button, Card, Input } from '../openpath/public-ui';
import {
  useApproveManualBillingRequest,
  useBillingAuditTrail,
  usePlatformEntitlements,
  usePlatformManualBillingRequests,
  useRejectManualBillingRequest,
} from '../lib/hooks';

type ResolutionNotes = Record<string, string>;

function formatDate(value: string | null): string {
  if (!value) return 'pendiente';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'pendiente';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function PlatformAdminPanel() {
  const requestsQuery = usePlatformManualBillingRequests({ refetchInterval: 30000 });
  const entitlementsQuery = usePlatformEntitlements({ refetchInterval: 30000 });
  const auditTrailQuery = useBillingAuditTrail(undefined, { refetchInterval: 30000 });
  const approveMutation = useApproveManualBillingRequest();
  const rejectMutation = useRejectManualBillingRequest();
  const requests = requestsQuery.data ?? [];
  const entitlements = entitlementsQuery.data ?? [];
  const auditTrail = auditTrailQuery.data ?? [];
  const [resolutionNotes, setResolutionNotes] = useState<ResolutionNotes>({});
  const [error, setError] = useState('');

  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === 'pending'),
    [requests]
  );

  function noteFor(requestId: string): string {
    return resolutionNotes[requestId] ?? '';
  }

  function requireResolutionNote(requestId: string): string | null {
    const note = noteFor(requestId).trim();
    if (!note) {
      setError('Cada resolución manual requiere una nota.');
      return null;
    }
    setError('');
    return note;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Administración de plataforma</h1>
          <p className="mt-2 text-sm text-slate-600">
            Revisa excepciones comerciales, vigila el estado de los centros y conserva la
            trazabilidad.
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <Card className="p-6">
          <h2 className="text-xl font-bold text-slate-900">Solicitudes manuales</h2>
          {requestsQuery.isLoading ? (
            <p className="mt-4 text-sm text-slate-500">Cargando solicitudes...</p>
          ) : requests.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No hay solicitudes registradas.</p>
          ) : (
            <div className="mt-4 grid gap-4">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900">{request.organizationName}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {request.kind} · {request.classrooms} aulas · {request.status}
                      </div>
                      {request.note ? (
                        <div className="mt-2 text-sm text-slate-500">{request.note}</div>
                      ) : null}
                      {request.resolutionNote ? (
                        <div className="mt-2 text-sm text-slate-700">
                          Resolución: <strong>{request.resolutionNote}</strong>
                        </div>
                      ) : null}
                    </div>

                    {request.status === 'pending' ? (
                      <div className="w-full max-w-md space-y-3">
                        <Input
                          type="text"
                          name={`resolution-note-${request.id}`}
                          value={noteFor(request.id)}
                          onChange={(event) =>
                            setResolutionNotes((current) => ({
                              ...current,
                              [request.id]: event.target.value,
                            }))
                          }
                          placeholder="Nota obligatoria para soporte y auditoría"
                        />
                        <div className="flex gap-3">
                          <Button
                            type="button"
                            onClick={() => {
                              const resolutionNote = requireResolutionNote(request.id);
                              if (!resolutionNote) return;
                              approveMutation.mutate({ requestId: request.id, resolutionNote });
                            }}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                          >
                            Aprobar excepción
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              const resolutionNote = requireResolutionNote(request.id);
                              if (!resolutionNote) return;
                              rejectMutation.mutate({ requestId: request.id, resolutionNote });
                            }}
                            disabled={approveMutation.isPending || rejectMutation.isPending}
                          >
                            Rechazar
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          {pendingRequests.length > 0 ? (
            <p className="mt-4 text-xs text-slate-500">
              Pendientes ahora: {pendingRequests.length}. Cada acción exige nota de resolución.
            </p>
          ) : null}
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-bold text-slate-900">Entitlements activos y recientes</h2>
          {entitlementsQuery.isLoading ? (
            <p className="mt-4 text-sm text-slate-500">Cargando centros...</p>
          ) : entitlements.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Aún no hay entitlements registradas.</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {entitlements.map((entitlement) => (
                <div
                  key={entitlement.organizationId}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="font-semibold text-slate-900">{entitlement.organizationName}</div>
                  <div className="mt-1 text-sm text-slate-600">
                    {entitlement.productKind} · {entitlement.classroomLimit} aulas ·{' '}
                    {entitlement.status}
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    Fuente: {entitlement.source}
                    <br />
                    Fin de periodo: {formatDate(entitlement.currentPeriodEnd)}
                    <br />
                    Fin de gracia: {formatDate(entitlement.graceEndsAt)}
                    <br />
                    Expira: {formatDate(entitlement.expiresAt)}
                    <br />
                    Última actualización: {formatDate(entitlement.updatedAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-bold text-slate-900">Timeline de billing</h2>
          {auditTrailQuery.isLoading ? (
            <p className="mt-4 text-sm text-slate-500">Cargando actividad...</p>
          ) : auditTrail.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Todavía no hay eventos de billing.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {auditTrail.map((event) => (
                <div
                  key={event.id}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-medium text-slate-900">{event.action}</div>
                    <div className="text-xs text-slate-500">{formatDate(event.createdAt)}</div>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {event.actorType} · {event.targetType} · {event.targetId}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
