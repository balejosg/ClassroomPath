import React, { useState } from 'react';
import { UserPlus, ChevronDown } from 'lucide-react';
import { usePendingUsers } from '../lib/hooks';
import { PendingUsers } from '../views/PendingUsers';
import { useClassroomPathT } from '../i18n/classroompath-i18n';
import { Modal } from '../openpath/public-ui';

interface AdminPanelProps {
  userRole?: string;
}

export function AdminPanel({ userRole }: AdminPanelProps) {
  const t = useClassroomPathT();
  const [isExpanded, setIsExpanded] = useState(false);

  // Only show for admins
  const isAdmin = userRole === 'admin';

  const { data: pendingUsers, isLoading } = usePendingUsers({
    enabled: isAdmin,
    refetchInterval: 30000, // Poll every 30 seconds
  });

  // Don't render anything if not admin or loading
  if (!isAdmin || isLoading) {
    return null;
  }

  const pendingCount = (pendingUsers as any[])?.length || 0;

  // Don't show if no pending users
  if (pendingCount === 0 && !isExpanded) {
    return null;
  }

  return (
    <>
      {/* Notification Bar */}
      {pendingCount > 0 && !isExpanded && (
        <div
          data-testid="admin-pending-users-banner"
          className="fixed top-16 left-0 right-0 z-30 md:left-64"
        >
          <div className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between shadow-md">
            <div className="flex items-center gap-3">
              <div className="bg-amber-600 rounded-full p-1.5">
                <UserPlus size={16} />
              </div>
              <span className="font-medium text-sm">
                {t(
                  pendingCount === 1
                    ? 'admin.pendingUsersBanner.one'
                    : 'admin.pendingUsersBanner.many',
                  { count: pendingCount }
                )}
              </span>
            </div>
            <button
              onClick={() => setIsExpanded(true)}
              className="flex items-center gap-1 bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              {t('admin.review')}
              <ChevronDown size={16} />
            </button>
          </div>
        </div>
      )}

      <Modal
        isOpen={isExpanded}
        onClose={() => setIsExpanded(false)}
        title={t('admin.accessRequests')}
        closeLabel={t('admin.closePanel')}
        className="fixed bottom-0 right-0 top-16 h-[calc(100dvh-4rem)] w-full max-w-3xl rounded-none md:rounded-l-xl"
      >
        <p className="mb-4 text-sm text-slate-500">
          {t(
            pendingCount === 1 ? 'admin.pendingUsersSummary.one' : 'admin.pendingUsersSummary.many',
            { count: pendingCount }
          )}
        </p>
        <PendingUsers />
      </Modal>
    </>
  );
}
