import React from 'react';
import { CreditCard, Users } from 'lucide-react';
import { Button, Card, Input } from '../../openpath/public-ui';
import {
  shouldShowOnboardingAccessPolicyNotice,
  type OnboardingPolicy,
} from '@classroompath/contracts/onboarding-policy';
import type { OrganizationSummaryDto } from '@classroompath/presenters/onboarding';

type BillingInputState = {
  orgName: string;
  classrooms: string;
};

type OrganizationOption = OrganizationSummaryDto;

export function OnboardingBillingCard(props: {
  allowsOnlineCheckout: boolean;
  billingInput: BillingInputState;
  checkoutPending: boolean;
  manualRequestPending: boolean;
  onBillingInputChange: (field: keyof BillingInputState, value: string) => void;
  onCheckout: (kind: 'annual' | 'pilot') => void;
  onManualRequest: () => void;
}) {
  const { allowsOnlineCheckout, billingInput } = props;

  return (
    <Card className="flex flex-col border-t-4 border-t-blue-600 p-8 shadow-md">
      <div className="mb-6 flex items-center gap-4">
        <div className="rounded-lg bg-blue-100 p-3 text-blue-600">
          <CreditCard size={32} />
        </div>
        <h2 className="text-xl font-bold text-gray-800">
          {allowsOnlineCheckout ? 'Contratar centro' : 'Activar centro'}
        </h2>
      </div>
      <p className="mb-8 text-gray-600 leading-relaxed">
        {allowsOnlineCheckout
          ? 'Activa el centro con checkout seguro antes de crear la organización. La cuota anual incluye Stripe Tax y el onboarding queda separado en la primera factura.'
          : 'Los centros públicos pueden solicitar activación sin pago online. Revisaremos la solicitud antes de habilitar la organización.'}
      </p>
      <div className="mt-auto space-y-4">
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-700">
            Nombre de la organización
          </label>
          <Input
            type="text"
            name="orgName"
            data-testid="onboarding-org-name"
            value={billingInput.orgName}
            onChange={(event) => props.onBillingInputChange('orgName', event.target.value)}
            placeholder="Ej: Colegio San José"
            maxLength={100}
            required
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-gray-700">Número de aulas</label>
          <Input
            type="number"
            name="classrooms"
            data-testid="onboarding-classrooms"
            value={billingInput.classrooms}
            onChange={(event) => props.onBillingInputChange('classrooms', event.target.value)}
            min="1"
            required
          />
        </div>
        <div className="grid gap-3">
          {allowsOnlineCheckout ? (
            <>
              <Button
                type="button"
                onClick={() => props.onCheckout('annual')}
                data-testid="onboarding-start-annual"
                className="w-full cursor-pointer py-6"
                disabled={props.checkoutPending}
              >
                {props.checkoutPending ? 'Preparando...' : 'Contratar cuota anual'}
              </Button>
              <Button
                type="button"
                onClick={() => props.onCheckout('pilot')}
                data-testid="onboarding-start-pilot"
                variant="outline"
                className="w-full cursor-pointer border-2 py-6"
                disabled={props.checkoutPending}
              >
                Empezar piloto
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            onClick={props.onManualRequest}
            data-testid="onboarding-request-public-center"
            variant={allowsOnlineCheckout ? 'ghost' : 'primary'}
            className="w-full cursor-pointer py-6"
            disabled={props.manualRequestPending}
          >
            Soy un centro público
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function OnboardingInvitationCard(props: {
  allowOrgDirectory: boolean;
  onboardingPolicy: OnboardingPolicy;
  organizations: OrganizationOption[];
  organizationsPending: boolean;
  organizationsError: boolean;
  targetOrgId: string;
  waitPending: boolean;
  onTargetOrgChange: (value: string) => void;
  onWait: () => void;
}) {
  return (
    <Card className="flex flex-col border-t-4 border-t-green-600 p-8 shadow-md">
      <div className="mb-6 flex items-center gap-4">
        <div className="rounded-lg bg-green-100 p-3 text-green-600">
          <Users size={32} />
        </div>
        <h2 className="text-xl font-bold text-gray-800">Esperar invitación</h2>
      </div>
      <p className="mb-8 text-gray-600 leading-relaxed">
        Si tu institución ya utiliza ClassroomPath, puedes solicitar acceso y esperar a que un
        administrador te agregue. Tu solicitud seguira un flujo institucional trazable.
      </p>
      <div className="mt-auto">
        {!shouldShowOnboardingAccessPolicyNotice(props.onboardingPolicy) ? (
          <div className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-gray-700">Organización</label>
            <select
              name="targetOrganization"
              data-testid="onboarding-target-org"
              value={props.targetOrgId}
              onChange={(event) => props.onTargetOrgChange(event.target.value)}
              className="flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={props.organizationsPending}
            >
              <option value="">Seleccionar organización...</option>
              {props.organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            {props.organizationsError ? (
              <p className="mt-2 text-xs text-red-600">No se pudieron cargar organizaciones.</p>
            ) : null}
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
          onClick={props.onWait}
          data-testid="onboarding-wait-invite"
          variant="outline"
          className="w-full cursor-pointer border-2 py-6"
          disabled={props.waitPending || (props.allowOrgDirectory && props.organizationsPending)}
        >
          {props.waitPending ? 'Procesando...' : 'Solicitar Acceso'}
        </Button>
      </div>
    </Card>
  );
}
