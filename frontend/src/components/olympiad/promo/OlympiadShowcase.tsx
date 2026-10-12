import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Laptop, Pause, Play, Sparkles, Star, Trophy,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { olympiadApi } from '../../../services/olympiad';
import { OLYMPIAD_PROMO, OLYMPIAD_PROMO_ARTWORKS, OLYMPIAD_PROMO_STANDARDS } from './olympiadPromoData';
import './olympiadShowcase.css';

/**
 * TOP promotional banner for the LearnIQ All India Olympiad Test 2026.
 * Rendered directly under the navbar, above the "Learn Smarter. Grow Better." hero.
 *
 * TEN individually selectable standards (Std 1 … Std 10). Exactly one standard is
 * active and exactly one poster is visible. Each standard reuses its official source
 * poster (Std 1–3 → Test 1 artwork, 4–6 → Test 2, 7–8 → Test 3, 9–10 → Test 4), but
 * every piece of text, the CTA and the selection always name ONE standard only.
 *
 * No animation library: the load-in is a CSS keyframe sequence; poster switching is CSS
 * transitions keyed off classes; pointer effects (banner tilt + spotlight, poster tilt +
 * spotlight) are CSS custom properties written from one requestAnimationFrame loop that
 * only runs while something is still settling. Autoplay is driven by the progress bar's
 * own CSS animation (`animationend` → next), so pausing is just `animation-play-state`.
 */

const ARTWORKS = OLYMPIAD_PROMO_ARTWORKS;
const STANDARDS = OLYMPIAD_PROMO_STANDARDS;
const N = STANDARDS.length; // 10
const POSTER_TILT = 4; // degrees, the poster itself
const BANNER_TILT = 1.6; // degrees, the whole banner — kept very subtle
const MANUAL_HOLD_MS = 15000; // autoplay rests this long after the visitor picks a standard

type Motion = { rx: number; ry: number; h: number; sx: number; sy: number; bx: number; by: number; bh: number; cx: number; cy: number };
const ZERO: Motion = { rx: 0, ry: 0, h: 0, sx: 0, sy: 0, bx: 0, by: 0, bh: 0, cx: 0, cy: 0 };
// smoothing per property at 60 fps (higher = snappier); scaled by real frame time below
const EASE: Motion = { rx: 0.42, ry: 0.42, h: 0.34, sx: 0.7, sy: 0.7, bx: 0.2, by: 0.2, bh: 0.18, cx: 0.35, cy: 0.35 };
const KEYS = Object.keys(ZERO) as (keyof Motion)[];
const PX_KEYS = new Set<keyof Motion>(['sx', 'sy', 'cx', 'cy']);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const vars = (v: Record<string, string | number>) => v as React.CSSProperties;

const useMediaQuery = (query: string) => {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
};

const posterAlt = (std: number, art: number) =>
  `LearnIQ All India Olympiad Test 2026 poster for Standard ${std}. Subjects: ${ARTWORKS[art].subjects.map(s => s.name).join(', ')}. ` +
  `Test link open 1 to 5 October 2026. Mode: online. Fees: ₹${OLYMPIAD_PROMO.fee} only. Scan the QR code to register at learniq-livid.vercel.app.`;

const DECOR: { node: React.ReactNode; className: string; dur: number; delay: number; rot?: number }[] = [
  { node: <Star className="w-4 h-4 fill-current" />, className: 'top-[3%] left-[8%] text-[#FFC24B]', dur: 4.2, delay: 0, rot: 14 },
  { node: <Sparkles className="w-5 h-5" />, className: 'top-[6%] right-[8%] text-[#B69CF2]', dur: 5, delay: 0.8 },
  { node: <span className="oly-symbol text-2xl">π</span>, className: 'top-[46%] left-[1%] text-[#6C63F2]/35 hidden xl:block', dur: 4.6, delay: 0.4, rot: -8 },
  { node: <span className="oly-symbol text-xl">√x</span>, className: 'bottom-[18%] right-[1%] text-[#E1447A]/40 hidden xl:block', dur: 5.4, delay: 1.2, rot: 8 },
];

