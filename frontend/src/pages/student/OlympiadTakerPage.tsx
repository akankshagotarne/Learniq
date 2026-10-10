import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Clock, ChevronLeft, ChevronRight, Bookmark, Eraser, Send, LayoutGrid, X, AlertTriangle,
  Loader2, CheckCircle2, CloudOff, Cloud, User as UserIcon, RefreshCw,
} from 'lucide-react';
import Logo from '../../components/ui/Logo';
import { useAuth } from '../../context/AuthContext';
import { AnswerUpdate, olympiadApi, olympiadErrorCode, olympiadErrorMessage } from '../../services/olympiad';
import { OlympiadAttemptPayload, OlympiadQuestion, OlympiadResponse } from '../../types/olympiad';
import { formatClock } from '../../utils/olympiadFormat';
import ProctoringGate, { GateResult } from '../../proctoring/ProctoringGate';
import ProctoringMonitor from '../../proctoring/ProctoringMonitor';
import { useProctoring } from '../../proctoring/useProctoring';
import { DEFAULT_PROCTORING_POLICY, ProctoringPolicy, SessionState } from '../../proctoring/types';
import { OlympiadExam } from '../../types/olympiad';

type SaveState = 'saved' | 'saving' | 'error';
interface Pending { update: AnswerUpdate; v: number }

