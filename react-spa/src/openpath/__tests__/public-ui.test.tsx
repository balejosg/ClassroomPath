import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@openpath/public-ui', () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  ConfirmDialog: () => <div>Confirm</div>,
  DangerConfirmDialog: () => <div>Danger</div>,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { Button, Card, ConfirmDialog, DangerConfirmDialog, Input, Modal } from '../public-ui';

describe('openpath public-ui adapter', () => {
  it('re-exports the UI surface through the local boundary', () => {
    render(
      <div>
        <Button>Acción</Button>
        <Card>Tarjeta</Card>
        <ConfirmDialog isOpen title="Confirmar" onClose={() => {}} onConfirm={() => {}} />
        <DangerConfirmDialog isOpen title="Peligro" onClose={() => {}} onConfirm={() => {}} />
        <Input aria-label="Campo" />
        <Modal isOpen title="Modal" onClose={() => {}}>
          Modal
        </Modal>
      </div>
    );

    expect(screen.getByRole('button', { name: 'Acción' })).toBeInTheDocument();
    expect(screen.getByText('Tarjeta')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
    expect(screen.getByText('Danger')).toBeInTheDocument();
    expect(screen.getByLabelText('Campo')).toBeInTheDocument();
    expect(screen.getByText('Modal')).toBeInTheDocument();
    expect(typeof Button).toBe('function');
    expect(typeof Card).toBe('function');
  });
});
