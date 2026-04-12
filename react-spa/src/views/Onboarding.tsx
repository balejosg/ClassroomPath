import React, { useEffect, useState } from 'react';
import { CreditCard, Users } from 'lucide-react';
import { Button, Card, Input } from '@openpath/public-ui';
import {
  createOnboardingPolicy,
  getOnboardingAccessMode,
  resolveAutoSelectedOrganizationId,
  supportsOnlineCheckout,
  shouldShowOnboardingAccessPolicyNotice,
} from '@classroompath/contracts/onboarding-policy';
import type { CreateOrganizationSuccessDto } from '@classroompath/presenters/onboarding';
import {
  useCreateBillingCheckout,
  useCreateManualBillingRequest,
  useListOrganizations,
  useOnboardingStatus,
  useWaitForInvitation,
} from '../lib/hooks';

interface Props {
  onOrgCreated: (result: CreateOrganizationSuccessDto) => void;
  onWaitClick: () => void;
  onLogout?: () => void;
  initialOrgName?: string;
}

export function Onboarding({ initialOrgName, onWaitClick, onLogout }: Props) {
  const [orgName, setOrgName] = useState(initialOrgName ?? '');
  const [classrooms, setClassrooms] = useState('12');
  const [targetOrgId, setTargetOrgId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const statusQuery = useOnboardingStatus();
  const checkoutMutation = useCreateBillingCheckout();
  const manualRequestMutation = useCreateManualBillingRequest();
  const onboardingPolicy = createOnboardingPolicy(statusQuery.data?.policy ?? {});
  const allowsOnlineCheckout = supportsOnlineCheckout(onboardingPolicy);
  const allowOrgDirectory = getOnboardingAccessMode(onboardingPolicy) === 'directory';
  const orgsQuery = useListOrganizations({
    enabled: allowOrgDirectory,
  });
  const waitMutation = useWaitForInvitation();

  useEffect(() => {
    const nextTargetOrgId = resolveAutoSelectedOrganizationId(
      onboardingPolicy,
      orgsQuery.data ?? [],
      targetOrgId
    );
    if (nextTargetOrgId && nextTargetOrgId !== targetOrgId) {
      setTargetOrgId(nextTargetOrgId);
    }
  }, [onboardingPolicy, orgsQuery.data, targetOrgId]);

  const getBillingInput = () => {
    setError('');
    setNotice('');

    if (!orgName.trim()) {
      setError('Debes ingresar un nombre para la organización');
      return null;
    }

    const parsedClassrooms = Number.parseInt(classrooms, 10);
    if (!Number.isInteger(parsedClassrooms) || parsedClassrooms < 1) {
      setError('Debes indicar al menos un aula');
      return null;
    }

    return {
      organizationName: orgName.trim(),
      classrooms: parsedClassrooms,
    };
  };

  const handleCheckout = (kind: 'annual' | 'pilot') => {
    const input = getBillingInput();
    if (!input) return;

    checkoutMutation.mutate(
      { ...input, kind },
      {
        onSuccess: (data) => {
          window.location.href = data.checkoutUrl;
        },
        onError: (err) => {
          setError(err.message || 'No se pudo iniciar el checkout');
        },
      }
    );
  };

  const handleManualRequest = () => {
    const input = getBillingInput();
    if (!input) return;

    manualRequestMutation.mutate(
      {
        ...input,
        kind: 'public_campaign',
        note: 'Solicitud de centro publico desde onboarding',
      },
      {
        onSuccess: () => {
          setNotice('Solicitud enviada. Revisaremos la activación antes de habilitar el centro.');
        },
        onError: (err) => {
          setError(err.message || 'No se pudo enviar la solicitud');
        },
      }
    );
  };

  const handleWait = () => {
    setError('');

    if (allowOrgDirectory && !targetOrgId) {
      setError('Selecciona una organización para solicitar acceso');
      return;
    }

    waitMutation.mutate(allowOrgDirectory ? { targetOrganizationId: targetOrgId } : undefined, {
      onSuccess: () => {
        onWaitClick();
      },
      onError: (err) => {
        setError(err.message || 'Error al procesar solicitud');
      },
    });
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

        <div className="mb-8 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm md:grid-cols-3">
          <div>
            <p className="font-semibold text-slate-900">Open source en la base</p>
            <p className="mt-1">OpenPath aporta un core auditable para la politica digital.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Flujos trazables</p>
            <p className="mt-1">Invitaciones, aprobaciones y cambios siguen un proceso claro.</p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">Produccion oficial en la UE</p>
            <p className="mt-1">ClassroomPath esta alojado en servidores de la UE.</p>
          </div>
        </div>

        {error && (
          <div className="mb-8 p-4 bg-red-100 text-red-700 rounded-lg text-sm border border-red-200">
            {error}
          </div>
        )}

        {notice && (
          <div className="mb-8 p-4 bg-green-100 text-green-700 rounded-lg text-sm border border-green-200">
            {notice}
          </div>
        )}

        <div className="grid gap-8 md:grid-cols-2">
          <Card className="p-8 flex flex-col shadow-md border-t-4 border-t-blue-600">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-blue-100 rounded-lg text-blue-600">
                <CreditCard size={32} />
              </div>
              <h2 className="text-xl font-bold text-gray-800">
                {allowsOnlineCheckout ? 'Contratar centro' : 'Activar centro'}
              </h2>
            </div>
            <p className="text-gray-600 mb-8 leading-relaxed">
              {allowsOnlineCheckout
                ? 'Activa el centro con checkout seguro antes de crear la organización. La cuota anual incluye Stripe Tax y el onboarding queda separado en la primera factura.'
                : 'Los centros públicos pueden solicitar activación sin pago online. Revisaremos la solicitud antes de habilitar la organización.'}
            </p>
            <div className="space-y-4 mt-auto">
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
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-700">
                  Número de aulas
                </label>
                <Input
                  type="number"
                  name="classrooms"
                  data-testid="onboarding-classrooms"
                  value={classrooms}
                  onChange={(e) => setClassrooms(e.target.value)}
                  min="1"
                  required
                />
              </div>
              <div className="grid gap-3">
                {allowsOnlineCheckout ? (
                  <>
                    <Button
                      type="button"
                      onClick={() => handleCheckout('annual')}
                      data-testid="onboarding-start-annual"
                      className="w-full cursor-pointer py-6"
                      disabled={checkoutMutation.isPending}
                    >
                      {checkoutMutation.isPending ? 'Preparando...' : 'Contratar cuota anual'}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => handleCheckout('pilot')}
                      data-testid="onboarding-start-pilot"
                      variant="outline"
                      className="w-full cursor-pointer py-6 border-2"
                      disabled={checkoutMutation.isPending}
                    >
                      Empezar piloto
                    </Button>
                  </>
                ) : null}
                <Button
                  type="button"
                  onClick={handleManualRequest}
                  data-testid="onboarding-request-public-center"
                  variant={allowsOnlineCheckout ? 'ghost' : 'primary'}
                  className="w-full cursor-pointer py-6"
                  disabled={manualRequestMutation.isPending}
                >
                  Soy un centro público
                </Button>
              </div>
            </div>
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
              administrador te agregue. Tu solicitud seguira un flujo institucional trazable.
            </p>
            <div className="mt-auto">
              {!shouldShowOnboardingAccessPolicyNotice(onboardingPolicy) ? (
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
                    <p className="mt-2 text-xs text-red-600">
                      No se pudieron cargar organizaciones.
                    </p>
                  )}
                </div>
              ) : (
                <div
                  data-testid="onboarding-access-policy"
                  className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600"
                >
                  Un administrador de tu institución debe autorizar tu acceso. No mostraremos el
                  directorio ni los nombres de otras organizaciones desde este portal.
                </div>
              )}
              <Button
                onClick={handleWait}
                data-testid="onboarding-wait-invite"
                variant="outline"
                className="w-full cursor-pointer py-6 border-2"
                disabled={waitMutation.isPending || (allowOrgDirectory && orgsQuery.isPending)}
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
