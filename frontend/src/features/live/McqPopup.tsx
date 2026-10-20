import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader, Timer, WifiOff } from 'lucide-react';
import { fractionLeft, msLeft, secondsLeft, secLabel } from './logic';
import type { McqUi } from './useLiveRoom';
import type { RankUi } from './useLiveRoom';

const LETTERS = ['A', 'B', 'C', 'D'];

/** re-render ~5x a second while `active` (the countdown never trusts a timer's count: it recomputes from a monotonic deadline) */
export const useTick = (active: boolean, every = 200) => {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => set((n) => n + 1), every);
    const vis = () => set((n) => n + 1); // a tab coming back to the foreground recomputes at once
    document.addEventListener('visibilitychange', vis);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [active, every]);
};

const Ring: React.FC<{ fraction: number; seconds: number; urgent: boolean }> = ({ fraction, seconds, urgent }) => {
  const r = 20; const c = 2 * Math.PI * r;
  return (
    <div className="relative w-14 h-14 flex-shrink-0" aria-hidden="true">
      <svg viewBox="0 0 48 48" className="w-full h-full -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" className="stroke-black/10 dark:stroke-white/15" />
        <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - fraction)} className={urgent ? 'stroke-rose-500' : 'stroke-brand-primary'} style={{ transition: 'stroke-dashoffset 200ms linear' }} />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center font-heading font-bold text-lg tabular-nums ${urgent ? 'text-rose-500' : 'text-text-primary'}`}>{seconds}</span>
    </div>
  );
};

/**
 * The student's question popup. It is shown while the question is open AND this student has not been acknowledged by the server.
 * It disappears the instant the server acknowledges the answer (the parent unmounts it when `mcq.submitted` becomes true).
 */
export const McqPopup: React.FC<{ mcq: McqUi; online: boolean; onSelect: (i: number) => void; onSubmit: () => void }> = ({ mcq, online, onSelect, onSubmit }) => {
  useTick(mcq.phase === 'open');
  const q = mcq.question;
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstRef.current?.focus({ preventScroll: true }); }, [q?.mcqId]);
  if (!q) return null;
  const left = secondsLeft(mcq.deadline);
  const timeUp = mcq.phase !== 'open' || msLeft(mcq.deadline) <= 0;
  const urgent = !timeUp && left <= 5;
  const canSubmit = !timeUp && mcq.selectedOption !== null && !mcq.submitting && online;
  const announce = left === 10 || left === 5 || left <= 3 ? `${left} seconds left` : '';

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-sm sm:p-4" data-testid="mcq-popup">
      <div role="dialog" aria-modal="true" aria-labelledby="mcq-title"
        className="w-full sm:max-w-lg max-h-[100dvh] sm:max-h-[92dvh] overflow-y-auto overscroll-contain bg-surface rounded-t-3xl sm:rounded-3xl shadow-2xl border border-border-subtle animate-slide-up pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="px-4 sm:px-6 pt-4 pb-3 flex items-center gap-3 bg-gradient-to-r from-brand-primary/15 to-accent-lilac/20 rounded-t-3xl">
          <Ring fraction={fractionLeft(mcq.deadline, q.durationMs)} seconds={left} urgent={urgent} />
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-bold text-brand-primary">Live question</p>
            <p className="text-xs text-text-secondary flex items-center gap-1"><Timer className="w-3 h-3" />{timeUp ? 'Time is up' : `Answer within ${Math.round(q.durationMs / 1000)} seconds`}</p>
          </div>
        </div>
        <span className="sr-only" role="status" aria-live="assertive">{announce}</span>

        <div className="px-4 sm:px-6 py-4">
          <h2 id="mcq-title" className="font-heading text-lg sm:text-xl font-bold text-text-primary leading-snug break-words">{q.question}</h2>
          <div role="radiogroup" aria-labelledby="mcq-title" className="mt-4 grid gap-2.5">
            {q.options.map((opt, i) => {
              const sel = mcq.selectedOption === i;
              return (
                <button key={i} ref={i === 0 ? firstRef : undefined} role="radio" aria-checked={sel} disabled={timeUp || mcq.submitting} onClick={() => onSelect(i)} data-testid={`mcq-option-${i}`}
                  className={`w-full min-h-[52px] flex items-center gap-3 text-left rounded-2xl border-2 px-3.5 py-2.5 transition-all focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/30 disabled:opacity-60 ${sel ? 'border-brand-primary bg-brand-primary/10 shadow-sm' : 'border-border-subtle bg-surface-alt hover:border-brand-primary/50'}`}>
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${sel ? 'bg-brand-primary text-white' : 'bg-surface text-brand-primary border border-border-subtle'}`}>{sel ? <CheckCircle2 className="w-4 h-4" /> : LETTERS[i]}</span>
                  <span className="text-sm sm:text-base text-text-primary break-words min-w-0">{opt}</span>
                </button>
              );
            })}
          </div>

          {!online && <p role="alert" className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2"><WifiOff className="w-4 h-4" />You are offline. Your answer will send as soon as the connection returns - if there is still time.</p>}
          {mcq.error && <p role="alert" data-testid="mcq-error" className="mt-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{mcq.error}</p>}

          <button onClick={onSubmit} disabled={!canSubmit} data-testid="mcq-submit"
            className="btn-primary w-full min-h-[52px] mt-4 text-base gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {mcq.submitting ? <><Loader className="w-4 h-4 animate-spin" />Sending…</> : timeUp ? 'Time is up' : mcq.error ? 'Try again' : 'Submit answer'}
          </button>
          <p className="text-center text-[11px] text-text-muted mt-2">You can answer once. The popup closes when the server confirms your answer.</p>
        </div>
      </div>
    </div>
  );
};

