import React from 'react';

export function OnboardingAlert({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const className =
    tone === 'error'
      ? 'mb-8 rounded-lg border border-red-200 bg-red-100 p-4 text-sm text-red-700'
      : 'mb-8 rounded-lg border border-green-200 bg-green-100 p-4 text-sm text-green-700';

  return <div className={className}>{message}</div>;
}
