import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export function useSidebarTransition() {
  const surfaceRef = useRef<HTMLElement>(null);
  const insideRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const animationsRef = useRef<Animation[]>([]);
  const transitioningRef = useRef(false);
  const [compact, setCompact] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const collapsed = desktop && compact;
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => {
      animationsRef.current.forEach((animation) => animation.cancel());
      setDesktop(media.matches);
    };
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
      animationsRef.current.forEach((animation) => animation.cancel());
    };
  }, []);

  async function toggleSidebar() {
    const surface = surfaceRef.current;
    const inside = insideRef.current;
    const content = contentRef.current;
    if (!surface || !inside || !content || transitioningRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCompact((value) => !value);
      return;
    }
    transitioningRef.current = true;
    setTransitioning(true);
    const animate = async (entries: [Element, Keyframe[]][], duration: number) => {
      const animations = entries.map(([element, frames]) =>
        element.animate(frames, {
          duration,
          easing: 'ease-in-out',
          fill: 'forwards',
        })
      );
      animationsRef.current = animations;
      await Promise.all(animations.map((animation) => animation.finished));
    };
    try {
      await animate([[inside, [{ opacity: 1 }, { opacity: 0 }]]], 160);
      inside.style.opacity = '0';
      animationsRef.current.forEach((animation) => animation.cancel());
      const oldWidth = surface.getBoundingClientRect().width;
      const oldLeft = content.getBoundingClientRect().left;
      flushSync(() => setCompact((value) => !value));
      const nextWidth = surface.getBoundingClientRect().width;
      const nextLeft = content.getBoundingClientRect().left;
      // FLIP: settle the layout once, then move the content with a transform.
      // Its text and cards never interpolate their widths during the resize.
      await animate(
        [
          [surface, [{ width: `${oldWidth}px` }, { width: `${nextWidth}px` }]],
          [
            content,
            [{ transform: `translateX(${oldLeft - nextLeft}px)` }, { transform: 'translateX(0)' }],
          ],
        ],
        280
      );
      animationsRef.current.forEach((animation) => animation.cancel());
      await animate([[inside, [{ opacity: 0 }, { opacity: 1 }]]], 160);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
    } finally {
      animationsRef.current.forEach((animation) => animation.cancel());
      animationsRef.current = [];
      inside.style.opacity = '';
      transitioningRef.current = false;
      setTransitioning(false);
    }
  }

  return { compact, collapsed, transitioning, surfaceRef, insideRef, contentRef, toggleSidebar };
}
