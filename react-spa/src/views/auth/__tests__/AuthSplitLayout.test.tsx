import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthSplitLayout } from '../AuthSplitLayout';

describe('AuthSplitLayout', () => {
  it('renders the shared hero and injected content', () => {
    render(
      <AuthSplitLayout heroTitle="Acceso seguro">
        <div>Contenido de prueba</div>
      </AuthSplitLayout>
    );

    expect(screen.getByRole('heading', { name: 'Acceso seguro' })).toBeInTheDocument();
    expect(screen.getByText('Contenido de prueba')).toBeInTheDocument();
  });
});
