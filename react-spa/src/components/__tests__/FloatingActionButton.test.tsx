import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FloatingActionButton } from '../FloatingActionButton';

describe('FloatingActionButton', () => {
  it('renders with aria-label and calls onClick', () => {
    const onClick = vi.fn();

    render(
      <FloatingActionButton ariaLabel="Open" onClick={onClick}>
        <span>+</span>
      </FloatingActionButton>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
