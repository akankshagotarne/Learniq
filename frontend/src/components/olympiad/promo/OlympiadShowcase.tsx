import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Laptop, ListChecks,
  Pause, Play, Sparkles, Star, Trophy,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { olympiadApi } from '../../../services/olympiad';
import { OLYMPIAD_PROMO, OLYMPIAD_PROMO_ARTWORKS, OLYMPIAD_PROMO_STANDARDS } from './olympiadPromoData';
import './olympiadShowcase.css';

/**
 * Landing-page campaign section for the LearnIQ All India Olympiad Test 2026.
 *
 * TEN individually selectable standards (Std 1 … Std 10). Exactly one standard is
 * active and exactly one poster is visible. Each standard reuses its official source
 * poster (Std 1–3 → Test 1 artwork, 4–6 → Test 2, 7–8 → Test 3, 9–10 → Test 4), but
 * every piece of text, the CTA and the selection always name ONE standard only.
 *
 * No animation library: poster switching is CSS transitions keyed off classes;
 * pointer effects (tilt, spotlight, info-card depth) are CSS custom properties
 * written to the section from one requestAnimationFrame loop that only runs while
 * something is still settling. Autoplay is driven by the progress bar's own CSS
 * animation (`animationend` → next), so pausing is just `animation-play-state`.
 */

const ARTWORKS = OLYMPIAD_PROMO_ARTWORKS;
const STANDARDS = OLYMPIAD_PROMO_STANDARDS;
const N = STANDARDS.length; // 10
const MAX_TILT = 5; // degrees
const MANUAL_HOLD_MS = 15000; // autoplay rests this long after the visitor picks a standard

type Motion = { rx: number; ry: number; h: number; sx: number; sy: number };
const ZERO: Motion = { rx: 0, ry: 0, h: 0, sx: 0, sy: 0 };
// smoothing per property at 60 fps (higher = snappier); scaled by real frame time below
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

const posterAlt = (std: number, art: number) =>
  `LearnIQ All India Olympiad Test 2026 poster for Standard ${std}. Subjects: ${ARTWORKS[art].subjects.map(s => s.name).join(', ')}. ` +
  'Test link open 1 to 5 October 2026. Mode: online. Fees: ₹20 only. Scan the QR code to register at learniq-livid.vercel.app.';

