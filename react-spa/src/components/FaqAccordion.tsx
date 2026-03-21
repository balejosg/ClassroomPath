import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { FaqItem } from '../data/faqs';

interface FaqAccordionProps {
  items: FaqItem[];
  sectionLabel?: string;
  sectionTitle?: string;
}

export function FaqAccordion({
  items,
  sectionLabel = 'Preguntas frecuentes',
  sectionTitle = 'Lo que suelen preguntar los centros.',
}: FaqAccordionProps) {
  const [openFaq, setOpenFaq] = React.useState<string | null>(null);

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
            {sectionLabel}
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
            {sectionTitle}
          </h2>
        </div>
        <div className="mt-10 max-w-3xl space-y-3">
          {items.map((item) => {
            const isOpen = openFaq === item.q;
            return (
              <div
                key={item.q}
                className="rounded-xl border border-slate-200 bg-slate-50 shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaq(isOpen ? null : item.q)}
                  className="flex w-full items-center justify-between px-6 py-5 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="text-base font-bold text-slate-900">{item.q}</span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {/* grid-template-rows animation for smooth expand/collapse */}
                <div
                  className="grid transition-all duration-300 ease-in-out"
                  style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                >
                  <div className="overflow-hidden">
                    <p className="px-6 pb-6 text-sm leading-7 text-slate-600">{item.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
