import React from 'react';
import { Button, Card } from '@openpath/public-ui';
import { useApproveManualBillingRequest, usePlatformManualBillingRequests } from '../lib/hooks';

export function PlatformAdminPanel() {
  const requestsQuery = usePlatformManualBillingRequests({ refetchInterval: 30000 });
  const approveMutation = useApproveManualBillingRequest();
  const requests = requestsQuery.data ?? [];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold text-slate-900">Administración de plataforma</h1>
        <p className="mt-2 text-sm text-slate-600">
          Revisa excepciones comerciales antes de activar centros sin checkout automático.
        </p>

        <Card className="mt-8 p-6">
          <h2 className="text-xl font-bold text-slate-900">Solicitudes pendientes</h2>
          {requestsQuery.isLoading ? (
            <p className="mt-4 text-sm text-slate-500">Cargando solicitudes...</p>
          ) : requests.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No hay solicitudes pendientes.</p>
          ) : (
            <div className="mt-4 grid gap-4">
              {requests.map((request) => (
                <div
                  key={request.id}
                  className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="font-semibold text-slate-900">{request.organizationName}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {request.kind} · {request.classrooms} aulas · {request.status}
                      </div>
                      {request.note ? (
                        <div className="mt-2 text-sm text-slate-500">{request.note}</div>
                      ) : null}
                    </div>
                    {request.status === 'pending' ? (
                      <Button
                        type="button"
                        onClick={() => approveMutation.mutate({ requestId: request.id })}
                        disabled={approveMutation.isPending}
                      >
                        Aprobar excepción
                      </Button>
                    ) : null}
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
