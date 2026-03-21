import { useEffect, useRef, useState } from 'react';

/**
 * Lightweight scroll-reveal hook using IntersectionObserver.
 * Returns a ref and a boolean; attach the ref to the element and use the
 * boolean to toggle an opacity/translate class.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  threshold = 0.15
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // IntersectionObserver is not available in jsdom/test environments
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.unobserve(element);
        }
      },
      { threshold }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, visible];
}