const MEDALS = ['🥇', '🥈', '🥉'];
/** "LearnIQ — MCQ Champions": top 3 for 5 seconds. Stacked rows on very small screens, a four-column table from 400 px. */
export const RankCard: React.FC<{ rank: RankUi; selfUserId?: string; myResult?: McqUi['result'] }> = ({ rank, selfUserId, myResult }) => {
  useTick(true, 100);
  const { card } = rank;
  const frac = fractionLeft(rank.deadline, card.displayMs);
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-3 bg-black/55 backdrop-blur-sm pointer-events-none" data-testid="rank-card" role="status" aria-live="polite">
      <div className="w-full max-w-md bg-gradient-to-b from-[#1b1740] to-[#0f0d2a] text-white rounded-3xl shadow-2xl border border-white/15 overflow-hidden animate-bounce-in pointer-events-auto">
        <div className="px-4 pt-5 pb-3 text-center">
          <div className="text-3xl" aria-hidden="true">🏆</div>
          <h2 className="font-heading font-extrabold text-lg sm:text-xl tracking-tight">{card.title}</h2>
        </div>
        {card.noQualifying ? (
          <div className="px-5 pb-6 text-center" data-testid="rank-none">
            <p className="text-base font-semibold">No correct answers this time</p>
            <p className="text-white/60 text-sm mt-1">Great effort everyone - the next question is a fresh start!</p>
          </div>
        ) : (
          <div className="px-3 pb-4">
            <div className="hidden min-[400px]:grid grid-cols-[2.5rem_1fr_5.5rem_4.5rem] gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider text-white/50 font-semibold"><span>Rank</span><span>Student</span><span>Standard</span><span className="text-right">Time</span></div>
            <ol className="space-y-1.5">
              {card.ranking.map((r) => (
                <li key={r.userId} data-testid={`rank-row-${r.rank}`} className={`grid grid-cols-[2.5rem_1fr_auto] min-[400px]:grid-cols-[2.5rem_1fr_5.5rem_4.5rem] gap-2 items-center rounded-2xl px-2 py-2.5 ${r.userId === selfUserId ? 'bg-white/20 ring-2 ring-amber-300/70' : 'bg-white/10'}`}>
                  <span className="text-xl text-center" aria-label={`Rank ${r.rank}`}>{MEDALS[r.rank - 1] || r.rank}</span>
                  <span className="min-w-0"><span className="block truncate font-semibold text-sm">{r.name}{r.userId === selfUserId ? ' (You)' : ''}</span><span className="block min-[400px]:hidden text-[11px] text-white/60">{r.standard}</span></span>
                  <span className="hidden min-[400px]:block text-xs text-white/80 truncate">{r.standard}</span>
                  <span className="text-right text-sm font-bold tabular-nums text-amber-200">{r.answerTimeLabel}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {myResult && (
          <p className="px-4 pb-3 text-center text-xs text-white/70" data-testid="rank-mine">
            {myResult.answered ? (myResult.isCorrect ? `You answered correctly in ${myResult.answerTimeMs != null ? secLabel(myResult.answerTimeMs) : ''}.` : 'Your answer was not correct this time.') : 'You did not answer this question.'}
          </p>
        )}
        <div className="h-1.5 bg-white/10"><div className="h-full bg-amber-300" style={{ width: `${frac * 100}%`, transition: 'width 100ms linear' }} /></div>
      </div>
    </div>
  );
};