/** active = selected standard index (0 → Std 1); art = the one visible poster */
type View = { active: number; art: number; leavingArt: number; dir: 1 | -1; bump: number };

const OlympiadShowcase: React.FC = () => {
  const { user } = useAuth();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');
  const pointerFx = finePointer && !reduced;

  const [view, setView] = useState<View>({ active: 0, art: STANDARDS[0].artwork, leavingArt: -1, dir: 1, bump: 0 });
  const { active, art, leavingArt, dir, bump } = view;
  const [autoplayPref, setAutoplayPref] = useState<boolean | null>(null); // null → default (on unless reduced motion)
  const [manualHold, setManualHold] = useState(false);
  const [hoverZones, setHoverZones] = useState(0); // bitmask: 1 poster, 2 standard details / selector
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [inView, setInView] = useState(true);
  const [entered, setEntered] = useState(false);
  const [warm, setWarm] = useState(false); // load the other three posters after the page has settled

  const autoplay = autoplayPref ?? !reduced;
  const playing = autoplay && !manualHold && hoverZones === 0 && !keyboardFocus && inView && entered;

  /** move to standard index `to`; the poster only changes when the source artwork changes */
  const change = useCallback((to: number, direction?: 1 | -1) => {
    setView(v => {
      const target = ((to % N) + N) % N;
      if (target === v.active) return v;
      const d: 1 | -1 = direction ?? (target > v.active ? 1 : -1);
      const nextArt = STANDARDS[target].artwork;
      return nextArt === v.art
        ? { ...v, active: target, dir: d, bump: v.bump + 1 } // same poster: gentle refresh
        : { active: target, art: nextArt, leavingArt: v.art, dir: d, bump: v.bump };
    });
  }, []);
  const stepAuto = useCallback(() => setView(v => {
    const target = (v.active + 1) % N;
    const nextArt = STANDARDS[target].artwork;
    return nextArt === v.art
      ? { ...v, active: target, dir: 1, bump: v.bump + 1 }
      : { active: target, art: nextArt, leavingArt: v.art, dir: 1, bump: v.bump };
  }), []);

  // a visitor's own choice pauses autoplay for a while
  const userChose = useRef(false);
  const holdTimer = useRef<number | null>(null);
  const holdAutoplay = () => {
    userChose.current = true;
    setManualHold(true);
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => setManualHold(false), MANUAL_HOLD_MS);
  };
  useEffect(() => () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); }, []);
  const choose = (to: number) => { holdAutoplay(); setWarm(true); change(to); };
  const stepByUser = (delta: 1 | -1) => { holdAutoplay(); setWarm(true); change(active + delta, delta); };

  // a logged-in student starts on their own standard
  const myStd = user?.role === 'student' && user.currentStandard ? Number(user.currentStandard) : 0;
  useEffect(() => {
    if (myStd >= 1 && myStd <= N && !userChose.current) change(myStd - 1);
  }, [myStd, change]);

  // …and their CTA opens their own Olympiad exam page (the server only lists the exam for their standard)
  const [myExamId, setMyExamId] = useState<string | null>(null);
  useEffect(() => {
    if (!myStd) { setMyExamId(null); return; }
    let alive = true;
    olympiadApi.listExams()
      .then(list => { if (alive) setMyExamId(list.find(e => Number(e.standard) === myStd)?._id ?? null); })
      .catch(() => { /* fall back to the exams list page */ });
    return () => { alive = false; };
  }, [myStd]);

  const sectionRef = useRef<HTMLElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);

  /* ---------- load-in sequence + lazy warm-up of the other posters ---------- */
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setEntered(true)); });
    const t = window.setTimeout(() => setWarm(true), 1500);
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); window.clearTimeout(t); };
  }, []);
  useEffect(() => {
    if (!warm) return;
    sectionRef.current?.querySelectorAll<HTMLImageElement>('.oly-img').forEach(img => {
      img.decode?.().catch(() => { /* decodes on first paint instead */ });
    });
  }, [warm]);

  /* ---------- pointer-driven motion (one rAF loop, stops when settled) ---------- */
  const target = useRef<Motion>({ ...ZERO });
  const current = useRef<Motion>({ ...ZERO });
  const frame = useRef<number | null>(null);
  const lastTime = useRef(0);

  const tick = useCallback((now: number) => {
    const el = sectionRef.current;
    const t = target.current;
    const c = current.current;
    // frame-rate independent smoothing (same feel on 60 Hz and 120 Hz screens)
    const steps = lastTime.current ? clamp((now - lastTime.current) / 16.667, 0.25, 4) : 1;
    lastTime.current = now;
    let moving = false;
    for (const k of KEYS) {
      const d = t[k] - c[k];
      if (Math.abs(d) > 0.005) {
        c[k] += d * (1 - Math.pow(1 - EASE[k], steps));
        moving = true;
      } else {
        c[k] = t[k];
      }
    }
    if (el) {
      const s = el.style;
      for (const k of KEYS) s.setProperty(`--${k}`, c[k].toFixed(PX_KEYS.has(k) ? 1 : 3));
    }
    frame.current = moving ? requestAnimationFrame(tick) : null;
  }, []);

  const kick = useCallback(() => {
    if (frame.current == null) {
      lastTime.current = 0;
      frame.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null; // lets the loop restart after a remount (React StrictMode / hot reload)
  }, []);

  // touch / reduced motion: everything back to rest; new poster under the cursor: poster tilt back to rest
  useEffect(() => {
    target.current = { ...ZERO };
    kick();
  }, [pointerFx, kick]);
  useEffect(() => {
    const t = target.current;
    t.rx = 0; t.ry = 0; t.h = 0;
    kick();
  }, [art, kick]);

  // whole banner: very subtle tilt, lift and a soft spotlight that follows the cursor
  const onBannerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerFx || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = clamp((e.clientX - r.left) / r.width, 0, 1);
    const py = clamp((e.clientY - r.top) / r.height, 0, 1);
    const t = target.current;
    t.by = (px - 0.5) * 2 * BANNER_TILT;
    t.bx = (0.5 - py) * 2 * BANNER_TILT;
    t.cx = e.clientX - r.left;
    t.cy = e.clientY - r.top;
    if (current.current.bh < 0.02) {
      current.current.cx = t.cx;
      current.current.cy = t.cy;
    }
    t.bh = 1;
    kick();
  };
  const onBannerLeave = () => {
    const t = target.current;
    t.bx = 0; t.by = 0; t.bh = 0;
    kick();
  };

  // the poster itself: its own tilt, spotlight, glow and lift
  const onCardMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerFx || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = clamp((e.clientX - r.left) / r.width, 0, 1);
    const py = clamp((e.clientY - r.top) / r.height, 0, 1);
    const t = target.current;
    t.ry = (px - 0.5) * 2 * POSTER_TILT; // cursor left → left edge dips away
    t.rx = (0.5 - py) * 2 * POSTER_TILT; // cursor up → top edge dips away
    t.sx = e.clientX - r.left;
    t.sy = e.clientY - r.top;
    if (current.current.h < 0.02) {
      current.current.sx = t.sx;
      current.current.sy = t.sy;
    }
    t.h = 1;
    kick();
  };
  const onCardLeave = () => {
    const t = target.current;
    t.rx = 0; t.ry = 0; t.h = 0;
    kick();
  };

  /* ---------- pause autoplay while the banner is scrolled out of view ---------- */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* ---------- touch swipe on the poster ---------- */
  const drag = useRef<{ id: number; x: number; y: number; dx: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    const deck = deckRef.current;
    deck?.classList.remove('is-dragging');
    deck?.style.setProperty('--drag', '0');
    suppressClick.current = true;
    window.setTimeout(() => { suppressClick.current = false; }, 350);
    if (d.dx <= -45) stepByUser(1);
    else if (d.dx >= 45) stepByUser(-1);
  };

  const deckHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse') return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.active) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          d.active = true;
          deckRef.current?.classList.add('is-dragging');
          try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
        } else if (Math.abs(dy) > 12) {
          drag.current = null; // vertical scroll wins
          return;
        } else {
          return;
        }
      }
      d.dx = dx;
      if (!reduced) deckRef.current?.style.setProperty('--drag', (dx * 0.45).toFixed(1));
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); stepByUser(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepByUser(-1); }
      else if (e.key === 'Home') { e.preventDefault(); choose(0); }
      else if (e.key === 'End') { e.preventDefault(); choose(N - 1); }
    },
  };

  const hoverZone = (bit: number) => ({
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType !== 'touch') setHoverZones(z => z | bit); },
    onPointerLeave: () => setHoverZones(z => z & ~bit),
  });

  /* ---------- magnetic CTA ---------- */
  const onMagnetMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!pointerFx || e.pointerType !== 'mouse') return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--tx', `${clamp((e.clientX - (r.left + r.width / 2)) * 0.2, -8, 8).toFixed(1)}px`);
    el.style.setProperty('--ty', `${clamp((e.clientY - (r.top + r.height / 2)) * 0.3, -6, 6).toFixed(1)}px`);
  };
  const onMagnetLeave = (e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty('--tx', '0px');
    e.currentTarget.style.setProperty('--ty', '0px');
  };

  /* ---------- standard selector (roving focus) ---------- */
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % N;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + N) % N;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = N - 1;
    if (to < 0) return;
    e.preventDefault();
    choose(to);
    tabRefs.current[to]?.focus();
  };
  // keep the selected chip visible in the scrollable mobile row (without scrolling the page)
  useEffect(() => {
    const btn = tabRefs.current[active];
    const row = btn?.parentElement;
    if (!btn || !row || row.scrollWidth <= row.clientWidth + 1) return;
    const left = btn.offsetLeft - row.offsetLeft - (row.clientWidth - btn.offsetWidth) / 2;
    row.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
  }, [active, reduced]);

  const std = STANDARDS[active].std;
  const artwork = ARTWORKS[art];

  /* ---------- CTA for the SELECTED standard only (existing routes) ---------- */
  const cta = useMemo(() => {
    if (!user) return { kind: 'link' as const, to: '/register', label: `Register for Standard ${std}`, note: null as string | null, loginHint: true };
    if (user.role === 'student') {
      if (myStd && myStd !== std) {
        return {
          kind: 'switch' as const, to: '', label: `Go to Standard ${myStd}`, loginHint: false,
          note: `Your LearnIQ account is registered for Standard ${myStd}.`,
        };
      }
      return {
        kind: 'link' as const,
        to: myExamId ? `/student/olympiad/${myExamId}` : '/student/exams',
        label: `Register for Standard ${std}`, note: null, loginHint: false,
      };
    }
    if (user.role === 'admin') return { kind: 'link' as const, to: '/admin/olympiad', label: 'Manage Olympiad', note: null, loginHint: false };
    return { kind: 'link' as const, to: '/dashboard', label: 'Open Dashboard', note: null, loginHint: false };
  }, [user, std, myStd, myExamId]);

  const ctaInner = (
    <>
      <span className="oly-cta-glow" aria-hidden="true" />
      <span className="oly-cta-bg" aria-hidden="true" />
      <span className="oly-cta-label">
        {cta.label}
        <ArrowRight className="oly-cta-arrow w-[18px] h-[18px]" aria-hidden="true" />
      </span>
    </>
  );

  return (
    <section
      ref={sectionRef}
      id="olympiad-2026"
      aria-labelledby="olympiad-2026-heading"
      className="oly-top clip-x"
      style={vars({ '--oly-accent': artwork.accent })}
      onFocus={e => { if ((e.target as HTMLElement).matches?.(':focus-visible')) setKeyboardFocus(true); }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false); }}
    >
      {/* the navbar is fixed (64px tall) → start just below it */}
      <div className="page-container pt-[76px] sm:pt-[84px] pb-1">
        <div className={`oly-banner-enter ${entered ? 'is-in' : ''}`}>
          <div className="oly-banner-aura" aria-hidden="true" />
          <div className="oly-banner-shadow" aria-hidden="true" />

          <div className="oly-banner" onPointerMove={onBannerMove} onPointerLeave={onBannerLeave}>
            <div className="oly-banner-grid" aria-hidden="true" />
            <div className="oly-banner-spot" aria-hidden="true" />
            <div className="oly-banner-border" aria-hidden="true"><span className="oly-sweep" /></div>

            <div className="oly-banner-inner relative z-[2] grid grid-cols-1 lg:grid-cols-12 gap-x-8 xl:gap-x-12 gap-y-5 sm:gap-y-6 px-4 py-5 sm:p-7 lg:px-10 lg:py-8">
              {/* A · campaign heading (never names a standard range) */}
              <header className="min-w-0 lg:col-span-7 lg:row-start-1 self-end text-center lg:text-left">
                <p className="oly-eyebrow oly-stagger" style={vars({ '--d': 0 })}>
                  <span className="oly-eyebrow-line" />
                  <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                  LEARNIQ PRESENTS
                </p>
                <h2
                  id="olympiad-2026-heading"
                  className="oly-title oly-stagger font-display font-black text-[1.75rem] leading-[1.08] sm:text-[2.6rem] xl:text-[3.1rem] tracking-tight mt-3 text-[#22243A] dark:text-[#F4F4FA]"
                  style={vars({ '--d': 1 })}
                >
                  All India <span className="gradient-text">Olympiad</span>
                  <br />
                  Test 2026
                </h2>
                <p
                  className="oly-tagline-line oly-stagger hidden sm:block mt-3 text-base leading-relaxed text-[#6B6E8C] dark:text-[#A6A8C4]"
                  style={vars({ '--d': 2 })}
                >
                  <span className="font-semibold text-[#22243A] dark:text-[#F4F4FA]">Think. Explore. Achieve.</span>{' '}
                  Challenge yourself with LearnIQ’s online Olympiad.
                </p>
                <div
                  className="oly-stagger mt-4 sm:mt-5 flex flex-wrap items-center justify-center lg:justify-start gap-2 sm:gap-2.5"
                  style={vars({ '--d': 3 })}
                >
                  <span className="oly-fee" aria-label={`Registration fee: ₹${OLYMPIAD_PROMO.fee} only`}>
                    <span className="oly-fee-amount">₹{OLYMPIAD_PROMO.fee}</span>
                    <span className="oly-fee-only">ONLY</span>
                    <Sparkles className="oly-twinkle w-4 h-4" aria-hidden="true" />
                    <Sparkles className="oly-twinkle oly-twinkle--small w-3 h-3" aria-hidden="true" />
                  </span>
                  <span className="oly-date">
                    <CalendarDays className="w-4 h-4" aria-hidden="true" />
                    <span>1–5 OCTOBER 2026</span>
                  </span>
                  <span className="oly-chip hidden min-[400px]:inline-flex">
                    <Laptop className="w-4 h-4 text-[#6C63F2] dark:text-[#C4ADFF]" aria-hidden="true" />
                    ONLINE
                  </span>
                </div>
              </header>

              {/* B · the ONE active poster */}
              <div className="oly-poster-col min-w-0 lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:row-span-2 self-center">
                <div className="oly-poster-glow" aria-hidden="true" />
                {DECOR.map((d, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className={`oly-float ${d.className}`}
                    style={vars({ '--dur': `${d.dur}s`, '--delay': `${d.delay}s`, '--rot': `${d.rot ?? 6}deg` })}
                  >
                    {d.node}
                  </span>
                ))}
                <div className="oly-poster-enter">
                  <div
                    ref={deckRef}
                    className={`oly-deck ${bump > 0 ? (bump % 2 ? 'bump-a' : 'bump-b') : ''}`}
                    role="region"
                    aria-roledescription="carousel"
                    aria-label={`All India Olympiad Test 2026 poster, Standard ${std}`}
                    aria-describedby="oly-deck-help"
                    tabIndex={0}
                    style={vars({ '--dir': dir })}
                    {...deckHandlers}
                    {...hoverZone(1)}
                  >
                    <p id="oly-deck-help" className="sr-only">One standard is shown at a time. Use the left and right arrow keys to change the standard.</p>
                    {ARTWORKS.map((x, i) => {
                      const isActive = i === art;
                      const state = isActive ? 'is-active' : i === leavingArt ? 'is-leaving' : '';
                      return (
                        <div
                          key={x.id}
                          className={`oly-slide ${state}`}
                          role="group"
                          aria-roledescription="slide"
                          aria-label={isActive ? `Standard ${std}` : undefined}
                          aria-hidden={!isActive}
                          style={vars({ '--slide-accent': x.accent, '--slide-soft': x.soft })}
                          onPointerMove={isActive ? onCardMove : undefined}
                          onPointerLeave={isActive ? onCardLeave : undefined}
                        >
                          <div className="oly-tilt">
                            <div className="oly-shadow" />
                            <div className="oly-ring" />
                            <div className="oly-card">
                              {(isActive || warm || i === leavingArt) && (
                                <img
                                  className="oly-img"
                                  src={x.poster.src}
                                  srcSet={`${x.poster.srcSmall} 640w, ${x.poster.src} 1080w`}
                                  sizes="(min-width: 1280px) 368px, (min-width: 1024px) 340px, (min-width: 640px) 320px, 280px"
                                  width={1080}
                                  height={1350}
                                  alt={isActive ? posterAlt(std, i) : ''}
                                  loading="eager"
                                  fetchPriority={isActive ? 'high' : 'low'}
                                  decoding="async"
                                  draggable={false}
                                />
                              )}
                              <span className="oly-spot" />
                              <span className="oly-glare" />
                              {isActive && cta.kind === 'link' && (
                                <Link
                                  to={cta.to}
                                  tabIndex={-1}
                                  draggable={false}
                                  aria-label={`${cta.label}, All India Olympiad Test 2026`}
                                  className="absolute inset-0 z-10"
                                  onClick={e => { if (suppressClick.current) e.preventDefault(); }}
                                />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* C · the SELECTED standard, CTA and the ten standard selectors */}
              <div className="min-w-0 lg:col-span-7 lg:row-start-2 self-start w-full max-w-xl mx-auto lg:max-w-none" {...hoverZone(2)}>
                <div className="oly-stagger" style={vars({ '--d': 4 })}>
                  {/* all ten states share one grid cell → no layout shift when the standard changes */}
                  <div id="olympiad-standard-panel" role="tabpanel" aria-labelledby={`olympiad-std-${std}`} className="oly-std-stack">
                    {STANDARDS.map((s, i) => {
                      const a = ARTWORKS[s.artwork];
                      return (
                        <div
                          key={s.std}
                          className={`oly-std-state ${i === active ? 'is-active' : ''}`}
                          aria-hidden={i !== active}
                          style={vars({ '--state-accent': a.accent })}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="whitespace-nowrap font-display font-extrabold text-[1.35rem] sm:text-2xl leading-none text-[#22243A] dark:text-[#F4F4FA]">
                              Standard {s.std}
                            </p>
                            <span className="oly-test-chip hidden sm:inline-flex">ONLINE OLYMPIAD EXAM</span>
                          </div>
                          <p className="mt-2 text-[12.5px] sm:text-[13px] leading-snug text-[#4B4E6D] dark:text-[#C9CBE0]">
                            {a.subjects.map(sub => sub.name).join(' · ')}
                          </p>
                          <p className="mt-1 text-[11.5px] sm:text-xs font-semibold text-[#8A8DAA] dark:text-[#8F92B4]">
                            <span className="sm:hidden">Online Olympiad Exam · </span>
                            {a.questions} MCQs · {OLYMPIAD_PROMO.durationMinutes} min · No negative marking
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="oly-stagger mt-4 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-5" style={vars({ '--d': 5 })}>
                  {cta.kind === 'link' ? (
                    <Link
                      to={cta.to}
                      className="oly-cta w-full sm:w-auto"
                      onPointerMove={onMagnetMove}
                      onPointerLeave={onMagnetLeave}
                      aria-label={`${cta.label}, All India Olympiad Test 2026`}
                    >
                      {ctaInner}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="oly-cta w-full sm:w-auto"
                      onPointerMove={onMagnetMove}
                      onPointerLeave={onMagnetLeave}
                      onClick={() => choose(myStd - 1)}
                    >
                      {ctaInner}
                    </button>
                  )}
                  {cta.loginHint ? (
                    <p className="text-sm text-center sm:text-left whitespace-nowrap text-[#6B6E8C] dark:text-[#A6A8C4]">
                      Already registered?{' '}
                      <Link to="/login" className="oly-login rounded font-semibold text-[#6C63F2] dark:text-[#C4ADFF] hover:underline underline-offset-4">
                        Log in
                      </Link>
                    </p>
                  ) : (
                    <p className="text-xs text-center sm:text-left text-[#6B6E8C] dark:text-[#A6A8C4]">
                      {cta.note ?? 'Online · No negative marking'}
                    </p>
                  )}
                </div>

                <div className="oly-stagger mt-5" style={vars({ '--d': 6 })}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="whitespace-nowrap text-[10px] sm:text-[11px] font-bold tracking-[0.12em] sm:tracking-[0.16em] text-[#8A8DAA] dark:text-[#8F92B4]">SELECT YOUR STANDARD</p>
                    <div className="flex items-center gap-1.5">
                      <button type="button" className="oly-ctrl hidden sm:inline-flex" onClick={() => stepByUser(-1)} aria-label="Previous standard">
                        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <span className="oly-meter-track mx-1" aria-hidden="true">
                        {autoplay ? (
                          <span
                            key={`p-${active}`}
                            className="oly-progress"
                            style={{ animationDuration: `${OLYMPIAD_PROMO.autoplayMs}ms`, animationPlayState: playing ? 'running' : 'paused' }}
                            onAnimationEnd={e => { if (e.animationName === 'oly-progress') stepAuto(); }}
                          />
                        ) : (
                          <span className="oly-progress is-static" style={{ transform: `scaleX(${std / N})` }} />
                        )}
                      </span>
                      <button
                        type="button"
                        className="oly-ctrl"
                        onClick={() => setAutoplayPref(!autoplay)}
                        aria-label={autoplay ? 'Pause automatic standard rotation' : 'Start automatic standard rotation'}
                      >
                        {autoplay ? <Pause className="w-3.5 h-3.5" aria-hidden="true" /> : <Play className="w-3.5 h-3.5 ml-0.5" aria-hidden="true" />}
                      </button>
                      <button type="button" className="oly-ctrl hidden sm:inline-flex" onClick={() => stepByUser(1)} aria-label="Next standard">
                        <ChevronRight className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div role="tablist" aria-label="Select your standard" className="oly-std-row">
                    {STANDARDS.map((s, i) => {
                      const selected = i === active;
                      return (
                        <button
                          key={s.std}
                          ref={el => { tabRefs.current[i] = el; }}
                          id={`olympiad-std-${s.std}`}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          aria-controls="olympiad-standard-panel"
                          aria-label={`Standard ${s.std}`}
                          tabIndex={selected ? 0 : -1}
                          className="oly-std"
                          onClick={() => choose(i)}
                          onKeyDown={e => onTabKey(e, i)}
                        >
                          Std {s.std}
                        </button>
                      );
                    })}
                  </div>
                  <p className="sr-only" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
                    {`Showing Standard ${std}`}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default OlympiadShowcase;
