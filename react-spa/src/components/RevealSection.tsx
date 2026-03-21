import type { ReactNode } from 'react';
import { useScrollReveal } from '../utils/useScrollReveal';

interface RevealSectionProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

/**
 * Wraps a section with a fade-in-up animation triggered on scroll.
 */
export function RevealSection({ children, className = '', id }: RevealSectionProps) {
  const [ref, visible] = useScrollReveal<HTMLElement>(0.1);

  return (
    <section
      ref={ref}
      id={id}
      className={`transition-all duration-700 ease-out ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
      } ${className}`}
    >
      {children}
    </section>
  );
}
