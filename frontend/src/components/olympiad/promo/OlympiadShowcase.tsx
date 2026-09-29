import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Clock, Laptop, ListChecks,
  Pause, Play, Sparkles, Star, Trophy,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { OLYMPIAD_PROMO, OLYMPIAD_PROMO_TESTS } from './olympiadPromoData';
import './olympiadShowcase.css';

/**
 * Landing-page campaign section for the LearnIQ All India Olympiad Test 2026.
 *
 * No animation library: deck positions are CSS transitions keyed off `data-pos`;
 * pointer effects (tilt, spotlight, info-card depth) are CSS custom
 * properties written straight to the section element from one requestAnimationFrame
 * loop that only runs while something is still settling. Autoplay is driven by the
 * progress bar's own CSS animation (`animationend` → next), so pausing is just
 * `animation-play-state: paused`.
 */

const TESTS = OLYMPIAD_PROMO_TESTS;
const N = TESTS.length;
const MAX_TILT = 6; // degrees

type Motion = { rx: number; ry: number; h: number; sx: number; sy: number };
const ZERO: Motion = { rx: 0, ry: 0, h: 0, sx: 0, sy: 0 };
// smoothing per property at 60 fps (higher = snappier); scaled by real frame time below.
// Tuned for low latency: the tilt reaches ~90% of its target in ~4 frames, the spotlight in ~2.
const EASE: Motion = { rx: 0.42, ry: 0.42, h: 0.34, sx: 0.7, sy: 0.7 };
const KEYS = Object.keys(ZERO) as (keyof Motion)[];

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

/** position of slide i relative to the active one: 0 active, 1 next, -1 previous, 2 hidden behind */
const posOf = (i: number, active: number) => {
  const rel = (i - active + N) % N;
  if (rel === 0) return 0;
  if (rel === 1) return 1;
  if (rel === N - 1) return -1;
  return 2;
};

const DECOR: { node: React.ReactNode; className: string; dur: number; delay: number; depth: number; rot?: number }[] = [
  { node: <Star className="w-5 h-5 fill-current" />, className: 'top-[2%] left-[7%] text-[#FFC24B]', dur: 4.2, delay: 0, depth: 34, rot: 14 },
  { node: <Sparkles className="w-6 h-6" />, className: 'top-[3%] right-[6%] text-[#B69CF2]', dur: 5, delay: 0.8, depth: -26 },
  { node: <span className="oly-symbol text-3xl">π</span>, className: 'bottom-[17%] left-[3%] text-[#6C63F2]/45 hidden sm:block', dur: 4.6, delay: 0.4, depth: 22, rot: -8 },
  { node: <span className="oly-symbol text-2xl">√x</span>, className: 'bottom-[15%] right-[3%] text-[#E1447A]/45 hidden sm:block', dur: 5.4, delay: 1.2, depth: -30, rot: 8 },
  { node: <span className="oly-symbol text-2xl">÷</span>, className: 'bottom-[5%] left-[15%] text-[#5AC8FA]/70 hidden sm:block', dur: 3.8, delay: 0.2, depth: 18 },
  { node: <span className="oly-bubble block w-3 h-3" style={vars({ '--bubble': '#FF8FA3' })} />, className: 'bottom-[4%] right-[16%]', dur: 3.6, delay: 0.5, depth: -20 },
  { node: <span className="oly-bubble block w-2.5 h-2.5" style={vars({ '--bubble': '#6C63F2' })} />, className: 'top-[6%] left-[22%] hidden sm:block', dur: 4.8, delay: 1, depth: 26 },
];

