import React from 'react';
import { Copy } from 'lucide-react';

import type { RulesPage } from './group-library-helpers';
import type { ClassroomPathT } from '../../i18n/classroompath-i18n';
import { Modal } from '../../openpath/public-ui';

type RulesPreviewModalProps = {
  title: string;
  subtitle: string;
  search: string;
  onSearchChange: (next: string) => void;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  primaryActionDisabled: boolean;
  onClose: () => void;
  isLoading: boolean;
  page?: RulesPage;
  offset: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  emptyText: string;
  t: ClassroomPathT;
};

function getRuleTypeLabel(type: string, t: ClassroomPathT): string {
  switch (type) {
    case 'allow':
    case 'whitelist':
      return t('groupLibrary.ruleType.allow');
    case 'deny':
    case 'blocked_subdomain':
    case 'block_subdomain':
      return t('groupLibrary.ruleType.deny');
    case 'blocked_path':
    case 'block_path':
      return t('groupLibrary.ruleType.blockPath');
    default:
      return type;
  }
}

export function RulesPreviewModal(props: RulesPreviewModalProps) {
  const rules = props.page?.rules ?? [];
  const total = props.page?.total ?? 0;
  const hasMore = props.page?.hasMore ?? false;

  return (
    <Modal
      isOpen
      onClose={props.onClose}
      title={props.title}
      closeLabel={props.t('app.common.close')}
      className="h-[calc(100dvh-5rem)] max-w-3xl"
      bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div
        data-testid="rules-preview-modal-controls"
        className="border-b border-slate-200 px-5 py-4"
      >
        <p className="mb-4 text-sm text-slate-500">{props.subtitle}</p>
        <div className="flex items-center gap-3">
          <input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder={props.t('groupLibrary.preview.searchPlaceholder')}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
          <button
            type="button"
            onClick={props.onPrimaryAction}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-3 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
            disabled={props.primaryActionDisabled}
          >
            <Copy size={16} />
            {props.primaryActionLabel}
          </button>
        </div>
      </div>

      <div data-testid="rules-preview-modal-body" className="min-h-0 flex-1 overflow-y-auto p-5">
        {props.isLoading ? (
          <div className="text-sm text-slate-500">
            {props.t('groupLibrary.preview.loadingRules')}
          </div>
        ) : rules.length ? (
          <div className="space-y-3">
            <div className="text-xs text-slate-500">
              {props.t('groupLibrary.preview.total', { total, count: rules.length })}
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">
                      {props.t('groupLibrary.preview.type')}
                    </th>
                    <th className="text-left font-semibold px-3 py-2">
                      {props.t('groupLibrary.preview.domain')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                        {getRuleTypeLabel(rule.type, props.t)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-900 break-all">
                        {rule.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={props.onPrevPage}
                disabled={props.offset === 0}
                className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 disabled:opacity-60"
              >
                {props.t('groupLibrary.previous')}
              </button>
              <button
                type="button"
                onClick={props.onNextPage}
                disabled={!hasMore}
                className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 disabled:opacity-60"
              >
                {props.t('groupLibrary.next')}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">{props.emptyText}</div>
        )}
      </div>
    </Modal>
  );
}
