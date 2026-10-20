import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader, Plus, Send, Square, Trash2, X } from 'lucide-react';
import { secLabel, secondsLeft } from './logic';
import { useTick } from './McqPopup';
import type { HostMcqUi, McqUi } from './useLiveRoom';
import type { Ack } from './types';

const LETTERS = ['A', 'B', 'C', 'D'];
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Host / teacher / admin question panel: compose -> live submission counts -> results. Shared by the classroom and the admin console
 * (same server engine behind both). The request id is created when the form opens, so a double tap or a retry is ONE question.
 */
export const HostMcqPanel: React.FC<{
  mcq: McqUi; host: HostMcqUi; onLaunch: (q: { question: string; options: string[]; correctIndex: number }, requestId: string) => Promise<Ack>;
  onClose: () => Promise<Ack>; onDismiss: () => void;
}> = ({ mcq, host, onLaunch, onClose, onDismiss }) => {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '', '', '']);
  const [correct, setCorrect] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  const [closing, setClosing] = useState(false);
  const open = mcq.phase === 'open';
  useTick(open);

  const filled = useMemo(() => options.map((o) => o.trim()), [options]);
  const valid = question.trim().length >= 3 && filled.length >= 2 && filled.every(Boolean) && new Set(filled.map((o) => o.toLowerCase())).size === filled.length && correct !== null && correct < filled.length;

  useEffect(() => { if (!open && !host.results) setRequestId(newRequestId()); }, [open, host.results]);

  const launch = async () => {
    setError('');
    if (!valid || host.launching) return;
    const ack = await onLaunch({ question: question.trim(), options: filled, correctIndex: correct as number }, requestId);
    if (!ack.ok) setError(ack.message || 'The question could not be launched.'); else { setQuestion(''); setOptions(['', '', '', '']); setCorrect(null); }
  };
  const results = host.results;
  const progress = host.progress;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4" data-testid="host-mcq-panel">
      <div role="dialog" aria-modal="true" aria-label="Live question" className="w-full sm:max-w-xl max-h-[100dvh] sm:max-h-[92dvh] overflow-y-auto bg-surface rounded-t-3xl sm:rounded-3xl shadow-2xl border border-border-subtle pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 h-14 bg-surface border-b border-border-subtle">
          <h2 className="font-heading font-bold text-text-primary">{open ? 'Question running' : results ? 'Results' : 'Ask a live question'}</h2>
          <button aria-label="Close panel" onClick={onDismiss} className="w-11 h-11 -mr-2 inline-flex items-center justify-center text-text-muted hover:text-text-primary"><X className="w-5 h-5" /></button>
        </div>

        {open && mcq.question && (
          <div className="p-4 space-y-4" data-testid="host-mcq-running">
            <p className="font-semibold text-text-primary break-words">{mcq.question.question}</p>
            <ul className="space-y-1.5">
              {mcq.question.options.map((o, i) => (
                <li key={i} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${host.correctIndex === i ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-border-subtle bg-surface-alt text-text-primary'}`}>
                  <span className="font-bold w-5">{LETTERS[i]}</span><span className="min-w-0 break-words flex-1">{o}</span>{host.correctIndex === i && <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-label="Correct answer" />}
                </li>
              ))}
            </ul>
            <div className="rounded-2xl bg-surface-alt border border-border-subtle p-3">
              <div className="flex items-center justify-between text-sm"><span className="text-text-secondary">Answers received</span><span className="font-bold text-text-primary" data-testid="host-mcq-count">{progress ? `${progress.submitted} / ${progress.eligible}` : '0'}</span></div>
              <div className="h-2 mt-2 rounded-full bg-black/10 overflow-hidden"><div className="h-full bg-brand-primary transition-all" style={{ width: `${progress && progress.eligible ? Math.min(100, (progress.submitted / progress.eligible) * 100) : 0}%` }} /></div>
              <p className="text-xs text-text-muted mt-2">Time left: <strong className="tabular-nums">{secondsLeft(mcq.deadline)}s</strong> - students see the same server clock.</p>
            </div>
            <button disabled={closing} onClick={async () => { setClosing(true); await onClose(); setClosing(false); }} className="btn-outline w-full min-h-[48px] gap-2" data-testid="host-mcq-close"><Square className="w-4 h-4" />Close question now</button>
          </div>
        )}

        {!open && results && (
          <div className="p-4 space-y-4" data-testid="host-mcq-results">
            <p className="font-semibold text-text-primary break-words">{results.question}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Eligible', results.totals.eligible], ['Answered', results.totals.submitted], ['Correct', results.totals.correct]].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-surface-alt border border-border-subtle py-2"><p className="text-lg font-bold text-text-primary">{v}</p><p className="text-[11px] text-text-muted">{k}</p></div>
              ))}
            </div>
            <p className="text-sm text-text-secondary">Correct answer: <strong className="text-emerald-700">{LETTERS[results.correctIndex]}. {results.options[results.correctIndex]}</strong></p>
            {results.ranking.length > 0 && (
              <ol className="space-y-1" aria-label="Top answers">{results.ranking.map((r) => <li key={r.userId} className="flex items-center gap-2 text-sm rounded-xl bg-amber-50 border border-amber-200 px-3 py-1.5"><span className="font-bold w-5">{r.rank}</span><span className="flex-1 truncate">{r.name}</span><span className="text-xs text-text-muted">{r.standard}</span><span className="font-semibold tabular-nums">{r.answerTimeLabel}</span></li>)}</ol>
            )}
            <details className="rounded-xl border border-border-subtle">
              <summary className="px-3 py-2 text-sm font-semibold cursor-pointer min-h-[44px] flex items-center">All answers ({results.results.length})</summary>
              <ul className="divide-y divide-border-subtle max-h-56 overflow-y-auto text-sm">
                {results.results.map((r) => <li key={r.userId} className="flex items-center gap-2 px-3 py-1.5"><span className={r.isCorrect ? 'text-emerald-600' : 'text-rose-500'}>{r.isCorrect ? '✓' : '✗'}</span><span className="flex-1 truncate">{r.name}</span><span className="text-xs text-text-muted">{LETTERS[r.selectedOption]} · {secLabel(r.answerTimeMs)}</span></li>)}
                {results.notAnswered.map((r) => <li key={r.userId} className="flex items-center gap-2 px-3 py-1.5 text-text-muted"><span>–</span><span className="flex-1 truncate">{r.name}</span><span className="text-xs">no answer</span></li>)}
              </ul>
            </details>
            <button onClick={onDismiss} className="btn-outline w-full min-h-[48px]">Done</button>
          </div>
        )}

        {!open && !results && (
          <form className="p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); launch(); }}>
            <label className="block text-sm font-semibold text-text-primary" htmlFor="mcq-q">Question</label>
            <textarea id="mcq-q" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} rows={2} placeholder="Type your question" className="input-field !text-base sm:!text-sm" />
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-text-primary">Options - tick the correct one</legend>
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="radio" name="correct" checked={correct === i} onChange={() => setCorrect(i)} aria-label={`Option ${LETTERS[i]} is correct`} className="w-5 h-5 accent-emerald-600 flex-shrink-0" />
                  <span className="w-5 font-bold text-text-secondary">{LETTERS[i]}</span>
                  <input value={o} maxLength={200} onChange={(e) => setOptions((l) => l.map((x, k) => (k === i ? e.target.value : x)))} placeholder={`Option ${LETTERS[i]}`} aria-label={`Option ${LETTERS[i]}`} className="input-field !py-2.5 !text-base sm:!text-sm" />
                  {options.length > 2 && <button type="button" aria-label={`Remove option ${LETTERS[i]}`} onClick={() => { setOptions((l) => l.filter((_, k) => k !== i)); setCorrect((c) => (c === i ? null : c !== null && c > i ? c - 1 : c)); }} className="w-10 h-10 inline-flex items-center justify-center text-text-muted hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>}
                </div>
              ))}
              {options.length < 4 && <button type="button" onClick={() => setOptions((l) => [...l, ''])} className="text-sm text-brand-primary font-semibold inline-flex items-center gap-1 min-h-[44px]"><Plus className="w-4 h-4" />Add option</button>}
            </fieldset>
            <p className="text-xs text-text-muted">Students get 15 seconds. The correct answer and the ranking stay hidden until the question closes.</p>
            {error && <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{error}</p>}
            <button type="submit" disabled={!valid || host.launching} className="btn-primary w-full min-h-[52px] gap-2 disabled:opacity-50" data-testid="host-mcq-launch">{host.launching ? <><Loader className="w-4 h-4 animate-spin" />Launching…</> : <><Send className="w-4 h-4" />Launch for the class</>}</button>
          </form>
        )}
      </div>
    </div>
  );
};
