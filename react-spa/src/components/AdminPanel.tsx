import React, { useState } from 'react';
import { UserPlus, X, ChevronDown, ChevronUp } from 'lucide-react';
import { usePendingUsers } from '../lib/hooks';
import { PendingUsers } from '../views/PendingUsers';
import { useClassroomPathT } from '../i18n/classroompath-i18n';

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
        <div className="fixed top-0 left-0 right-0 z-40 md:left-64">
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

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm">
          <div className="fixed top-0 right-0 bottom-0 w-full max-w-3xl bg-white shadow-2xl overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-amber-100 text-amber-600 rounded-lg p-2">
                  <UserPlus size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{t('admin.accessRequests')}</h2>
                  <p className="text-sm text-slate-500">
                    {t(
                      pendingCount === 1
                        ? 'admin.pendingUsersSummary.one'
                        : 'admin.pendingUsersSummary.many',
                      { count: pendingCount }
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                aria-label={t('admin.closePanel')}
                title={t('admin.closePanel')}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <PendingUsers />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
