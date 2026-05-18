import React from 'react';
import { Copy, X } from 'lucide-react';

import type { RulesPage } from './group-library-helpers';

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
};

export function RulesPreviewModal(props: RulesPreviewModalProps) {
  const rules = props.page?.rules ?? [];
  const total = props.page?.total ?? 0;
  const hasMore = props.page?.hasMore ?? false;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm">
      <div className="fixed inset-x-0 bottom-0 top-0 md:inset-y-10 md:left-1/2 md:-translate-x-1/2 md:max-w-3xl bg-white md:rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{props.title}</h3>
            <p className="text-sm text-slate-500">{props.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-5 pt-4 flex items-center gap-3">
          <input
            value={props.search}
            onChange={(event) => props.onSearchChange(event.target.value)}
            placeholder="Search domain..."
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

        <div className="p-5 flex-1 overflow-y-auto">
          {props.isLoading ? (
            <div className="text-sm text-slate-500">Loading rules...</div>
          ) : rules.length ? (
            <div className="space-y-3">
              <div className="text-xs text-slate-500">
                Total: {total} (showing {rules.length})
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2">Type</th>
                      <th className="text-left font-semibold px-3 py-2">Domain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr key={rule.id} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                          {rule.type}
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
                  Previous
                </button>
                <button
                  type="button"
                  onClick={props.onNextPage}
                  disabled={!hasMore}
                  className="text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 disabled:opacity-60"
                >
                  Next
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">{props.emptyText}</div>
          )}
        </div>
      </div>
    </div>
  );
}