const OlympiadShowcase: React.FC = () => {
  const { user } = useAuth();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)');
  const pointerFx = finePointer && !reduced;

  const [active, setActive] = useState(0);
  const [autoplayPref, setAutoplayPref] = useState<boolean | null>(null); // null → default (on unless reduced motion)
  const [hoverZones, setHoverZones] = useState(0); // bitmask: 1 deck, 2 info card
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [inView, setInView] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const autoplay = autoplayPref ?? !reduced;
  const playing = autoplay && hoverZones === 0 && !keyboardFocus && inView;

  const go = useCallback((i: number) => setActive(((i % N) + N) % N), []);
  const next = useCallback(() => setActive(a => (a + 1) % N), []);
  const prev = useCallback(() => setActive(a => (a - 1 + N) % N), []);

  const sectionRef = useRef<HTMLElement>(null);
  const deckRef = useRef<HTMLDivElement>(null);

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
      if (Math.abs(d) > 0.01) {
        c[k] += d * (1 - Math.pow(1 - EASE[k], steps));
        moving = true;
      } else {
        c[k] = t[k];
      }
    }
    if (el) {
      const s = el.style;
      s.setProperty('--rx', c.rx.toFixed(3));
      s.setProperty('--ry', c.ry.toFixed(3));
      s.setProperty('--h', c.h.toFixed(3));
      s.setProperty('--sx', c.sx.toFixed(1));
      s.setProperty('--sy', c.sy.toFixed(1));
    }
    frame.current = moving ? requestAnimationFrame(tick) : null;
  }, []);

  const kick = useCallback(() => {
    if (frame.current == null) {
      lastTime.current = 0;
      frame.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  useEffect(() => () => { if (frame.current != null) cancelAnimationFrame(frame.current); }, []);

  // switching to touch / reduced motion: settle everything back to rest
  useEffect(() => {
    if (!pointerFx) {
      target.current = { ...ZERO };
      kick();
    }
  }, [pointerFx, kick]);

  const onCardMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerFx || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = clamp((e.clientX - r.left) / r.width, 0, 1);
    const py = clamp((e.clientY - r.top) / r.height, 0, 1);
    const t = target.current;
    t.ry = (px - 0.5) * 2 * MAX_TILT; // cursor left → left edge dips away
    t.rx = (0.5 - py) * 2 * MAX_TILT; // cursor up → top edge dips away
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
    t.rx = 0;
    t.ry = 0;
    t.h = 0;
    kick();
  };

  /* ---------- visibility: reveal once, pause autoplay off-screen, scroll parallax ---------- */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setRevealed(true);
      setInView(true);
      return;
    }
    const viewIO = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0 });
    const revealIO = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setRevealed(true);
        revealIO.disconnect();
      }
    }, { rootMargin: '0px 0px -4% 0px', threshold: 0 });
    viewIO.observe(el);
    revealIO.observe(el);
    return () => { viewIO.disconnect(); revealIO.disconnect(); };
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || !inView || reduced) return;
    let queued = false;
    const update = () => {
      queued = false;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = clamp((r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2), -1, 1);
      el.style.setProperty('--p', p.toFixed(4));
    };
    const onScroll = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [inView, reduced]);

  useEffect(() => {
    if (reduced) sectionRef.current?.style.setProperty('--p', '0');
  }, [reduced]);

  /* ---------- touch swipe on the deck ---------- */
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
    if (d.dx <= -45) next();
    else if (d.dx >= 45) prev();
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
      if (!reduced) deckRef.current?.style.setProperty('--drag', (dx * 0.55).toFixed(1));
    },
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Home') { e.preventDefault(); go(0); }
      else if (e.key === 'End') { e.preventDefault(); go(N - 1); }
    },
  };

  const hoverZone = (bit: number) => ({
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType !== 'touch') setHoverZones(z => z | bit); },
    onPointerLeave: () => setHoverZones(z => z & ~bit),
  });

  /* ---------- magnetic CTA ---------- */
  const onMagnetMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
    if (!pointerFx || e.pointerType !== 'mouse') return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--tx', `${clamp((e.clientX - (r.left + r.width / 2)) * 0.2, -8, 8).toFixed(1)}px`);
    el.style.setProperty('--ty', `${clamp((e.clientY - (r.top + r.height / 2)) * 0.3, -6, 6).toFixed(1)}px`);
  };
  const onMagnetLeave = (e: React.PointerEvent<HTMLAnchorElement>) => {
    e.currentTarget.style.setProperty('--tx', '0px');
    e.currentTarget.style.setProperty('--ty', '0px');
  };

  /* ---------- tabs (roving focus) ---------- */
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let to = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % N;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + N) % N;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = N - 1;
    if (to < 0) return;
    e.preventDefault();
    go(to);
    tabRefs.current[to]?.focus();
  };

  /* ---------- where the CTA goes (existing routes only) ---------- */
  const cta = useMemo(() => {
    if (!user) return { to: '/register', label: 'Register Now', loginHint: true };
    if (user.role === 'student') return { to: '/student/exams', label: 'Participate in Olympiad', loginHint: false };
    if (user.role === 'admin') return { to: '/admin/olympiad', label: 'Manage Olympiad', loginHint: false };
    return { to: '/dashboard', label: 'Open Dashboard', loginHint: false };
  }, [user]);

  const t = TESTS[active];

  return (
    <section
      ref={sectionRef}
      id="olympiad-2026"
      aria-labelledby="olympiad-2026-heading"
      className={`oly-section ${revealed ? 'oly-in' : ''}`}
      style={vars({ '--oly-accent': t.accent })}
      onFocus={e => { if ((e.target as HTMLElement).matches?.(':focus-visible')) setKeyboardFocus(true); }}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false); }}
    >
      {/* background */}
      <div className="oly-bg" aria-hidden="true">
        <div className="oly-grid" />
        <div className="oly-blob oly-blob--sky" style={vars({ '--depth': '-30px' })} />
        <div className="oly-blob oly-blob--violet" style={vars({ '--depth': '-50px' })} />
        <div className="oly-blob oly-blob--accent" style={vars({ '--depth': '-24px' })} />
        <div className="oly-blob oly-blob--pink" style={vars({ '--depth': '40px' })} />
        <div className="oly-watermark hidden md:block">2026</div>
      </div>

      <div className="page-container relative z-10 pt-10 pb-16 sm:pt-16 sm:pb-20 lg:pt-16 lg:pb-20">
        <div className="grid lg:grid-cols-12 gap-x-10 xl:gap-x-14 gap-y-9 lg:gap-y-7">
          {/* A · heading */}
          <header className="lg:col-span-5 lg:col-start-1 lg:row-start-1 self-end text-center lg:text-left">
            <p className="oly-eyebrow oly-reveal" style={vars({ '--d': 0 })}>
              <span className="oly-eyebrow-line" />
              <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
              LEARNIQ PRESENTS
            </p>
            <h2
              id="olympiad-2026-heading"
              className="oly-reveal font-display font-black text-[2.35rem] leading-[1.08] sm:text-5xl xl:text-[3.5rem] tracking-tight mt-4 text-[#22243A] dark:text-[#F4F4FA]"
              style={vars({ '--d': 1 })}
            >
              All India <span className="gradient-text">Olympiad</span>
              <br />
              Test 2026
            </h2>
            <p
              className="oly-reveal mt-4 text-base sm:text-lg leading-relaxed text-[#6B6E8C] dark:text-[#A6A8C4] max-w-md mx-auto lg:mx-0"
              style={vars({ '--d': 2 })}
            >
              <span className="font-semibold text-[#22243A] dark:text-[#F4F4FA]">Think. Explore. Achieve.</span>{' '}
              Challenge yourself with LearnIQ’s online Olympiad for Standards 1–10.
            </p>
            <div
              className="oly-reveal mt-6 flex flex-wrap items-center justify-center lg:justify-start gap-3"
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
              <span className="oly-chip">
                <Laptop className="w-4 h-4 text-[#6C63F2] dark:text-[#C4ADFF]" aria-hidden="true" />
                Online
              </span>
            </div>
          </header>

          {/* B · interactive poster deck */}
          <div
            className="lg:col-span-7 lg:col-start-6 lg:row-start-1 lg:row-span-2 lg:self-end oly-reveal oly-reveal--pop"
            style={vars({ '--d': 4 })}
          >
            <div className="oly-deck-wrap py-2 sm:py-4">
              {DECOR.map((d, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={`oly-float ${d.className}`}
                  style={vars({ '--dur': `${d.dur}s`, '--delay': `${d.delay}s`, '--depth': `${d.depth}px`, '--rot': `${d.rot ?? 6}deg` })}
                >
                  {d.node}
                </span>
              ))}

              <div
                ref={deckRef}
                className="oly-deck"
                role="region"
                aria-roledescription="carousel"
                aria-label="All India Olympiad Test 2026 posters"
                aria-describedby="oly-deck-help"
                tabIndex={0}
                {...deckHandlers}
                {...hoverZone(1)}
              >
                <p id="oly-deck-help" className="sr-only">Use the left and right arrow keys to switch between Test 1 to Test 4.</p>
                {TESTS.map((x, i) => {
                  const pos = posOf(i, active);
                  const isActive = pos === 0;
                  return (
                    <div
                      key={x.id}
                      className="oly-slide"
                      data-pos={pos}
                      role="group"
                      aria-roledescription="slide"
                      aria-label={`${i + 1} of ${N}: ${x.label}, ${x.standards}`}
                      aria-hidden={!isActive}
                      style={vars({ '--slide-accent': x.accent, '--slide-soft': x.soft })}
                      onClick={isActive ? undefined : () => { if (!suppressClick.current) go(i); }}
                      onPointerMove={isActive ? onCardMove : undefined}
                      onPointerLeave={isActive ? onCardLeave : undefined}
                    >
                      <div className="oly-tilt">
                        <div className="oly-shadow" />
                        <div className="oly-ring" />
                        <div className="oly-card">
                          <img
                            className="oly-img"
                            src={x.poster.src}
                            srcSet={`${x.poster.srcSmall} 640w, ${x.poster.src} 1080w`}
                            sizes="(min-width: 1280px) 420px, (min-width: 640px) 350px, 310px"
                            width={1080}
                            height={1350}
                            alt={x.poster.alt}
                            loading={i === 0 ? 'eager' : 'lazy'}
                            decoding="async"
                            draggable={false}
                          />
                          <span className="oly-spot" />
                          <span className="oly-glare" />
                          {isActive && (
                            <Link
                              to={cta.to}
                              tabIndex={-1}
                              draggable={false}
                              aria-label={`${cta.label}: ${x.label}, ${x.standards}`}
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

              {/* controls */}
              <div className="relative z-10 mt-7 sm:mt-8 flex items-center justify-center gap-3">
                <button type="button" className="oly-ctrl" onClick={prev} aria-label="Previous poster">
                  <ChevronLeft className="w-5 h-5" aria-hidden="true" />
                </button>
                <div className="flex items-center gap-2 px-1" aria-hidden="true">
                  {TESTS.map((x, i) => (
                    <button
                      key={x.id}
                      type="button"
                      tabIndex={-1}
                      className={`oly-dot ${i === active ? 'is-active' : ''}`}
                      onClick={() => go(i)}
                    >
                      {i === active && (
                        autoplay ? (
                          <span
                            key={`p-${active}`}
                            className="oly-progress"
                            style={{ animationDuration: `${OLYMPIAD_PROMO.autoplayMs}ms`, animationPlayState: playing ? 'running' : 'paused' }}
                            onAnimationEnd={e => { if (e.animationName === 'oly-progress') next(); }}
                          />
                        ) : (
                          <span className="oly-progress is-static" />
                        )
                      )}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="oly-ctrl"
                  onClick={() => setAutoplayPref(!autoplay)}
                  aria-label={autoplay ? 'Pause automatic poster rotation' : 'Start automatic poster rotation'}
                >
                  {autoplay ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4 ml-0.5" aria-hidden="true" />}
                </button>
                <button type="button" className="oly-ctrl" onClick={next} aria-label="Next poster">
                  <ChevronRight className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <p className="sr-only" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
                {`Showing ${t.label}: ${t.standards}`}
              </p>
            </div>
          </div>

          {/* C · details of the active test */}
          <div className="lg:col-span-5 lg:col-start-1 lg:row-start-2 lg:row-span-2 self-start w-full max-w-xl mx-auto lg:max-w-none">
            <div className="oly-reveal" style={vars({ '--d': 5 })}>
              <div className="oly-info-depth">
                <div
                  id="olympiad-test-panel"
                  role="tabpanel"
                  aria-labelledby={`olympiad-tab-${t.id}`}
                  className="oly-info"
                  {...hoverZone(2)}
                >
                  <div key={t.id} className="oly-swap relative z-[1]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="oly-test-chip">{t.label.toUpperCase()}</span>
                      <span className="text-[11px] sm:text-xs font-semibold tracking-wide text-[#8A8DAA] dark:text-[#8F92B4]">
                        {t.motto.join(' · ')}
                      </span>
                    </div>
                    <h3 className="font-display font-bold text-2xl sm:text-[1.7rem] leading-tight mt-3 text-[#22243A] dark:text-[#F4F4FA]">
                      {t.standards}
                    </h3>
                    <p className="oly-tagline text-sm sm:text-base mt-1">{t.tagline}</p>

                    <ul className="mt-4 flex flex-wrap gap-2" aria-label="Subjects">
                      {t.subjects.map(({ name, icon: Icon, tint }) => (
                        <li key={name} className="oly-subject">
                          <span className="oly-subject-icon" style={{ background: tint }}>
                            <Icon className="w-3 h-3" aria-hidden="true" />
                          </span>
                          {name}
                        </li>
                      ))}
                    </ul>

                    <dl className="mt-5 grid grid-cols-3 gap-2.5">
                      <div className="oly-stat">
                        <dt className="sr-only">Fee</dt>
                        <dd className="font-display font-extrabold text-lg text-[#22243A] dark:text-[#F4F4FA]">₹{OLYMPIAD_PROMO.fee}</dd>
                        <dd className="text-[11px] font-semibold text-[#6B6E8C] dark:text-[#A6A8C4]">Only</dd>
                      </div>
                      <div className="oly-stat">
                        <dt className="sr-only">Duration</dt>
                        <dd className="font-display font-extrabold text-lg text-[#22243A] dark:text-[#F4F4FA] inline-flex items-center gap-1">
                          <Clock className="w-4 h-4 opacity-60" aria-hidden="true" />
                          {OLYMPIAD_PROMO.durationMinutes}
                        </dd>
                        <dd className="text-[11px] font-semibold text-[#6B6E8C] dark:text-[#A6A8C4]">Minutes</dd>
                      </div>
                      <div className="oly-stat">
                        <dt className="sr-only">Questions</dt>
                        <dd className="font-display font-extrabold text-lg text-[#22243A] dark:text-[#F4F4FA] inline-flex items-center gap-1">
                          <ListChecks className="w-4 h-4 opacity-60" aria-hidden="true" />
                          {t.questions}
                        </dd>
                        <dd className="text-[11px] font-semibold text-[#6B6E8C] dark:text-[#A6A8C4]">MCQs</dd>
                      </div>
                    </dl>
                  </div>

                  <div
                    className="oly-reveal relative z-[1] mt-6 flex flex-col sm:flex-row sm:items-center lg:flex-col lg:items-start xl:flex-row xl:items-center gap-3 sm:gap-5 lg:gap-3 xl:gap-5"
                    style={vars({ '--d': 6 })}
                  >
                    <Link
                      to={cta.to}
                      className="oly-cta w-full sm:w-auto"
                      onPointerMove={onMagnetMove}
                      onPointerLeave={onMagnetLeave}
                      aria-label={`${cta.label} for the All India Olympiad Test 2026`}
                    >
                      <span className="oly-cta-glow" aria-hidden="true" />
                      <span className="oly-cta-bg" aria-hidden="true" />
                      <span className="oly-cta-label">
                        {cta.label}
                        <ArrowRight className="oly-cta-arrow w-[18px] h-[18px]" aria-hidden="true" />
                      </span>
                    </Link>
                    {cta.loginHint ? (
                      <p className="text-sm text-center sm:text-left whitespace-nowrap text-[#6B6E8C] dark:text-[#A6A8C4]">
                        Already registered?{' '}
                        <Link to="/login" className="oly-login rounded font-semibold text-[#6C63F2] dark:text-[#C4ADFF] hover:underline underline-offset-4">
                          Log in
                        </Link>
                      </p>
                    ) : (
                      <p className="text-xs text-center sm:text-left text-[#6B6E8C] dark:text-[#A6A8C4]">
                        Online · No negative marking
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* D · test selector */}
          <div className="lg:col-span-7 lg:col-start-6 lg:row-start-3 lg:self-start w-full max-w-xl mx-auto lg:max-w-none oly-reveal" style={vars({ '--d': 7 })}>
            <div role="tablist" aria-label="Choose your Olympiad test" className="grid grid-cols-4 gap-2 sm:gap-3">
              {TESTS.map((x, i) => {
                const selected = i === active;
                return (
                  <button
                    key={x.id}
                    ref={el => { tabRefs.current[i] = el; }}
                    id={`olympiad-tab-${x.id}`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="olympiad-test-panel"
                    tabIndex={selected ? 0 : -1}
                    className="oly-tab justify-center sm:justify-start text-center sm:text-left"
                    style={vars({ '--tab-accent': x.accent })}
                    onClick={() => go(i)}
                    onKeyDown={e => onTabKey(e, i)}
                  >
                    <span className="oly-tab-num hidden sm:inline-flex lg:hidden xl:inline-flex" aria-hidden="true">{x.id}</span>
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap text-[10px] sm:text-[11px] font-bold tracking-[0.12em] sm:tracking-[0.16em] text-[#8A8DAA] dark:text-[#8F92B4]">
                        {x.label.toUpperCase()}
                      </span>
                      <span className="block whitespace-nowrap font-display font-bold text-[clamp(11px,3.5vw,13px)] sm:text-base leading-tight text-[#22243A] dark:text-[#F4F4FA]">
                        {x.shortStd}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default OlympiadShowcase;
