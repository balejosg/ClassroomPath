import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { cpTrpcReact } from '../lib/dual-trpc-provider';

export function DomainRequestApprovalPage() {
  const { requestId = '' } = useParams();
  const [approved, setApproved] = useState(false);
  const requestsQuery = cpTrpcReact.requests.list.useQuery({ status: 'pending' });
  const groupsQuery = cpTrpcReact.requests.listGroups.useQuery();
  const approveMutation = cpTrpcReact.requests.approve.useMutation();

  const request = useMemo(
    () => requestsQuery.data?.find((candidate) => candidate.id === requestId),
    [requestId, requestsQuery.data]
  );
  const groupName = useMemo(() => {
    if (!request?.groupId) return null;
    return (
      groupsQuery.data?.find((candidate) => candidate.path === request.groupId)?.name ??
      request.groupId
    );
  }, [groupsQuery.data, request?.groupId]);

  const approveRequest = async () => {
    if (!request) return;

    await approveMutation.mutateAsync({ id: request.id });
    setApproved(true);
  };

  if (requestsQuery.isLoading) {
    return (
      <section className="mx-auto flex min-h-[55vh] max-w-xl items-center justify-center text-slate-700">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        Cargando solicitud...
      </section>
    );
  }

  if (approved) {
    return (
      <section className="mx-auto max-w-xl rounded-lg border border-emerald-200 bg-emerald-50 p-6 text-center text-slate-900">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-600" aria-hidden="true" />
        <h2 className="text-xl font-semibold">Dominio aprobado</h2>
        <p className="mt-2 text-sm text-slate-700">La solicitud ya se ha añadido a la whitelist.</p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md border border-emerald-700 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          to="/dominios"
        >
          Volver a solicitudes
        </Link>
      </section>
    );
  }

  if (requestsQuery.isError || !request) {
    return (
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-900 shadow-sm">
        <h2 className="text-xl font-semibold">Solicitud no disponible</h2>
        <p className="mt-2 text-sm text-slate-600">
          La solicitud puede haber sido aprobada, rechazada o ya no estar asignada a tus grupos.
        </p>
        <Link
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800"
          to="/dominios"
        >
          Volver a solicitudes
        </Link>
      </section>
    );
  }

  const isApproving = approveMutation.status === 'pending';

  return (
    <section className="mx-auto max-w-xl rounded-lg border border-sky-200 bg-white p-6 text-slate-900 shadow-sm">
      <p className="text-sm font-semibold text-sky-700">Solicitud pendiente</p>
      <h2 className="mt-2 text-2xl font-semibold">Aprobar dominio</h2>
      <div className="mt-5 rounded-md bg-slate-50 p-4">
        <p className="text-sm text-slate-500">Dominio</p>
        <p className="mt-1 break-all text-xl font-semibold">{request.domain}</p>
        {groupName ? (
          <>
            <p className="mt-4 text-sm text-slate-500">Grupo</p>
            <p className="mt-1 font-medium">{groupName}</p>
          </>
        ) : null}
      </div>
      <button
        className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-md bg-emerald-700 px-5 py-3 text-base font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        disabled={isApproving}
        onClick={approveRequest}
        type="button"
      >
        {isApproving ? 'Aprobando...' : 'Aprobar dominio'}
      </button>
      <Link
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        to="/dominios"
      >
        Volver a solicitudes
      </Link>
    </section>
  );
}
