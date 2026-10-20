import React, { useEffect, useState } from 'react';
import { Crown, X } from 'lucide-react';
import type { ScoreEntry } from './types';

export const ScoreboardModal: React.FC<{ scoreboard: ScoreEntry[]; selfUserId?: string; onClose: () => void }> = ({ scoreboard, selfUserId, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4" data-testid="scoreboard">
    <div role="dialog" aria-modal="true" aria-label="Class scoreboard" className="w-full sm:max-w-md max-h-[85dvh] flex flex-col bg-surface rounded-t-3xl sm:rounded-3xl shadow-2xl border border-border-subtle pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-between px-4 h-14 border-b border-border-subtle"><h2 className="font-heading font-bold text-text-primary">Class scoreboard</h2><button aria-label="Close" onClick={onClose} className="w-11 h-11 -mr-2 inline-flex items-center justify-center text-text-muted"><X className="w-5 h-5" /></button></div>
      <ol className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {scoreboard.length === 0 && <li className="text-center text-sm text-text-muted py-8">No questions answered yet.</li>}
        {scoreboard.map((e) => (
          <li key={e.userId} className={`flex items-center gap-3 rounded-xl px-3 py-2 border ${e.userId === selfUserId ? 'border-brand-primary bg-brand-primary/5' : 'border-border-subtle bg-surface-alt'}`}>
            <span className="w-6 text-center font-bold text-text-secondary">{e.rank}</span><span className="flex-1 truncate text-sm font-medium text-text-primary">{e.name}{e.userId === selfUserId ? ' (You)' : ''}</span>
            <span className="text-xs text-emerald-600 font-semibold">✓ {e.correct}</span><span className="text-xs text-rose-500">✗ {e.wrong}</span>
          </li>
        ))}
      </ol>
    </div>
  </div>
);

export const PodiumScreen: React.FC<{ podium: any[]; selfUserId?: string; message: string; onDone: () => void }> = ({ podium, selfUserId, message, onDone }) => {
  const [left, setLeft] = useState(10);
  useEffect(() => { const t = window.setInterval(() => setLeft((c) => { if (c <= 1) { window.clearInterval(t); onDone(); return 0; } return c - 1; }), 1000); return () => window.clearInterval(t); }, [onDone]);
  const by = (n: number) => podium.find((p) => p.place === n);
  const Col: React.FC<{ n: 1 | 2 | 3; h: string; medal: string }> = ({ n, h, medal }) => {
    const p = by(n);
    return (
      <div className="flex flex-col items-center flex-1 min-w-0">
        {n === 1 && <Crown className="w-6 h-6 text-amber-300 mb-1" />}
        <div className={`rounded-full flex items-center justify-center font-black border-2 mb-2 ${n === 1 ? 'w-16 h-16 text-2xl border-amber-300' : 'w-12 h-12 text-lg border-white/30'} ${p?.userId === selfUserId ? 'bg-brand-primary/40 text-white' : 'bg-white/10 text-white'}`}>{p?.name?.[0] || '?'}</div>
        <p className="text-sm font-semibold text-white truncate max-w-full">{p?.name || '—'}</p>{p && <p className="text-xs text-white/60">✓{p.correct}</p>}
        <div className={`w-full ${h} mt-2 rounded-t-xl border border-white/20 bg-white/10 flex items-end justify-center pb-2 text-3xl`}>{medal}</div>
      </div>
    );
  };
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-[#0D0E1A] via-[#1a1b35] to-[#0D0E1A] px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" data-testid="screen-ended">
      <p className="text-4xl mb-2" aria-hidden="true">🏆</p><h1 className="font-heading font-black text-2xl text-white">Final results</h1><p className="text-white/60 text-sm mb-8 text-center">{message}</p>
      <div className="flex items-end gap-3 w-full max-w-md mb-8"><Col n={2} h="h-20" medal="🥈" /><Col n={1} h="h-28" medal="🥇" /><Col n={3} h="h-14" medal="🥉" /></div>
      {podium.length === 0 && <p className="text-white/50 text-sm mb-6">No questions were answered in this class.</p>}
      <button onClick={onDone} className="px-6 min-h-[48px] bg-white/10 border border-white/20 text-white rounded-xl text-sm">Continue ({left}s)</button>
    </div>
  );
};