const DECOR: { node: React.ReactNode; className: string; dur: number; delay: number; depth: number; rot?: number }[] = [
  { node: <Star className="w-5 h-5 fill-current" />, className: 'top-[4%] left-[12%] text-[#FFC24B]', dur: 4.2, delay: 0, depth: 34, rot: 14 },
  { node: <Sparkles className="w-6 h-6" />, className: 'top-[8%] right-[10%] text-[#B69CF2]', dur: 5, delay: 0.8, depth: -26 },
  { node: <span className="oly-symbol text-3xl">π</span>, className: 'top-[42%] left-[4%] text-[#6C63F2]/40 hidden md:block', dur: 4.6, delay: 0.4, depth: 22, rot: -8 },
  { node: <span className="oly-symbol text-2xl">√x</span>, className: 'top-[52%] right-[4%] text-[#E1447A]/40 hidden md:block', dur: 5.4, delay: 1.2, depth: -30, rot: 8 },
  { node: <span className="oly-symbol text-2xl">÷</span>, className: 'bottom-[26%] left-[10%] text-[#5AC8FA]/70 hidden md:block', dur: 3.8, delay: 0.2, depth: 18 },
  { node: <span className="oly-symbol text-xl">+</span>, className: 'top-[24%] right-[16%] text-[#4ADE9A]/70 hidden md:block', dur: 4.4, delay: 1.6, depth: 30 },
  { node: <span className="oly-bubble block w-3 h-3" style={vars({ '--bubble': '#FF8FA3' })} />, className: 'bottom-[30%] right-[12%] hidden sm:block', dur: 3.6, delay: 0.5, depth: -20 },
  { node: <span className="oly-bubble block w-2.5 h-2.5" style={vars({ '--bubble': '#6C63F2' })} />, className: 'top-[20%] left-[20%] hidden sm:block', dur: 4.8, delay: 1, depth: 26 },
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
  const [hoverZones, setHoverZones] = useState(0); // bitmask: 1 poster, 2 info card
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [inView, setInView] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const autoplay = autoplayPref ?? !reduced;
  const playing = autoplay && !manualHold && hoverZones === 0 && !keyboardFocus && inView;

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
  const choose = (to: number) => { holdAutoplay(); change(to); };
  const stepByUser = (delta: 1 | -1) => { holdAutoplay(); change(active + delta, delta); };

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

  /* ---------- pointer-driven motion on the active poster (one rAF loop, stops when settled) ---------- */
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

  useEffect(() => () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null; // lets the loop restart after a remount (React StrictMode / hot reload)
  }, []);

  // touch / reduced motion, or the poster changed under the cursor: settle back to rest
  useEffect(() => {
    target.current = { ...ZERO };
    kick();
  }, [pointerFx, art, kick]);

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

  // once the section is near, decode every poster up front so switching never shows an empty card
  useEffect(() => {
    if (!revealed) return;
    sectionRef.current?.querySelectorAll<HTMLImageElement>('.oly-img').forEach(img => {
      img.loading = 'eager';
      img.decode?.().catch(() => { /* ignore: it will simply decode on first paint */ });
    });
  }, [revealed]);

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

  /* ---------- standard selector (roving focus, 5 × 2 grid) ---------- */
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let to = -1;
    if (e.key === 'ArrowRight') to = (i + 1) % N;
    else if (e.key === 'ArrowLeft') to = (i - 1 + N) % N;
    else if (e.key === 'ArrowDown') to = (i + 5) % N;
    else if (e.key === 'ArrowUp') to = (i - 5 + N) % N;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = N - 1;
    if (to < 0) return;
    e.preventDefault();
    choose(to);
    tabRefs.current[to]?.focus();
  };

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
      className={`oly-section ${revealed ? 'oly-in' : ''}`}
      style={vars({ '--oly-accent': artwork.accent })}
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
      </div>

      <div className="page-container relative z-10 pt-10 pb-16 sm:pt-16 sm:pb-20 lg:pt-16 lg:pb-20">
        <div className="grid lg:grid-cols-12 gap-x-10 xl:gap-x-14 gap-y-8 lg:gap-y-7">
          {/* A · general campaign heading (never names a standard range) */}
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
              Challenge yourself with LearnIQ’s online Olympiad.
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
                ONLINE
              </span>
            </div>
          </header>

          {/* B · the ONE active poster */}
          <div
            className="lg:col-span-7 lg:col-start-6 lg:row-start-1 lg:row-span-2 lg:self-end oly-reveal oly-reveal--pop"
            style={vars({ '--d': 4 })}
          >
            <div className="oly-stage">
              <div className="oly-stage-glow" aria-hidden="true" />
              <div className="oly-stage-ring" aria-hidden="true" />
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
                          <img
                            className="oly-img"
                            src={x.poster.src}
                            srcSet={`${x.poster.srcSmall} 640w, ${x.poster.src} 1080w`}
                            sizes="(min-width: 1280px) 440px, (min-width: 1024px) 400px, (min-width: 640px) 360px, 320px"
                            width={1080}
                            height={1350}
                            alt={isActive ? posterAlt(std, i) : ''}
                            loading={isActive ? 'eager' : 'lazy'}
                            decoding="async"
                            draggable={false}
                          />
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

            {/* controls: previous · progress · pause · next */}
            <div className="relative z-10 mt-6 sm:mt-7 flex items-center justify-center gap-3">
              <button type="button" className="oly-ctrl" onClick={() => stepByUser(-1)} aria-label="Previous standard">
                <ChevronLeft className="w-5 h-5" aria-hidden="true" />
              </button>
              <div className="oly-meter" aria-hidden="true">
                <span className="oly-meter-label">Std {std} <span className="opacity-50">/ {N}</span></span>
                <span className="oly-meter-track">
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
              </div>
              <button
                type="button"
                className="oly-ctrl"
                onClick={() => setAutoplayPref(!autoplay)}
                aria-label={autoplay ? 'Pause automatic standard rotation' : 'Start automatic standard rotation'}
              >
                {autoplay ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4 ml-0.5" aria-hidden="true" />}
              </button>
              <button type="button" className="oly-ctrl" onClick={() => stepByUser(1)} aria-label="Next standard">
                <ChevronRight className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <p className="sr-only" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
              {`Showing Standard ${std}`}
            </p>
          </div>

          {/* C · details of the SELECTED standard only */}
          <div className="lg:col-span-5 lg:col-start-1 lg:row-start-2 lg:row-span-2 self-start w-full max-w-xl mx-auto lg:max-w-none">
            <div className="oly-reveal" style={vars({ '--d': 5 })}>
              <div className="oly-info-depth">
                <div
                  id="olympiad-standard-panel"
                  role="tabpanel"
                  aria-labelledby={`olympiad-std-${std}`}
                  className="oly-info"
                  {...hoverZone(2)}
                >
                  {/* all ten states share one grid cell → the card keeps one height (no layout shift) */}
                  <div className="oly-info-stack relative z-[1]">
                    {STANDARDS.map((s, i) => {
                      const a = ARTWORKS[s.artwork];
                      return (
                        <div
                          key={s.std}
                          className={`oly-info-state ${i === active ? 'is-active' : ''}`}
                          aria-hidden={i !== active}
                          style={vars({ '--state-accent': a.accent })}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="oly-test-chip">ONLINE OLYMPIAD EXAM</span>
                            <span className="hidden min-[400px]:inline text-[11px] sm:text-xs font-semibold tracking-wide text-[#8A8DAA] dark:text-[#8F92B4]">
                              {a.motto.join(' · ')}
                            </span>
                          </div>
                          <h3 className="font-display font-extrabold text-[1.9rem] sm:text-[2.1rem] leading-tight mt-3 text-[#22243A] dark:text-[#F4F4FA]">
                            Standard {s.std}
                          </h3>
                          <p className="oly-tagline text-sm sm:text-base mt-0.5">{a.tagline}</p>

                          <p className="mt-4 text-[11px] font-bold tracking-[0.14em] text-[#8A8DAA] dark:text-[#8F92B4]">SUBJECTS</p>
                          <ul className="mt-2 flex flex-wrap gap-2" aria-label={`Standard ${s.std} subjects`}>
                            {a.subjects.map(({ name, icon: Icon, tint }) => (
                              <li key={name} className="oly-subject">
                                <span className="oly-subject-icon" style={{ background: tint }}>
                                  <Icon className="w-3 h-3" aria-hidden="true" />
                                </span>
                                {name}
                              </li>
                            ))}
                          </ul>

                          <dl className="mt-auto pt-5 grid grid-cols-3 gap-2.5">
                            <div className="oly-stat">
                              <dt className="oly-stat-label">Fee</dt>
                              <dd className="oly-stat-value">₹{OLYMPIAD_PROMO.fee}</dd>
                              <dd className="oly-stat-sub">only</dd>
                            </div>
                            <div className="oly-stat">
                              <dt className="oly-stat-label">Dates</dt>
                              <dd className="oly-stat-value">
                                <CalendarDays className="w-4 h-4 opacity-60" aria-hidden="true" />
                                1–5 Oct
                              </dd>
                              <dd className="oly-stat-sub"><span className="whitespace-nowrap">2026 ·</span> <span className="whitespace-nowrap">online</span></dd>
                            </div>
                            <div className="oly-stat">
                              <dt className="oly-stat-label">Paper</dt>
                              <dd className="oly-stat-value">
                                <ListChecks className="w-4 h-4 opacity-60" aria-hidden="true" />
                                {a.questions}
                              </dd>
                              <dd className="oly-stat-sub"><span className="whitespace-nowrap">MCQs ·</span> <span className="whitespace-nowrap">{OLYMPIAD_PROMO.durationMinutes} min</span></dd>
                            </div>
                          </dl>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    className="oly-reveal relative z-[1] mt-6 flex flex-col sm:flex-row sm:items-center lg:flex-col lg:items-start gap-3 sm:gap-5 lg:gap-3"
                    style={vars({ '--d': 6 })}
                  >
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
                </div>
              </div>
            </div>
          </div>

          {/* D · ten individual standard selectors */}
          <div className="lg:col-span-7 lg:col-start-6 lg:row-start-3 lg:self-start w-full max-w-xl mx-auto lg:max-w-none oly-reveal" style={vars({ '--d': 7 })}>
            <p className="mb-3 text-center text-[11px] font-bold tracking-[0.18em] text-[#8A8DAA] dark:text-[#8F92B4]">SELECT YOUR STANDARD</p>
            <div role="tablist" aria-label="Select your standard" className="grid grid-cols-5 gap-2 sm:gap-2.5">
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
          </div>
        </div>
      </div>
    </section>
  );
};

export default OlympiadShowcase;
