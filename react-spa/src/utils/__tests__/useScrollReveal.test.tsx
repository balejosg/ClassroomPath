import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { useScrollReveal } from '../useScrollReveal';

// ─── helpers ────────────────────────────────────────────────────────────────

type IOCallback = (entries: IntersectionObserverEntry[]) => void;

function makeIOStub(triggerImmediately: boolean) {
  let storedCallback: IOCallback;
  let observedEl: Element | null = null;

  const stub = {
    observe: vi.fn((el: Element) => {
      observedEl = el;
      if (triggerImmediately) {
        storedCallback([{ isIntersecting: true } as any]);
      }
    }),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    _trigger(isIntersecting: boolean) {
      if (storedCallback) {
        storedCallback([{ isIntersecting } as any]);
      }
    },
    get _observed() {
      return observedEl;
    },
  };

  vi.stubGlobal(
    'IntersectionObserver',
    vi.fn(function MockIntersectionObserver(this: unknown, cb: IOCallback) {
      storedCallback = cb;
      return stub;
    }) as unknown as typeof IntersectionObserver
  );

  return stub;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('useScrollReveal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('immediately sets visible to true when IntersectionObserver is unavailable (jsdom default)', () => {
    // Force IO to be undefined
    vi.stubGlobal('IntersectionObserver', undefined);

    const TestComponent = () => {
      const [ref, visible] = useScrollReveal();
      return <div ref={ref as any}>{visible ? 'is-visible' : 'is-hidden'}</div>;
    };

    render(<TestComponent />);

    // In jsdom without IO, it should fallback to visible=true immediately
    expect(screen.getByText('is-visible')).toBeInTheDocument();
  });

  it('uses IntersectionObserver when available to detect visibility', () => {
    const io = makeIOStub(false); // don't trigger immediately

    const TestComponent = () => {
      const [ref, visible] = useScrollReveal();
      return <div ref={ref as any}>{visible ? 'is-visible' : 'is-hidden'}</div>;
    };

    render(<TestComponent />);

    // Initially hidden
    expect(screen.getByText('is-hidden')).toBeInTheDocument();
    expect(io.observe).toHaveBeenCalled();

    // Trigger intersection
    act(() => {
      io._trigger(true);
    });

    // Should now be visible
    expect(screen.getByText('is-visible')).toBeInTheDocument();

    // Should unobserve after finding intersection
    expect(io.unobserve).toHaveBeenCalled();
  });

  it('disconnects the observer on unmount', () => {
    const io = makeIOStub(false);

    const TestComponent = () => {
      const [ref] = useScrollReveal();
      return <div ref={ref as any}>Target</div>;
    };

    const { unmount } = render(<TestComponent />);
    expect(io.observe).toHaveBeenCalled();

    unmount();

    // Cleanup should call disconnect
    expect(io.disconnect).toHaveBeenCalled();
  });

  it('gracefully handles missing threshold or custom threshold', () => {
    const io = makeIOStub(false);

    const TestComponent = ({ threshold }: { threshold?: number }) => {
      const [ref] = useScrollReveal(threshold);
      return <div ref={ref as any}>Target</div>;
    };

    render(<TestComponent threshold={0.5} />);

    // verify the IO constructor was called with the correct threshold
    expect(vi.mocked(IntersectionObserver)).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ threshold: 0.5 })
    );
  });
});
