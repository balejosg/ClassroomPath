import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { BillingStatusBanner } from '../BillingStatusBanner';
import { ClassroomPathI18nProvider } from '../../i18n/classroompath-i18n';

describe('BillingStatusBanner', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when billing info is missing', () => {
    const { container } = render(<BillingStatusBanner billing={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the grace-period warning with the deadline', () => {
    render(
      <BillingStatusBanner
        billing={{
          status: 'grace_period',
          productKind: 'annual',
          expiresAt: null,
          graceEndsAt: '2026-04-20T00:00:00.000Z',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }}
      />
    );

    const alert = screen.getByText(/remains temporarily active/);
    expect(alert).toBeInTheDocument();
    expect(alert).not.toHaveClass('mb-4');
    expect(screen.getByText('04/20/2026')).toBeInTheDocument();
  });

  it('uses the active locale for visible deadline dates', () => {
    render(
      <ClassroomPathI18nProvider locale="en">
        <BillingStatusBanner
          billing={{
            status: 'grace_period',
            productKind: 'annual',
            expiresAt: null,
            graceEndsAt: '2026-04-20T00:00:00.000Z',
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
          }}
        />
      </ClassroomPathI18nProvider>
    );

    expect(screen.getByText('04/20/2026')).toBeInTheDocument();
    expect(screen.queryByText('20/04/2026')).not.toBeInTheDocument();
  });

  it('renders the cancellation notice when the subscription ends at period close', () => {
    render(
      <BillingStatusBanner
        billing={{
          status: 'active',
          productKind: 'annual',
          expiresAt: null,
          graceEndsAt: null,
          currentPeriodEnd: '2026-05-01T00:00:00.000Z',
          cancelAtPeriodEnd: true,
        }}
      />
    );

    expect(screen.getByText(/marked to end/)).toBeInTheDocument();
    expect(screen.getByText('05/01/2026')).toBeInTheDocument();
  });

  it('renders the pilot renewal warning when expiry is within two weeks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));

    render(
      <BillingStatusBanner
        billing={{
          status: 'active',
          productKind: 'pilot',
          expiresAt: '2026-04-10T00:00:00.000Z',
          graceEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }}
      />
    );

    expect(screen.getByText(/The pilot ends on/)).toBeInTheDocument();
    expect(screen.getByText(/04\/10\/2026/)).toBeInTheDocument();
  });

  it('returns no banner for invalid dates or non-expiring pilot states', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));

    const { container } = render(
      <BillingStatusBanner
        billing={{
          status: 'active',
          productKind: 'pilot',
          expiresAt: 'invalid-date',
          graceEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
