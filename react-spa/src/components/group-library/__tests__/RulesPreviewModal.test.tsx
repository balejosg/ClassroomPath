import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { RulesPreviewModal } from '../RulesPreviewModal';

describe('RulesPreviewModal', () => {
  it('renders rules and forwards preview actions', () => {
    const onClose = vi.fn();
    const onPrimaryAction = vi.fn();
    const onPrevPage = vi.fn();
    const onNextPage = vi.fn();

    render(
      <RulesPreviewModal
        title="Vista previa"
        subtitle="Solo lectura"
        search="math"
        onSearchChange={() => undefined}
        primaryActionLabel="Clone"
        onPrimaryAction={onPrimaryAction}
        primaryActionDisabled={false}
        onClose={onClose}
        isLoading={false}
        page={{
          total: 2,
          hasMore: true,
          rules: [
            { id: 'rule-1', type: 'allow', value: 'math.example.com' },
            { id: 'rule-2', type: 'deny', value: 'science.example.com' },
          ],
        }}
        offset={0}
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
        emptyText="Sin reglas"
      />
    );

    expect(screen.getByText('Vista previa')).toBeInTheDocument();
    expect(screen.getByText('math.example.com')).toBeInTheDocument();
    expect(screen.getByText('science.example.com')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNextPage).toHaveBeenCalledTimes(1);
    expect(onPrevPage).not.toHaveBeenCalled();
  });

  it('shows a loading state while rules are being fetched', () => {
    render(
      <RulesPreviewModal
        title="Vista previa"
        subtitle="Solo lectura"
        search=""
        onSearchChange={() => undefined}
        primaryActionLabel="Clone"
        onPrimaryAction={() => undefined}
        primaryActionDisabled={false}
        onClose={() => undefined}
        isLoading
        offset={0}
        onPrevPage={() => undefined}
        onNextPage={() => undefined}
        emptyText="Sin reglas"
      />
    );

    expect(screen.getByText('Loading rules...')).toBeInTheDocument();
  });

  it('shows the empty state when no rules are available', () => {
    render(
      <RulesPreviewModal
        title="Vista previa"
        subtitle="Solo lectura"
        search=""
        onSearchChange={() => undefined}
        primaryActionLabel="Clone"
        onPrimaryAction={() => undefined}
        primaryActionDisabled={false}
        onClose={() => undefined}
        isLoading={false}
        page={{ total: 0, hasMore: false, rules: [] }}
        offset={50}
        onPrevPage={() => undefined}
        onNextPage={() => undefined}
        emptyText="Sin reglas"
      />
    );

    expect(screen.getByText('Sin reglas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anterior' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument();
  });
});
