import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { PolicyLibraryButton } from '../PolicyLibraryButton';
import { ClassroomPathI18nProvider } from '../../i18n/classroompath-i18n';

function renderButton(onClick = vi.fn()) {
  render(
    <ClassroomPathI18nProvider>
      <PolicyLibraryButton onClick={onClick} />
    </ClassroomPathI18nProvider>
  );
  return onClick;
}

describe('PolicyLibraryButton', () => {
  it('renders the labelled action and fires onClick', () => {
    const onClick = renderButton();

    const button = screen.getByRole('button', { name: /policy library/i });
    expect(button).toHaveTextContent(/Import from library/i);

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
