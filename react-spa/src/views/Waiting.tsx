import React, { useEffect } from 'react';
import { RefreshCw, ArrowLeft } from 'lucide-react';
import { Button } from '@openpath/src/components/ui/Button';
import { Card } from '@openpath/src/components/ui/Card';
import { useOnboardingStatus, useCancelWaiting } from '../lib/hooks';

interface Props {
  onStatusChange: () => void;
  onCancelSuccess: () => void;
  onLogout?: () => void;
}

export function Waiting({ onStatusChange, onCancelSuccess, onLogout }: Props) {
  const query = useOnboardingStatus({
    refetchInterval: 30000, // Polling cada 30s
  });

  const { data, refetch, isFetching } = query;

  useEffect(() => {
    if (data?.hasMembership) {
      onStatusChange();
    }
  }, [data, onStatusChange]);

  const cancelMutation = useCancelWaiting();

  const handleCancel = () => {
    cancelMutation.mutate(undefined, {
      onSuccess: () => {
        onCancelSuccess();
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md p-10 text-center shadow-lg">
        <div className="mb-8">
          <div className="mx-auto w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-6">
            <RefreshCw className={`text-blue-600 ${isFetching ? 'animate-spin' : ''}`} size={40} />
          </div>
          <h1 className="text-2xl font-bold mb-3 text-gray-900">Esperando invitación</h1>
          <p className="text-gray-600 leading-relaxed">
            Un administrador de tu institución debe agregarte a la organización. Te redirigiremos
            automáticamente cuando esto suceda.
          </p>
        </div>

        <div className="space-y-4">
          <Button
            onClick={() => refetch()}
            data-testid="waiting-check-now"
            variant="outline"
            className="w-full py-6 border-2 font-semibold"
            disabled={isFetching}
          >
            <RefreshCw size={18} className={`mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Verificando...' : 'Verificar ahora'}
          </Button>

          <Button
            onClick={handleCancel}
            data-testid="waiting-cancel"
            variant="ghost"
            className="w-full py-6 text-gray-500 hover:text-gray-700"
            disabled={cancelMutation.isPending}
          >
            <ArrowLeft size={18} className="mr-2" />
            Cambiar de opinión
          </Button>

          {onLogout && (
            <Button onClick={onLogout} variant="outline" className="w-full py-6 border-2">
              Cerrar sesión
            </Button>
          )}
        </div>

        <p className="mt-8 text-xs text-gray-400">
          Esta página se actualiza automáticamente cada 30 segundos.
        </p>
      </Card>
    </div>
  );
}
