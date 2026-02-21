import React, { useEffect, useState } from 'react';
import { Building2, Users } from 'lucide-react';
import { Button } from '@openpath/src/components/ui/Button';
import { Input } from '@openpath/src/components/ui/Input';
import { Card } from '@openpath/src/components/ui/Card';
import { useCreateOrganization, useListOrganizations, useWaitForInvitation } from '../lib/hooks';

interface Props {
  onOrgCreated: (result: {
    success: boolean;
    organizationId: string;
    user?: {
      id: string;
      email: string;
      name: string;
      roles: Array<{ role: string; groupIds: string[] }>;
    };
  }) => void;
  onWaitClick: () => void;
  onLogout?: () => void;
}

export function Onboarding({ onOrgCreated, onWaitClick, onLogout }: Props) {
  const [orgName, setOrgName] = useState('');
  const [targetOrgId, setTargetOrgId] = useState('');
  const [error, setError] = useState('');

  const createOrgMutation = useCreateOrganization();
  const orgsQuery = useListOrganizations();
  const waitMutation = useWaitForInvitation();

  useEffect(() => {
    if (targetOrgId) return;
    const orgs = orgsQuery.data ?? [];
    if (orgs.length === 1) {
      setTargetOrgId(orgs[0].id);
    }
  }, [orgsQuery.data, targetOrgId]);

  const handleCreateOrg = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!orgName.trim()) {
      setError('Debes ingresar un nombre para la organización');
      return;
    }

    createOrgMutation.mutate(
      { name: orgName },
      {
        onSuccess: (data) => {
          onOrgCreated(data);
        },
        onError: (err) => {
          setError(err.message || 'Error al crear organización');
        },
      }
    );
  };

  const handleWait = () => {
    setError('');

    if (!targetOrgId) {
      setError('Selecciona una organización para solicitar acceso');
      return;
    }

    waitMutation.mutate(
      { targetOrganizationId: targetOrgId },
      {
        onSuccess: () => {
          onWaitClick();
        },
        onError: (err) => {
          setError(err.message || 'Error al procesar solicitud');
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-4xl">
        <h1 className="text-3xl font-bold text-center mb-2 text-gray-900">
          ¡Bienvenido a ClassroomPath!
        </h1>
        <p className="text-center text-gray-600 mb-10">
          Elige cómo quieres comenzar a gestionar tus salas
        </p>

        {error && (
          <div className="mb-8 p-4 bg-red-100 text-red-700 rounded-lg text-sm border border-red-200">
            {error}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-8">
          {/* Opción 1: Crear Organización */}
          <Card className="p-8 flex flex-col shadow-md border-t-4 border-t-blue-600">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-blue-100 rounded-lg text-blue-600">
                <Building2 size={32} />
              </div>
              <h2 className="text-xl font-bold text-gray-800">Crear mi organización</h2>
            </div>
            <p className="text-gray-600 mb-8 leading-relaxed">
              Crea una nueva organización para tu institución y comienza a configurar tus grupos y
              políticas de filtrado.
            </p>
            <form onSubmit={handleCreateOrg} className="space-y-4 mt-auto" noValidate>
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-700">
                  Nombre de la organización
                </label>
                <Input
                  type="text"
                  name="orgName"
                  data-testid="onboarding-org-name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Ej: Colegio San José"
                  maxLength={100}
                  required
                />
              </div>
              <Button
                type="submit"
                data-testid="onboarding-create-org"
                className="w-full cursor-pointer py-6"
                disabled={createOrgMutation.isPending}
              >
                {createOrgMutation.isPending ? 'Creando...' : 'Crear Organización'}
              </Button>
            </form>
          </Card>

          {/* Opción 2: Esperar Invitación */}
          <Card className="p-8 flex flex-col shadow-md border-t-4 border-t-green-600">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-green-100 rounded-lg text-green-600">
                <Users size={32} />
              </div>
              <h2 className="text-xl font-bold text-gray-800">Esperar invitación</h2>
            </div>
            <p className="text-gray-600 mb-8 leading-relaxed">
              Si tu institución ya utiliza ClassroomPath, puedes solicitar acceso y esperar a que un
              administrador te agregue.
            </p>
            <div className="mt-auto">
              <div className="mb-4">
                <label className="block text-sm font-semibold mb-2 text-gray-700">
                  Organización
                </label>
                <select
                  name="targetOrganization"
                  data-testid="onboarding-target-org"
                  value={targetOrgId}
                  onChange={(e) => setTargetOrgId(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
                  disabled={orgsQuery.isPending}
                >
                  <option value="">Seleccionar organización...</option>
                  {(orgsQuery.data ?? []).map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
                {orgsQuery.isError && (
                  <p className="mt-2 text-xs text-red-600">No se pudieron cargar organizaciones.</p>
                )}
              </div>
              <Button
                onClick={handleWait}
                data-testid="onboarding-wait-invite"
                variant="outline"
                className="w-full cursor-pointer py-6 border-2"
                disabled={waitMutation.isPending || orgsQuery.isPending}
              >
                {waitMutation.isPending ? 'Procesando...' : 'Solicitar Acceso'}
              </Button>
            </div>
          </Card>
        </div>

        {onLogout && (
          <div className="mt-10 text-center">
            <button
              type="button"
              onClick={onLogout}
              className="text-sm text-slate-500 hover:text-slate-700 underline"
            >
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
