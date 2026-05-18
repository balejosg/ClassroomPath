import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SharedFooter } from '../SharedFooter';

describe('SharedFooter', () => {
  it('renders brand name and legal links', () => {
    render(<SharedFooter />);

    expect(screen.getByText('ClassroomPath')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Legal notice' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toBeInTheDocument();
  });

  it('renders the OpenPath link pointing to GitHub', () => {
    render(<SharedFooter />);

    const link = screen.getByRole('link', { name: 'OpenPath ↗' });
    expect(link).toHaveAttribute('href', 'https://github.com/balejosg/openpath');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders the contact email', () => {
    render(<SharedFooter />);

    expect(screen.getByRole('link', { name: 'hola@classroompath.com' })).toBeInTheDocument();
  });
});
