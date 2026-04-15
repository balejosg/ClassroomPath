import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DualTRPCProvider } from '../dual-trpc-provider';

describe('DualTRPCProvider', () => {
  it('renders children through the real provider stack', () => {
    render(
      <DualTRPCProvider>
        <div>provider child</div>
      </DualTRPCProvider>
    );

    expect(screen.getByText('provider child')).toBeInTheDocument();
  });
});
