import React from 'react';

export function FloatingActionButton(props: {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.ariaLabel}
      className={`fixed z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg hover:bg-slate-800 active:bg-slate-950 transition-colors ${
        props.className ?? ''
      }`}
      style={{
        bottom: 'calc(1.25rem + env(safe-area-inset-bottom))',
        right: 'calc(1.25rem + env(safe-area-inset-right))',
      }}
    >
      {props.children}
    </button>
  );
}