const DEBOUNCE_MS = 1200;
const RETRY_INTERVAL_MS = 15000;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const OlympiadTakerPage: React.FC = () => {
  const { examId = '' } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [data, setData] = useState<OlympiadAttemptPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [responses, setResponses] = useState<Record<string, OlympiadResponse>>({});
  const responsesRef = useRef(responses);
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [showPalette, setShowPalette] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [timeUp, setTimeUp] = useState(false);

  // Monotonic timer baseline: seconds left at the last server sync + performance.now() at that moment.
  // performance.now() is immune to the student changing the device clock.
  const syncRef = useRef({ base: 0, at: 0 });
  const pendingRef = useRef<Map<string, Pending>>(new Map());
  const versionRef = useRef(0);
  const flushingRef = useRef<Promise<boolean> | null>(null);
  const flushAgainRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);
  const submittingRef = useRef(false);
  const nextAutoRef = useRef(0);

  const storageKey = `learniq_oly_pending_${examId}_${user?._id || 'anon'}`;

  // online proctoring (only when the exam has it enabled)
  const [gateExam, setGateExam] = useState<OlympiadExam | null>(null);
  const [proctorPolicy, setProctorPolicy] = useState<ProctoringPolicy | null>(null);
  const [terminated, setTerminated] = useState<SessionState | null>(null);

  // ── helpers ──────────────────────────────────────────────
  const persistPending = useCallback(() => {
    try {
      if (pendingRef.current.size === 0) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(Array.from(pendingRef.current.values()).map(p => p.update)));
    } catch { /* storage may be unavailable */ }
  }, [storageKey]);

  const resync = useCallback((serverRemaining: number) => {
    const local = Math.max(0, syncRef.current.base - (performance.now() - syncRef.current.at) / 1000);
    if (serverRemaining < local || serverRemaining - local > 3) {
      syncRef.current = { base: serverRemaining, at: performance.now() };
    }
  }, []);

  const goToResult = useCallback(() => {
    finishedRef.current = true;
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    navigate(`/student/olympiad/${examId}/result`, { replace: true });
  }, [examId, navigate, storageKey]);

  // ── saving ───────────────────────────────────────────────
  const flush = useCallback((): Promise<boolean> => {
    if (finishedRef.current) return Promise.resolve(true);
    if (flushingRef.current) {
      flushAgainRef.current = true;
      return flushingRef.current;
    }
    if (pendingRef.current.size === 0) return Promise.resolve(true);

    const snapshot = Array.from(pendingRef.current.entries());
    setSaveState('saving');
    const run = (async (): Promise<boolean> => {
      try {
        const res = await olympiadApi.saveAnswers(examId, snapshot.map(([, p]) => p.update));
        snapshot.forEach(([qid, p]) => {
          if (pendingRef.current.get(qid)?.v === p.v) pendingRef.current.delete(qid);
        });
        persistPending();
        resync(res.remainingSeconds);
        setSaveState(pendingRef.current.size > 0 ? 'saving' : 'saved');
        return true;
      } catch (err: any) {
        const code = olympiadErrorCode(err);
        if (code === 'TIME_UP' || code === 'ALREADY_COMPLETED') {
          toast(code === 'TIME_UP' ? 'Time is up. Your examination was submitted automatically.' : 'This examination is already submitted.');
          goToResult();
          return true;
        }
        if (err?.response?.status === 400) {
          // a malformed batch would otherwise be retried forever
          snapshot.forEach(([qid, p]) => { if (pendingRef.current.get(qid)?.v === p.v) pendingRef.current.delete(qid); });
          persistPending();
        }
        setSaveState('error');
        return false;
      } finally {
        flushingRef.current = null;
        if (flushAgainRef.current) {
          flushAgainRef.current = false;
          if (!finishedRef.current) setTimeout(() => { void flush(); }, 0);
        }
      }
    })();
    flushingRef.current = run;
    return run;
  }, [examId, goToResult, persistPending, resync]);

  const scheduleFlush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
  }, [flush]);

  const updateResponse = useCallback((q: OlympiadQuestion, patch: Partial<OlympiadResponse>) => {
    if (finishedRef.current || submittingRef.current) return;
    const prev = responsesRef.current[q._id] || { selectedOption: null, marked: false };
    const next: OlympiadResponse = { ...prev, ...patch };
    const updated = { ...responsesRef.current, [q._id]: next };
    responsesRef.current = updated;
    setResponses(updated);
    pendingRef.current.set(q._id, {
      v: ++versionRef.current,
      update: { questionId: q._id, selectedOption: next.selectedOption, marked: next.marked },
    });
    persistPending();
    setSaveState('saving');
    scheduleFlush();
  }, [persistPending, scheduleFlush]);

  // ── initial load ─────────────────────────────────────────
  /** Show an attempt payload (fresh or resumed), merging answers saved locally but never confirmed by the server. */
  const applyPayload = useCallback((payload: OlympiadAttemptPayload) => {
    payload.questions = [...payload.questions].sort((a, b) => a.questionNumber - b.questionNumber);
    const merged: Record<string, OlympiadResponse> = { ...payload.responses };
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const ids = new Set(payload.questions.map(q => q._id));
        (JSON.parse(raw) as AnswerUpdate[]).forEach(u => {
          if (!ids.has(u.questionId)) return;
          merged[u.questionId] = { selectedOption: u.selectedOption ?? null, marked: !!u.marked };
          pendingRef.current.set(u.questionId, { v: ++versionRef.current, update: u });
        });
      }
    } catch { /* ignore corrupt backup */ }

    responsesRef.current = merged;
    setResponses(merged);
    syncRef.current = { base: payload.attempt.remainingSeconds, at: performance.now() };
    setRemaining(payload.attempt.remainingSeconds);
    setData(payload);
  }, [storageKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const exam = await olympiadApi.getExam(examId);
      if (exam.state === 'completed') { goToResult(); return; }
      if (exam.proctoring?.enabled) {
        // proctored: the pre-exam checks run first; they start / resume the attempt when everything passes
        setProctorPolicy({ ...DEFAULT_PROCTORING_POLICY, ...exam.proctoring });
        setGateExam(exam);
        return;
      }
      const payload = await olympiadApi.getAttempt(examId);
      applyPayload(payload);
      if (pendingRef.current.size > 0) { setSaveState('saving'); scheduleFlush(); }
    } catch (err: any) {
      const code = olympiadErrorCode(err);
      if (code === 'ALREADY_COMPLETED') { goToResult(); return; }
      if (code === 'NO_ATTEMPT') { navigate(`/student/olympiad/${examId}`, { replace: true }); return; }
      setLoadError(olympiadErrorMessage(err, 'Unable to load your examination.'));
    } finally {
      setLoading(false);
    }
  }, [examId, goToResult, navigate, scheduleFlush, applyPayload]);

  const proctor = useProctoring({
    kind: 'olympiad',
    examId,
    policy: proctorPolicy || DEFAULT_PROCTORING_POLICY,
    getAnswersSnapshot: () => Object.entries(responsesRef.current).map(([questionId, r]) => ({ questionId, selectedOption: r.selectedOption, marked: r.marked })),
    onTerminated: (state) => {
      finishedRef.current = true;
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      if (state.autoSubmitted) setTerminated(state);
      else goToResult();
    },
  });

  /** Pre-exam checks passed (fullscreen is on): start or resume the attempt, then open the monitoring session. */
  const handleProctoredReady = async ({ precheck, stream, detector }: GateResult) => {
    let payload: OlympiadAttemptPayload;
    try {
      payload = await olympiadApi.start(examId);
    } catch (err: any) {
      if (olympiadErrorCode(err) === 'ALREADY_COMPLETED') { goToResult(); return; }
      throw new Error(olympiadErrorMessage(err, 'Unable to start the examination.'));
    }
    applyPayload(payload);
    const state = await proctor.start(payload.attempt._id, precheck, stream, detector);
    if (!state.terminated) setGateExam(null);
    if (pendingRef.current.size > 0) { setSaveState('saving'); scheduleFlush(); }
  };

  useEffect(() => { void load(); }, [load]);

  // The palette drawer (phones / tablets) closes with Escape like any dialog
  useEffect(() => {
    if (!showPalette) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowPalette(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showPalette]);

  // ── submit ───────────────────────────────────────────────
  const submit = useCallback(async (auto = false) => {
    if (submittingRef.current || finishedRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    try {
      if (flushingRef.current) await flushingRef.current.catch(() => false);
      const answers: AnswerUpdate[] = Object.entries(responsesRef.current).map(([questionId, r]) => ({
        questionId, selectedOption: r.selectedOption, marked: r.marked,
      }));
      await olympiadApi.submit(examId, answers);
      toast.success(auto ? 'Time is up. Your examination has been submitted.' : 'Examination submitted successfully.');
      goToResult();
    } catch (err: any) {
      const code = olympiadErrorCode(err);
      if (code === 'ALREADY_COMPLETED') { goToResult(); return; }
      submittingRef.current = false;
      setSubmitting(false);
      setSubmitError(olympiadErrorMessage(err, 'Could not submit. Please check your connection and try again.'));
      if (auto) setShowSubmit(true);
    }
  }, [examId, goToResult]);

  // ── timer ────────────────────────────────────────────────
  useEffect(() => {
    if (!data) return;
    const tick = () => {
      const left = Math.max(0, syncRef.current.base - (performance.now() - syncRef.current.at) / 1000);
      setRemaining(left);
      if (left <= 0 && !submittingRef.current && !finishedRef.current && performance.now() >= nextAutoRef.current) {
        nextAutoRef.current = performance.now() + 4000; // back off if the auto-submit fails (offline)
        setTimeUp(true);
        void submit(true);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [data, submit]);

  // retry unsaved answers periodically, when back online and when the tab becomes visible again
  useEffect(() => {
    if (!data) return;
    const retry = () => { if (pendingRef.current.size > 0) void flush(); };
    const id = setInterval(retry, RETRY_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') retry(); };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [data, flush]);

  // warn before leaving mid-exam
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (finishedRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // ── derived ──────────────────────────────────────────────
  const questions = data?.questions || [];
  const q = questions[current];

  const stats = useMemo(() => {
    let answered = 0, marked = 0;
    questions.forEach(x => {
      const r = responses[x._id];
      if (r?.selectedOption !== null && r?.selectedOption !== undefined) answered++;
      if (r?.marked) marked++;
    });
    return { answered, marked, notAnswered: questions.length - answered };
  }, [questions, responses]);

  const groups = useMemo(() => {
    const map = new Map<string, { q: OlympiadQuestion; idx: number }[]>();
    questions.forEach((x, idx) => {
      const key = x.subject || 'Questions';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ q: x, idx });
    });
    return Array.from(map.entries());
  }, [questions]);

  const remainingCeil = Math.ceil(remaining);
  const timerTone = remainingCeil <= 60
    ? 'bg-[#E1447A]/10 text-[#E1447A] border-[#E1447A]/40'
    : remainingCeil <= 300
    ? 'bg-[#FFC24B]/15 text-[#B7791F] dark:text-[#FFC24B] border-[#FFC24B]/40'
    : 'bg-surface-alt text-text-primary border-border-subtle';

  // ── screens ──────────────────────────────────────────────
  if (terminated) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div role="alertdialog" aria-modal="true" aria-labelledby="term-title" className="card-soft p-8 text-center max-w-md border border-[#E1447A]/40" data-testid="olympiad-terminated">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#E1447A]/10 text-[#E1447A] flex items-center justify-center mb-4"><AlertTriangle className="w-7 h-7" /></div>
          <h2 id="term-title" className="font-heading font-bold text-lg text-text-primary mb-1">Your examination has been submitted automatically.</h2>
          <p className="text-sm text-text-secondary">Reason: {terminated.terminationText || 'Examination rule violation.'}</p>
          <p className="text-xs text-text-muted mt-2">Your saved answers were evaluated. The recorded events will be reviewed.</p>
          <button onClick={goToResult} className="btn-primary text-sm py-2.5 px-5 mt-5">View result</button>
        </div>
      </div>
    );
  }

  if (gateExam && proctorPolicy && !loading) {
    return (
      <ProctoringGate
        kind="olympiad"
        examId={examId}
        examTitle={gateExam.title}
        durationMinutes={gateExam.durationMinutes}
        policy={proctorPolicy}
        resume={gateExam.state === 'in_progress'}
        backTo={`/student/olympiad/${examId}`}
        onReady={handleProctoredReady}
      />
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="flex items-center gap-3 text-text-secondary text-sm">
          <Loader2 className="w-5 h-5 animate-spin text-brand-primary" /> Loading your examination…
        </div>
      </div>
    );
  }

  if (loadError || !data || !q) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center p-6">
        <div className="card-soft p-10 text-center max-w-md">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#E1447A]/10 text-[#E1447A] flex items-center justify-center mb-4">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="font-heading font-bold text-lg text-text-primary mb-1">Unable to open the examination</h2>
          <p className="text-sm text-text-secondary mb-5">{loadError || 'No questions were found for this examination.'}</p>
          <div className="flex gap-2 justify-center">
            <button onClick={() => void load()} className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
            <button onClick={() => navigate('/student/exams')} className="text-xs py-2 px-4 rounded-xl border border-border-subtle text-text-primary bg-surface-alt">
              Back to Exams
            </button>
          </div>
        </div>
      </div>
    );
  }

  const resp = responses[q._id] || { selectedOption: null, marked: false };

  const paletteButton = (item: { q: OlympiadQuestion; idx: number }) => {
    const r = responses[item.q._id];
    const isAnswered = r?.selectedOption !== null && r?.selectedOption !== undefined;
    const isMarked = !!r?.marked;
    const isCurrent = item.idx === current;
    let tone = 'bg-surface-alt border-border-subtle text-text-secondary hover:border-brand-primary';
    if (isMarked) tone = 'bg-[#FFC24B] border-[#FFC24B] text-white';
    else if (isAnswered) tone = 'bg-[#4ADE9A] border-[#4ADE9A] text-white';
    return (
      <button
        key={item.q._id}
        type="button"
        onClick={() => { setCurrent(item.idx); setShowPalette(false); }}
        aria-label={`Question ${item.idx + 1}${isAnswered ? ', answered' : ', not answered'}${isMarked ? ', marked for review' : ''}`}
        className={`relative h-10 w-10 sm:h-9 sm:w-9 rounded-lg border text-xs font-bold transition-all ${tone} ${isCurrent ? 'ring-2 ring-offset-1 ring-[#6C63F2]' : ''}`}
      >
        {item.q.questionNumber}
        {isMarked && isAnswered && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#4ADE9A] border border-white" />}
      </button>
    );
  };

  const palette = (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2 text-[11px] text-text-secondary">
        <span className="flex items-center gap-1.5"><i className="w-3.5 h-3.5 rounded bg-[#4ADE9A] inline-block" /> Answered</span>
        <span className="flex items-center gap-1.5"><i className="w-3.5 h-3.5 rounded bg-surface-alt border border-border-subtle inline-block" /> Not Answered</span>
        <span className="flex items-center gap-1.5"><i className="w-3.5 h-3.5 rounded bg-[#FFC24B] inline-block" /> Marked for Review</span>
        <span className="flex items-center gap-1.5"><i className="w-3.5 h-3.5 rounded ring-2 ring-[#6C63F2] bg-surface inline-block" /> Current</span>
      </div>
      {groups.map(([subject, items]) => (
        <div key={subject}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-text-muted mb-2">{subject}</p>
          <div className="flex flex-wrap gap-1.5">{items.map(paletteButton)}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-page flex flex-col select-none" data-testid="olympiad-taker">
      {/* Top bar */}
      <header className="h-16 bg-surface border-b border-border-subtle flex items-center justify-between gap-3 px-3 sm:px-6 sticky top-0 z-30">
        <div className="flex items-center gap-3 min-w-0">
          <Logo size="sm" />
          <div className="hidden md:block min-w-0 border-l border-border-subtle pl-3">
            <p className="text-xs font-bold text-text-primary truncate max-w-[340px]">{data.exam.title}</p>
            <p className="text-[11px] text-text-muted flex items-center gap-1 truncate">
              <UserIcon className="w-3 h-3" /> {user?.name}
            </p>
          </div>
        </div>

        <div className="hidden sm:block text-xs font-semibold text-text-secondary whitespace-nowrap">
          Question {current + 1} of {questions.length}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className={`hidden sm:flex items-center gap-1 text-[11px] ${saveState === 'error' ? 'text-[#E1447A]' : 'text-text-muted'}`}>
            {saveState === 'saving' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>}
            {saveState === 'saved' && <><Cloud className="w-3.5 h-3.5 text-[#4ADE9A]" /> Saved</>}
            {saveState === 'error' && <><CloudOff className="w-3.5 h-3.5" /> Not saved — retrying</>}
          </span>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-heading font-bold text-sm tabular-nums ${timerTone}`} aria-label="Time remaining">
            <Clock className="w-4 h-4" /> {formatClock(remainingCeil)}
          </div>
          <button
            type="button"
            onClick={() => { setSubmitError(null); setShowSubmit(true); }}
            className="btn-primary hidden sm:flex items-center gap-1.5 py-2 px-4 rounded-xl text-xs font-bold"
          >
            <Send className="w-3.5 h-3.5" /> Submit
          </button>
          <button
            type="button"
            onClick={() => setShowPalette(true)}
            className="lg:hidden w-11 h-11 inline-flex items-center justify-center rounded-xl border border-border-subtle bg-surface-alt text-text-primary"
            aria-label="Open question palette"
            aria-expanded={showPalette}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 p-3 sm:p-6">
        {/* Question card */}
        <section className="card-soft rounded-2xl p-4 sm:p-6 flex flex-col">
          <div className="flex items-start justify-between gap-2 mb-4">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#6C63F2]/10 text-[#6C63F2]">
                Question {current + 1} of {questions.length}
              </span>
              {q.subject && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-surface-alt border border-border-subtle text-text-secondary">{q.subject}</span>}
              {resp.marked && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#FFC24B]/15 text-[#B7791F] dark:text-[#FFC24B]">Marked for review</span>}
            </div>
            <span className="text-[11px] text-text-muted whitespace-nowrap">{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span>
          </div>

          <p className="text-base sm:text-lg text-text-primary font-medium leading-relaxed whitespace-pre-wrap break-words">
            {q.questionText}
          </p>
          {q.image && (
            <img src={q.image} alt={`Diagram for question ${q.questionNumber}`} className="mt-4 max-w-full max-h-72 rounded-xl border border-border-subtle object-contain self-start" />
          )}

          <div className="mt-5 space-y-2.5" role="radiogroup" aria-label="Answer options">
            {q.options.map((opt, i) => {
              const selected = resp.selectedOption === i;
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => updateResponse(q, { selectedOption: selected ? null : i })}
                  className={`w-full text-left flex items-start gap-3 p-3.5 rounded-xl border-2 transition-all ${
                    selected
                      ? 'border-[#6C63F2] bg-[#6C63F2]/10'
                      : 'border-border-subtle bg-surface hover:border-[#6C63F2]/50 hover:bg-surface-alt'
                  }`}
                >
                  <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    selected ? 'bg-[#6C63F2] text-white' : 'bg-surface-alt border border-border-subtle text-text-secondary'
                  }`}>
                    {LETTERS[i]}
                  </span>
                  <span className="min-w-0 text-sm text-text-primary leading-relaxed pt-0.5 break-words">{opt}</span>
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="mt-6 pt-4 border-t border-border-subtle flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-2">
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <button
                type="button"
                onClick={() => updateResponse(q, { selectedOption: null })}
                disabled={resp.selectedOption === null || resp.selectedOption === undefined}
                className="flex items-center justify-center gap-1.5 min-h-[44px] py-2 px-3 rounded-xl border border-border-subtle bg-surface-alt text-xs font-semibold text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Eraser className="w-3.5 h-3.5" /> Clear Answer
              </button>
              <button
                type="button"
                onClick={() => updateResponse(q, { marked: !resp.marked })}
                aria-pressed={resp.marked}
                className={`flex items-center justify-center gap-1.5 min-h-[44px] py-2 px-3 rounded-xl border text-xs font-semibold ${
                  resp.marked
                    ? 'border-[#FFC24B] bg-[#FFC24B]/15 text-[#B7791F] dark:text-[#FFC24B]'
                    : 'border-border-subtle bg-surface-alt text-text-primary'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" /> {resp.marked ? 'Unmark Review' : 'Mark for Review'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <button
                type="button"
                onClick={() => setCurrent(c => Math.max(0, c - 1))}
                disabled={current === 0}
                className="flex items-center justify-center gap-1 min-h-[44px] py-2 px-4 rounded-xl border border-border-subtle bg-surface-alt text-xs font-semibold text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <button
                type="button"
                onClick={() => setCurrent(c => Math.min(questions.length - 1, c + 1))}
                disabled={current === questions.length - 1}
                className="btn-primary flex items-center justify-center gap-1 min-h-[44px] py-2 px-4 rounded-xl text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => { setSubmitError(null); setShowSubmit(true); }}
            className="sm:hidden mt-3 btn-primary flex items-center justify-center gap-1.5 min-h-[48px] py-2.5 rounded-xl text-sm font-bold"
          >
            <Send className="w-3.5 h-3.5" /> Submit Examination
          </button>
        </section>

        {/* Palette (desktop) */}
        <aside className="hidden lg:block">
          <div className="card-soft rounded-2xl p-5 sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <h2 className="font-heading font-bold text-sm text-text-primary mb-1">Question Palette</h2>
            <p className="text-[11px] text-text-muted mb-4">
              {stats.answered} answered · {stats.notAnswered} not answered · {stats.marked} marked
            </p>
            {palette}
          </div>
        </aside>
      </div>

      {/* Palette (mobile / tablet drawer) */}
      {showPalette && (
        <div className="lg:hidden fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={() => setShowPalette(false)}>
          <div
            role="dialog" aria-modal="true" aria-label="Question palette"
            className="bg-surface w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[85dvh] overflow-y-auto overscroll-contain"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-heading font-bold text-sm text-text-primary">Question Palette</h2>
              <button onClick={() => setShowPalette(false)} className="w-10 h-10 -mr-2 inline-flex items-center justify-center rounded-lg hover:bg-surface-alt text-text-secondary" aria-label="Close palette">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] text-text-muted mb-4">
              {stats.answered} answered · {stats.notAnswered} not answered · {stats.marked} marked
            </p>
            {palette}
          </div>
        </div>
      )}

      {/* Submit confirmation */}
      {showSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-surface rounded-2xl p-5 sm:p-6 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-2xl border border-border-subtle" role="dialog" aria-modal="true" aria-labelledby="oly-submit-title">
            <div className="w-12 h-12 rounded-2xl bg-[#6C63F2]/10 text-[#6C63F2] flex items-center justify-center mb-3">
              <Send className="w-6 h-6" />
            </div>
            <h3 id="oly-submit-title" className="font-heading font-bold text-lg text-text-primary">Submit Examination?</h3>
            <p className="text-xs text-text-secondary mt-1 mb-4">
              You cannot change your answers after submitting, and you only have one attempt.
            </p>

            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <div className="p-3 rounded-xl bg-[#4ADE9A]/10 border border-[#4ADE9A]/30">
                <p className="font-heading font-bold text-xl text-text-primary">{stats.answered}</p>
                <p className="text-[11px] text-text-secondary">Answered</p>
              </div>
              <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle">
                <p className="font-heading font-bold text-xl text-text-primary">{stats.notAnswered}</p>
                <p className="text-[11px] text-text-secondary">Not Answered</p>
              </div>
              <div className="p-3 rounded-xl bg-[#FFC24B]/10 border border-[#FFC24B]/30">
                <p className="font-heading font-bold text-xl text-text-primary">{stats.marked}</p>
                <p className="text-[11px] text-text-secondary">Marked</p>
              </div>
            </div>

            {stats.notAnswered > 0 && (
              <p className="text-xs text-[#B7791F] dark:text-[#FFC24B] flex items-start gap-1.5 mb-4">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                {stats.notAnswered} question{stats.notAnswered > 1 ? 's are' : ' is'} still unanswered.
              </p>
            )}
            {submitError && (
              <p className="text-xs text-[#E1447A] flex items-start gap-1.5 mb-4" role="alert">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {submitError}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowSubmit(false)}
                disabled={submitting || timeUp}
                className="flex-1 min-h-[44px] py-2.5 rounded-xl border border-border-subtle bg-surface-alt text-xs font-semibold text-text-primary disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit(false)}
                disabled={submitting}
                className="btn-primary flex-1 min-h-[44px] py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-70"
              >
                {submitting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Submitting…</> : <><CheckCircle2 className="w-3.5 h-3.5" /> Submit Examination</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Time up overlay */}
      {timeUp && !showSubmit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface rounded-2xl p-8 text-center max-w-sm border border-border-subtle">
            <Loader2 className="w-8 h-8 animate-spin text-brand-primary mx-auto mb-3" />
            <h3 className="font-heading font-bold text-lg text-text-primary">Time is up</h3>
            <p className="text-sm text-text-secondary mt-1">Submitting your examination…</p>
          </div>
        </div>
      )}

      {proctorPolicy && <ProctoringMonitor ctl={proctor} policy={proctorPolicy} />}
    </div>
  );
};

export default OlympiadTakerPage;
