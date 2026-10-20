import { useEffect, useState } from 'react';

export interface LiveViewport {
  width: number;
  /** device (not viewport) orientation - stays put when the on-screen keyboard shortens the viewport */
  landscape: boolean;
  /** visible height in px (shrinks with the on-screen keyboard) and its top offset; null until measured / when unsupported -> CSS falls back to 100dvh */
  frame: { height: number; top: number } | null;
}

const isLandscapeDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const type = window.screen?.orientation?.type;
  if (type) return type.startsWith('landscape');
  const s = window.screen;
  return !!s && s.width > s.height;
};

const measure = (): LiveViewport => {
  if (typeof window === 'undefined') return { width: 1024, landscape: true, frame: null };
  const vv = window.visualViewport;
  return {
    width: window.innerWidth,
    landscape: isLandscapeDevice(),
    frame: vv ? { height: Math.round(vv.height), top: Math.round(vv.offsetTop) } : null,
  };
};

/**
 * Live-room viewport: width, device orientation and the VISIBLE height. Browsers differ on what the on-screen keyboard does to `100dvh`
 * (Chrome/Android can overlay it, iOS Safari scrolls the page), so the room frame is sized from the visual viewport instead of a fixed height -
 * the chat composer and the control bar therefore always sit above the keyboard. Updates are coalesced to one per animation frame.
 */
export const useLiveViewport = (): LiveViewport => {
  const [vp, setVp] = useState<LiveViewport>(measure);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const next = measure();
        setVp((prev) => (prev.width === next.width && prev.landscape === next.landscape && prev.frame?.height === next.frame?.height && prev.frame?.top === next.frame?.top ? prev : next));
      });
    };
    const vv = window.visualViewport;
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.screen?.orientation?.addEventListener?.('change', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    update();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.screen?.orientation?.removeEventListener?.('change', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, []);
  return vp;
};
