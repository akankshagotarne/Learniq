import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Bot, CheckCircle2, CircleStop, Loader2, Mic, MicOff, PhoneOff, RefreshCw, Repeat, ShieldCheck, SkipForward, Volume2, WifiOff,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/admin/ProfileParts';
import {
  aiInterviewApi, aiInterviewErrorCode, aiInterviewErrorMessage, aiInterviewStatusCode, describeInterviewError, type RealtimePart,
} from '../../services/aiInterview';
import { useLiveAvatar } from '../../hooks/useLiveAvatar';
import { isTranscriptionSupported, requestMicrophone, useOpenAITranscription, MicFailure, type SttSnapshot } from '../../hooks/useOpenAITranscription';
import { useLocalTranscription } from '../../hooks/useLocalTranscription';
import { errorCodeForServer, sttDebugEnabled, sttLog, type ProviderErrorInfo } from '../../hooks/sttDiagnostics';
import { AIInterviewTurn, AIInterviewSttSession } from '../../types/aiInterview';

/**
 * The immersive AI Interview screen (the ONLY AI Interview page; opened from the exam card).
 *
 * Everything that matters is decided by the backend: who may take it, the question list, the clock, the scores and the
 * state. This page only (1) connects the microphone + live transcription + avatar, (2) shows what the server tells it
 * to say, and (3) sends the student's FINAL spoken answer back.
 *
 * The two live connections are INDEPENDENT:
 *   - speech-to-text (the student's microphone -> OpenAI Realtime, or the local service in development)
 *   - the avatar (LiveAvatar: the interviewer's face + voice, output only)
 * If one drops, only that one is reconnected; the other keeps running and the student's current turn is not thrown away. If the
 * avatar cannot come back (e.g. a LiveAvatar plan's per-session cap), the interview carries on with subtitles instead of stopping.
 */
type Phase =
  | 'loading' | 'connecting' | 'speaking' | 'listening' | 'thinking' | 'next' | 'completed'
  | 'error' | 'mic_denied' | 'mic_unavailable' | 'unsupported' | 'unavailable';

const PHASE_LABEL: Partial<Record<Phase, string>> = {
  loading: 'Preparing your AI interviewer…',
  connecting: 'Connecting…',
  speaking: 'AI is speaking…',
  listening: "I'm listening…",
  thinking: 'Thinking…',
  next: "Here's your next question…",
  completed: 'Interview completed!',
};

const WORDS_PER_SECOND = 2.6;     // subtitle reveal pace while the avatar speaks (snaps to "all" the moment it stops)
const ANSWER_SETTLE_MS = 900;     // wait this long after a finished sentence for the student to continue
const STT_GRACE_MS = 8000;        // after the student stopped speaking / a manual "done": how long to wait for the final transcript
const MAX_TURN_MS = 20000;        // a single spoken answer longer than this is ended for them (background noise can keep the VAD open)
const MAX_STT_RECONNECTS = 3;
const MAX_AVATAR_RECONNECTS = 2;

const mmss = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** How long a line takes to read / say when the avatar cannot say it. */
const readingMs = (text: string) => Math.min(20000, Math.max(1500, 800 + (text.split(/\s+/).filter(Boolean).length / WORDS_PER_SECOND) * 1000));
/** A strict, log-safe token for the server's event log (the server rejects anything else). */
const eventCode = (v: unknown): string | undefined => {
  const s = String(v ?? '').slice(0, 64);
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(s) ? s : undefined;
};

const AIInterviewPage: React.FC = () => {
  const { examId = '' } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [technical, setTechnical] = useState(''); // the real reason behind an error (shown in development only)
  const [questionNo, setQuestionNo] = useState(0);
  const [total, setTotal] = useState(8);
  const [aiText, setAiText] = useState('');
  const [revealed, setRevealed] = useState(0);
  const [finalText, setFinalText] = useState('');
  const [liveText, setLiveText] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [clockRunning, setClockRunning] = useState(false); // the SERVER clock starts at "begin"; before that nothing counts down
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [attemptUsed, setAttemptUsed] = useState(false); // the first question was presented: this is now the student's one attempt
  const [ending, setEnding] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [sttNotice, setSttNotice] = useState('');       // shown in the YOU box when speech could not be turned into text
  const [avatarNotice, setAvatarNotice] = useState(''); // shown over the video while the avatar reconnects / is gone
  const [diag, setDiag] = useState<(Partial<SttSnapshot> & { sttProvider?: string; avatar?: string; listening?: boolean }) | null>(null);

  const showDiagnostics = useMemo(() => !!import.meta.env.DEV || sttDebugEnabled(), []);

  // mutable interview state (never read during render). Callbacks read THIS, not React state, so they never see a stale value.
  const S = useRef({
    gen: 0, ended: false, interviewId: '', questionId: '', total: 8, silenceMs: 15000, phase: 'loading' as Phase,
    finalParts: [] as string[], liveText: '', pendingTranscript: null as string | null, submitting: false, listening: false,
    silenceTimer: 0 as any, settleTimer: 0 as any, revealTimer: 0 as any, turnTimer: 0 as any, speakStartedAt: 0,
    readResolve: null as null | (() => void),
    sttReconnecting: false, avatarReconnecting: false, avatarDown: false, sttProvider: '',
    sttFailReported: false, sttFailures: 0, presentedSent: false, stream: null as MediaStream | null, sttSeconds: 0, sttSince: 0,
    usedRoutedStart: false,
  }).current;

  const fns = useRef<any>({});

  const avatar = useLiveAvatar({
    onSpeakStart: () => fns.current.onAvatarSpeakStart?.(),
    onDisconnected: (reason) => fns.current.onAvatarLost?.(`avatar:${reason}`),
  });
  const sttHandlers = {
    onSpeechStart: () => fns.current.onSpeechStart?.(),
    onSpeechStop: () => fns.current.onSpeechStop?.(),
    onPartial: (t: string) => fns.current.onPartial?.(t),
    onFinal: (t: string) => fns.current.onFinal?.(t),
    onConnectionLost: (why: string) => fns.current.onSttLost?.(`stt:${why}`),
    onTranscriptionFailed: (d?: ProviderErrorInfo) => fns.current.onTranscriptionFailed?.(d),
  };
  const sttOpenAI = useOpenAITranscription(sttHandlers);
  const sttLocal = useLocalTranscription(sttHandlers);
  // The BACKEND decides which transcription service is used (realtime-session -> stt.provider): OpenAI Realtime by default, the
  // local faster-whisper service in development only. Everything below is identical for both.
  const stt = {
    connect: async (stream: MediaStream, s: AIInterviewSttSession) => {
      if (s.provider === 'local') {
        sttOpenAI.close();
        await sttLocal.connect(stream, { url: s.url, silenceDurationMs: s.silenceDurationMs });
      } else {
        sttLocal.close();
        await sttOpenAI.connect(stream, { clientSecret: s.clientSecret, callsUrl: s.callsUrl });
      }
    },
    setListening: (on: boolean) => { sttOpenAI.setListening(on); sttLocal.setListening(on); },
    commit: (): boolean => sttOpenAI.commit() || sttLocal.commit(),
    close: () => { sttOpenAI.close(); sttLocal.close(); },
  };

  const words = useMemo(() => aiText.split(/\s+/).filter(Boolean), [aiText]);

  // ───────────────────────── helpers ─────────────────────────
  const go = (p: Phase) => { S.phase = p; setPhase(p); };
  const clearTurnTimers = () => {
    clearTimeout(S.silenceTimer); clearTimeout(S.settleTimer); clearTimeout(S.turnTimer);
    S.silenceTimer = 0; S.settleTimer = 0; S.turnTimer = 0;
  };
  const clearTimers = () => { clearTurnTimers(); clearInterval(S.revealTimer); S.revealTimer = 0; };
  const alive = (gen: number) => !S.ended && gen === S.gen;
  const setListeningState = (on: boolean) => { S.listening = on; stt.setListening(on); setMicOn(on); };

  const stopSttClock = () => {
    if (S.sttSince) { S.sttSeconds += (Date.now() - S.sttSince) / 1000; S.sttSince = 0; }
  };

  const showError = (err: any, fallback?: string) => {
    const info = describeInterviewError(err, fallback);
    setMessage(info.message); setTechnical(info.technical || '');
    sttLog('page: ERROR shown', { kind: info.kind, technical: info.technical });
    return info;
  };

  const releaseEverything = useCallback(async () => {
    S.ended = true;
    clearTimers();
    S.readResolve?.();
    stt.close();
    stopSttClock();
    S.listening = false;
    S.stream?.getTracks().forEach((t) => t.stop());
    S.stream = null;
    await avatar.stop();
  }, [avatar, stt]);

  const goToResult = useCallback(() => navigate(`/student/ai-interview/${examId}/result`, { replace: true }), [navigate, examId]);

  // progressive subtitles: the words appear while the avatar talks, all of them once it stops
  const startReveal = () => {
    clearInterval(S.revealTimer);
    S.speakStartedAt = Date.now();
    S.revealTimer = setInterval(() => {
      setRevealed(Math.floor(((Date.now() - S.speakStartedAt) / 1000) * WORDS_PER_SECOND) + 1);
    }, 120);
  };
  const finishReveal = () => { clearInterval(S.revealTimer); S.revealTimer = 0; setRevealed(Number.MAX_SAFE_INTEGER); };

  /** Wait while the student reads a line the avatar could not say (cancelled by "I'm ready to answer"). */
  const readPause = (ms: number) => new Promise<void>((resolve) => {
    const t = setTimeout(() => { S.readResolve = null; resolve(); }, ms);
    S.readResolve = () => { clearTimeout(t); S.readResolve = null; resolve(); };
  });

  /**
   * The interviewer says `text`: through the avatar when it is connected, otherwise as subtitles only (the interview never stops
   * just because the video dropped). Resolves when it has been said / shown.
   */
  const say = async (gen: number, text: string): Promise<{ spoken: boolean }> => {
    setAiText(text); setRevealed(0);
    if (S.avatarDown) {
      startReveal();
      await readPause(readingMs(text));
      finishReveal();
      return { spoken: false };
    }
    // if the avatar never reports "started", the subtitles still move (fallback reveal)
    const fallback = setTimeout(() => { if (alive(gen) && !S.revealTimer) startReveal(); }, 1800);
    try {
      await avatar.speak(text);
      return { spoken: !S.avatarDown };
    } catch (err: any) {
      sttLog('page: avatar could not speak', { code: err?.code || err?.message });
      void fns.current.onAvatarLost?.('avatar:speak_failed');
      if (!alive(gen)) return { spoken: false };
      if (!S.revealTimer) startReveal();
      await readPause(readingMs(text));
      return { spoken: false };
    } finally {
      clearTimeout(fallback);
      finishReveal();
    }
  };

  // ───────────────────────── the conversation loop ─────────────────────────
  fns.current.onAvatarSpeakStart = () => { if (!S.ended) startReveal(); };

  /** The interviewer says `text`; afterwards the student's turn begins (unless the interview is over). */
  const deliver = async (gen: number, text: string, opts: { thenListen?: boolean; firstQuestion?: boolean } = {}) => {
    const thenListen = opts.thenListen !== false;
    clearTurnTimers();
    setListeningState(false);
    setLiveText(''); setFinalText(''); S.finalParts = []; S.liveText = '';
    go('speaking');
    const { spoken } = await say(gen, text);
    if (!alive(gen)) return;
    // the FIRST question has now been spoken to the student: tell the server, which consumes the purchase's single attempt.
    // (Only when the avatar really said it; if not, the server infers it from the student's first turn on the question.)
    if (opts.firstQuestion && spoken && !S.presentedSent && !S.ended) void confirmPresented(gen);
    if (thenListen) startListening(gen);
  };

  const confirmPresented = async (gen: number) => {
    if (!S.interviewId || S.presentedSent) return;
    S.presentedSent = true;
    try {
      const r = await aiInterviewApi.questionPresented(S.interviewId, 'q1');
      if (alive(gen)) setAttemptUsed(!!r.attemptConsumed);
    } catch {
      S.presentedSent = false; // retried with the next delivery; the server also infers it from the student's first turn
    }
  };

  const startListening = (gen: number) => {
    if (!alive(gen)) return;
    S.finalParts = []; S.liveText = ''; S.pendingTranscript = null;
    setLiveText(''); setFinalText(''); setSttNotice('');
    clearTurnTimers();
    setListeningState(true);
    S.sttSince = S.sttSince || Date.now();
    go('listening');
    sttLog('page: listening for an answer', { questionId: S.questionId });
    S.silenceTimer = setTimeout(() => fns.current.onSilence?.(gen), S.silenceMs);
  };

  /** End the answer now: ask the speech service to transcribe what it has, and wait (bounded) for the final text. */
  const finishAnswerNow = (gen: number, why: string) => {
    if (!alive(gen) || !S.listening || S.submitting) return;
    clearTimeout(S.turnTimer); clearTimeout(S.silenceTimer);
    const sent = stt.commit();
    sttLog('page: finishing the answer', { why, commitSent: sent, haveFinal: S.finalParts.length > 0, haveLive: !!S.liveText });
    S.silenceTimer = setTimeout(() => fns.current.onGrace?.(gen), sent ? STT_GRACE_MS : 400);
  };

  fns.current.onSpeechStart = () => {
    sttLog('page: speech started', { listening: S.listening });
    if (!S.listening || S.submitting || S.ended) return;
    setSttNotice('');
    clearTimeout(S.silenceTimer); clearTimeout(S.settleTimer); // the student is talking: no silence prompt, no early submit
    clearTimeout(S.turnTimer);
    const gen = S.gen;
    S.turnTimer = setTimeout(() => finishAnswerNow(gen, 'answer_too_long'), MAX_TURN_MS);
  };
  // The student stopped speaking but no transcript has arrived yet (a cough that was not a word, an empty transcript, a slow or failed
  // transcription). Without this the silence prompt, which stops while the student is speaking, would never come back and the
  // interview would sit on "I'm listening..." for ever. A transcript that does arrive within the grace period cancels it (onFinal).
  fns.current.onSpeechStop = () => {
    sttLog('page: speech stopped', { listening: S.listening, haveFinal: S.finalParts.length > 0 });
    clearTimeout(S.turnTimer);
    if (S.ended || S.submitting || !S.listening || S.finalParts.length) return;
    clearTimeout(S.silenceTimer);
    const gen = S.gen;
    S.silenceTimer = setTimeout(() => fns.current.onGrace?.(gen), STT_GRACE_MS);
  };
  /** The grace period ran out: use the final text if any, else the live text the student SAW (better than losing it), else silence. */
  fns.current.onGrace = (gen: number) => {
    if (!alive(gen) || S.submitting || !S.listening) return;
    if (S.finalParts.length) { fns.current.submit?.(gen); return; }
    const live = S.liveText.trim();
    if (live) { sttLog('page: no final transcript arrived; using the live text', { chars: live.length }); void sendTurn(gen, { transcript: live }); return; }
    fns.current.onSilence?.(gen);
  };
  fns.current.onPartial = (t: string) => {
    if (S.ended || S.submitting || !S.listening) return;
    S.sttFailures = 0;
    S.liveText = t;
    setSttNotice('');
    setLiveText(t); // LIVE text (italic, "live" badge) — not saved
  };
  fns.current.onFinal = (t: string) => {
    sttLog('page: final transcript', { listening: S.listening, submitting: S.submitting, ended: S.ended, chars: t.length });
    if (S.ended || S.submitting || !S.listening) return;
    S.sttFailures = 0;
    setSttNotice('');
    S.finalParts.push(t);
    S.liveText = '';
    setFinalText(S.finalParts.join(' '));   // FINAL text
    setLiveText('');
    clearTurnTimers();
    const gen = S.gen;
    S.settleTimer = setTimeout(() => fns.current.submit?.(gen), ANSWER_SETTLE_MS);
  };
  fns.current.onSilence = (gen: number) => {
    if (!alive(gen) || S.submitting || !S.listening) return;
    void sendTurn(gen, { kind: 'silence' });
  };
  fns.current.submit = (gen: number) => {
    if (!alive(gen) || S.submitting) return;
    const transcript = S.finalParts.join(' ').trim();
    if (!transcript) { startListening(gen); return; }
    void sendTurn(gen, { transcript });
  };

  /** Send one turn to the backend and act on its decision. Only a FINAL transcript (or a silence / repeat request) is sent. */
  const sendTurn = async (gen: number, turn: { transcript?: string; kind?: 'answer' | 'silence' | 'repeat' }, attempt = 0): Promise<void> => {
    if (S.submitting && attempt === 0) return;
    S.submitting = true;
    sttLog('page: sending turn to the backend', { kind: turn.kind || 'answer', chars: (turn.transcript || '').length, attempt });
    setListeningState(false); setSttNotice('');
    clearTurnTimers();
    go('thinking');
    S.pendingTranscript = turn.transcript ?? null;
    let reply: AIInterviewTurn;
    try {
      reply = await aiInterviewApi.answer(S.interviewId, { questionId: S.questionId, transcript: turn.transcript, kind: turn.kind });
    } catch (err: any) {
      if (!alive(gen)) { S.submitting = false; return; }
      const code = aiInterviewErrorCode(err);
      const status = aiInterviewStatusCode(err);
      const info = describeInterviewError(err);
      // the server is still evaluating an earlier copy of this answer (e.g. after a slow reply): wait for it
      if (code === 'BUSY' && attempt < 20) { await sleep(1500); return sendTurn(gen, turn, attempt + 1); }
      if (code === 'STALE_QUESTION' || (code === 'BUSY' && attempt >= 20)) { S.submitting = false; return fns.current.resync?.(gen); }
      if (status === 404 || status === 403) { S.submitting = false; return fns.current.blocked?.(aiInterviewErrorMessage(err)); }
      // a slow reply may still have been processed by the server: ask it where the interview is instead of guessing
      if (info.kind === 'timeout') { S.submitting = false; return fns.current.resync?.(gen); }
      if (attempt < 1 && (info.kind === 'network' || status === 502 || status === 503)) { await sleep(1500); return sendTurn(gen, turn, attempt + 1); } // one quiet automatic retry
      S.submitting = false;
      showError(err);
      go('error'); // the student's answer is kept; "Try again" sends it again
      return;
    }
    S.submitting = false;
    if (!alive(gen)) return;
    await fns.current.applyReply?.(gen, reply);
  };

  fns.current.applyReply = async (gen: number, reply: AIInterviewTurn) => {
    S.pendingTranscript = null;
    if (reply.remainingSeconds != null) setRemaining(reply.remainingSeconds);
    if (reply.done) {
      go('completed');
      const hadResult = !!reply.result;
      const line = reply.closing || '';
      if (line) {
        try { await say(gen, line); } catch { /* the result page shows the same feedback */ }
      }
      if (!alive(gen)) return;
      await releaseEverything();
      if (hadResult) goToResult();
      else { toast('The interview ended because of a technical problem, so nothing was used up. You can start it again.'); navigate('/student/exams', { replace: true }); }
      return;
    }
    const isNewQuestion = !!reply.question && reply.question.questionId !== S.questionId;
    if (reply.question) {
      S.questionId = reply.question.questionId;
      setQuestionNo(reply.question.index);
    }
    if (isNewQuestion) go('next'); // "Here's your next question…" (not for a repeat or a silence prompt)
    await deliver(gen, reply.utterance || '');
  };

  /** The server and this screen disagree about the current question (late duplicate, slow reply): continue from the server's state. */
  fns.current.resync = async (gen: number) => {
    try {
      const { interview } = await aiInterviewApi.get(S.interviewId);
      if (!alive(gen)) return;
      if (interview.completed) { await releaseEverything(); goToResult(); return; }
      if (interview.remainingSeconds != null) setRemaining(interview.remainingSeconds);
      if (interview.attemptConsumed) { S.presentedSent = true; setAttemptUsed(true); }
      if (interview.currentQuestion) {
        const moved = interview.currentQuestion.questionId !== S.questionId;
        S.questionId = interview.currentQuestion.questionId;
        setQuestionNo(interview.currentQuestion.index);
        const lead = moved ? 'Here is your next question.' : 'Let me ask that again.';
        await deliver(gen, `${lead} ${interview.currentQuestion.question}`, { firstQuestion: interview.currentQuestion.index === 1 });
        return;
      }
      // the server ended it (time up / technical): the normal end-of-interview path
      await fns.current.applyReply?.(gen, { success: true, done: true, result: null } as AIInterviewTurn);
    } catch (err: any) {
      if (!alive(gen)) return;
      showError(err); go('error');
    }
  };

  fns.current.blocked = async (msg: string) => {
    await releaseEverything();
    setMessage(msg || 'The AI Interview is not available right now.');
    go('unavailable');
  };

  // ───────────────────────── connection / start-up ─────────────────────────
  /** Get fresh short-lived credentials for the requested part(s) and connect them. Throws a precise, tagged error. */
  const connectProviders = async (gen: number, stream: MediaStream, parts: RealtimePart[]): Promise<boolean> => {
    const rt = await aiInterviewApi.realtimeSession(S.interviewId, parts.length === 2 ? undefined : parts);
    if (!alive(gen)) return false;
    S.silenceMs = rt.config?.silenceTimeoutMs || S.silenceMs;
    if (rt.stt) S.sttProvider = rt.stt.provider || 'openai';
    sttLog('page: connecting', { parts, sttProvider: rt.stt ? S.sttProvider : undefined });
    const jobs: Array<Promise<void>> = [];
    const kinds: RealtimePart[] = [];
    if (rt.avatar) { kinds.push('avatar'); jobs.push(avatar.connect(rt.avatar.sessionToken)); }
    if (rt.stt) { kinds.push('stt'); jobs.push(stt.connect(stream, rt.stt)); }
    const results = await Promise.allSettled(jobs);
    if (!alive(gen)) return false;
    let firstFailure: any = null;
    results.forEach((r, i) => {
      const part = kinds[i];
      if (r.status === 'fulfilled') { aiInterviewApi.event(S.interviewId, part === 'stt' ? 'stt_connected' : 'avatar_connected'); return; }
      const err: any = r.reason || {};
      const code = eventCode(err.code || err.message);
      sttLog(`page: ${part} connection FAILED`, { code: err.code || err.message, detail: err.detail });
      aiInterviewApi.event(S.interviewId, part === 'stt' ? 'stt_connect_failed' : 'avatar_connect_failed', code);
      if (!firstFailure || part === 'stt') firstFailure = Object.assign(err instanceof Error ? err : new Error(String(code || part)), { part });
    });
    if (firstFailure) throw firstFailure;
    return true;
  };

  const explainFailure = (err: any): Phase => {
    const code = aiInterviewErrorCode(err);
    if (code === 'NOT_CONFIGURED' || code === 'DISABLED') return 'unavailable';
    if (code === 'PURCHASE_REQUIRED' || code === 'NOT_STUDENT') return 'unavailable';
    if (code === 'ALREADY_COMPLETED') return 'unavailable';
    if (code === 'INTERVIEW_UNAVAILABLE') return 'unavailable';
    return 'error';
  };

  /** Full start-up (and "Try again"): server session → microphone → short-lived credentials → avatar + transcription → begin. */
  const init = async (gen: number) => {
    go('loading'); setMessage(''); setTechnical(''); setAvatarNotice(''); setSttNotice('');
    S.ended = false; S.submitting = false; S.listening = false;
    S.sttReconnecting = false; S.avatarReconnecting = false; S.avatarDown = false;
    try {
      // 1. the backend validates the purchase and creates / returns the one interview (the card's own start is reused once only:
      //    every "Try again" asks the server again, which also frees the connection slots of a not-yet-started interview)
      const routed = !S.usedRoutedStart ? (location.state as any)?.started : null;
      S.usedRoutedStart = true;
      const started = routed && routed.interview ? routed : await aiInterviewApi.start(examId);
      if (!alive(gen)) return;
      const iv = started.interview;
      if (iv.completed) { goToResult(); return; }
      S.interviewId = iv.id; S.total = iv.totalQuestions; S.silenceMs = started.config?.silenceTimeoutMs || S.silenceMs;
      setTotal(iv.totalQuestions); setRemaining(iv.remainingSeconds ?? iv.maxDurationSeconds); setClockRunning(!!iv.started);

      // 2. browser support + microphone (permission prompt)
      if (!isTranscriptionSupported()) {
        aiInterviewApi.event(S.interviewId, 'unsupported_browser');
        go('unsupported'); return;
      }
      go('connecting');
      let stream: MediaStream;
      try { stream = await requestMicrophone(); } catch (e: any) {
        if (!alive(gen)) return;
        const kind = (e?.kind as MicFailure) || 'unavailable';
        aiInterviewApi.event(S.interviewId, kind === 'denied' ? 'mic_denied' : 'mic_unavailable');
        go(kind === 'denied' ? 'mic_denied' : kind === 'unsupported' ? 'unsupported' : 'mic_unavailable'); return;
      }
      if (!alive(gen)) { stream.getTracks().forEach((t) => t.stop()); return; }
      S.stream?.getTracks().forEach((t) => t.stop());
      S.stream = stream;
      stream.getAudioTracks().forEach((t) => { t.onended = () => fns.current.onSttLost?.('mic:ended'); });

      // 3. avatar + live transcription (two independent connections)
      if (!(await connectProviders(gen, stream, ['stt', 'avatar']))) return;

      // 4. "ready": the server starts the clock and gives the greeting + question 1 (or resumes)
      const begin = await aiInterviewApi.begin(S.interviewId);
      if (!alive(gen)) return;
      S.questionId = begin.question.questionId;
      setQuestionNo(begin.question.index); setTotal(begin.interview.totalQuestions); setRemaining(begin.remainingSeconds); setClockRunning(true);
      if (begin.interview.attemptConsumed) { S.presentedSent = true; setAttemptUsed(true); }
      await deliver(gen, begin.utterance, { firstQuestion: begin.question.index === 1 });
    } catch (err: any) {
      if (!alive(gen)) return;
      const next = explainFailure(err);
      if (next === 'unavailable') { await releaseEverything(); }
      else { stt.close(); await avatar.stop(); }
      showError(err);
      go(next);
    }
  };

  /** A turn could not be transcribed (provider error). Tell the student, keep the interview moving. */
  fns.current.onTranscriptionFailed = (detail?: ProviderErrorInfo) => {
    sttLog('page: transcription failed', detail);
    if (!S.ended && !S.submitting && S.listening) {
      S.sttFailures += 1;
      // the provider's own reason (e.g. insufficient_quota), so the cause is visible without opening the console
      const why = errorCodeForServer(detail) || (detail && detail.message ? detail.message.slice(0, 100) : '');
      setSttNotice((S.sttFailures >= 2
        ? "Your voice still can't be turned into text. Please check your microphone, or tell your instructor if this keeps happening."
        : "I couldn't turn your voice into text just now. Please try again.") + (why ? ` (Reason from the speech service: ${why})` : ''));
      setLiveText(''); S.liveText = '';
      clearTurnTimers();
      const gen = S.gen;
      S.silenceTimer = setTimeout(() => fns.current.onSilence?.(gen), S.silenceMs);
    }
    if (S.sttFailReported || !S.interviewId) return;
    S.sttFailReported = true; // once per interview is enough for the server to treat it as a technical fault
    aiInterviewApi.event(S.interviewId, 'stt_error', errorCodeForServer(detail)); // the code (e.g. insufficient_quota) shows in the server log
  };

  /** Speech-to-text (or the microphone) dropped: reconnect ONLY speech-to-text. The avatar and the server state are untouched. */
  fns.current.onSttLost = async (why: string) => {
    const gen = S.gen;
    if (S.ended || S.sttReconnecting || !alive(gen)) return;
    if (S.phase === 'loading' || S.phase === 'connecting') return; // start-up handles its own failures (init's catch)
    S.sttReconnecting = true;
    const wasListening = S.listening;
    clearTurnTimers();
    setListeningState(false);
    sttLog('page: speech-to-text lost, reconnecting it alone', { why, wasListening });
    if (S.interviewId) aiInterviewApi.event(S.interviewId, why.startsWith('mic') ? 'mic_unavailable' : 'stt_disconnected', eventCode(why.replace(/^stt:/, '')));
    setSttNotice('Reconnecting the microphone…');
    let ok = false; let lastErr: any = null;
    try {
      for (let i = 1; i <= MAX_STT_RECONNECTS && alive(gen); i += 1) {
        try {
          if (!S.stream || S.stream.getAudioTracks().every((t) => t.readyState === 'ended')) {
            S.stream = await requestMicrophone();
            S.stream.getAudioTracks().forEach((t) => { t.onended = () => fns.current.onSttLost?.('mic:ended'); });
          }
          if (!(await connectProviders(gen, S.stream, ['stt']))) return;
          ok = true; break;
        } catch (err: any) {
          lastErr = err;
          if (!alive(gen)) return;
          if (err?.kind === 'denied') { go('mic_denied'); return; }
          const code = aiInterviewErrorCode(err);
          if (code === 'NOT_ACTIVE' || code === 'NOT_CONFIGURED' || code === 'CONNECTION_LIMIT') break;
          await sleep(1200 * i);
        }
      }
    } finally { S.sttReconnecting = false; }
    if (!alive(gen)) return;
    if (!ok) {
      setSttNotice('');
      if (lastErr) showError(lastErr); else { setMessage('We lost the connection to the speech service. Please try again.'); setTechnical(why); }
      clearTimers(); stt.close(); go('error');
      return;
    }
    aiInterviewApi.event(S.interviewId, 'stt_reconnected');
    setSttNotice('');
    // a turn that was being listened to starts again on the new connection; while the interviewer speaks / thinks nothing changes
    if (!S.submitting && (wasListening || S.phase === 'listening')) startListening(gen);
  };

  /** The avatar dropped (e.g. LiveAvatar's per-session time cap): reconnect ONLY the avatar; meanwhile the interview continues. */
  fns.current.onAvatarLost = async (why: string) => {
    const gen = S.gen;
    if (S.ended || S.avatarReconnecting || !alive(gen)) return;
    if (S.phase === 'loading' || S.phase === 'connecting') return; // start-up handles its own failures (init's catch)
    S.avatarReconnecting = true;
    S.avatarDown = true;
    sttLog('page: avatar lost, reconnecting it alone (speech-to-text keeps running)', { why });
    if (S.interviewId) aiInterviewApi.event(S.interviewId, 'avatar_disconnected', eventCode(why.replace(/^avatar:/, '')));
    setAvatarNotice('Reconnecting your interviewer… You can keep reading the questions below.');
    let ok = false; let lastErr: any = null;
    try {
      for (let i = 1; i <= MAX_AVATAR_RECONNECTS && alive(gen); i += 1) {
        try {
          if (!S.stream) break;
          if (!(await connectProviders(gen, S.stream, ['avatar']))) return;
          ok = true; break;
        } catch (err: any) {
          lastErr = err;
          if (!alive(gen)) return;
          const code = aiInterviewErrorCode(err);
          if (code === 'NOT_ACTIVE' || code === 'NOT_CONFIGURED' || code === 'CONNECTION_LIMIT') break;
          await sleep(1500 * i);
        }
      }
    } finally { S.avatarReconnecting = false; }
    if (!alive(gen)) return;
    if (ok) {
      S.avatarDown = false;
      setAvatarNotice('');
      aiInterviewApi.event(S.interviewId, 'avatar_reconnected');
      return;
    }
    const info = lastErr ? describeInterviewError(lastErr) : null;
    sttLog('page: avatar could not be reconnected; continuing with subtitles', { technical: info?.technical });
    setAvatarNotice("Your interviewer's video has stopped. Keep reading the questions here and answer out loud.");
  };

  // ───────────────────────── student actions ─────────────────────────
  const retry = () => {
    // a saved-but-unsent answer is re-sent; otherwise everything is reconnected from the server's state
    if (S.pendingTranscript && S.interviewId && S.stream && !S.ended) {
      const gen = S.gen; const t = S.pendingTranscript;
      void sendTurn(gen, { transcript: t });
      return;
    }
    S.gen += 1; void init(S.gen);
  };

  const skipToAnswer = () => {
    avatar.interrupt();          // stops the avatar; `deliver` then continues to the listening state
    S.readResolve?.();           // (or ends the reading pause when the avatar is not available)
  };
  const repeatQuestion = () => {
    if (S.phase !== 'listening' || S.submitting) return;
    void sendTurn(S.gen, { kind: 'repeat' });
  };
  /** "I'm done": end the answer now instead of waiting for the pause detection. */
  const doneAnswering = () => {
    if (S.phase !== 'listening' || S.submitting) return;
    const gen = S.gen;
    if (S.finalParts.length) { clearTurnTimers(); fns.current.submit?.(gen); return; }
    finishAnswerNow(gen, 'student_done');
  };

  const finish = async (reason: 'student' | 'time') => {
    if (ending) return;
    setEnding(true); setConfirmEnd(false);
    const gen = S.gen;
    sttLog('page: finishing the interview', { reason });
    stopSttClock();
    const usage = { avatarConnectedSeconds: avatar.connectedSeconds(), transcribeSeconds: Math.round(S.sttSeconds) };
    clearTimers(); setListeningState(false);
    try {
      const out = await aiInterviewApi.complete(S.interviewId, usage);
      await releaseEverything();
      if (out.result) goToResult();
      else {
        toast('The interview could not start, so nothing was used up. You can start it again.');
        navigate('/student/exams', { replace: true });
      }
    } catch (err: any) {
      if (S.gen === gen) { setEnding(false); toast.error(aiInterviewErrorMessage(err, 'Could not end the interview. Please try again.')); }
    }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // ───────────────────────── lifecycle ─────────────────────────
  useEffect(() => {
    S.gen += 1;
    const gen = S.gen;
    S.ended = false;
    // deferred one tick so React StrictMode's dev-only mount/unmount/mount does not start two sessions
    const t = setTimeout(() => { void init(gen); }, 0);
    return () => {
      clearTimeout(t);
      S.gen += 1;
      void releaseEverything();
    };
  }, [examId]);

  // server-aware countdown (re-synced from every server reply)
  useEffect(() => {
    if (remaining == null || !clockRunning || phase === 'completed' || phase === 'unavailable' || phase === 'loading') return undefined;
    const id = setInterval(() => setRemaining((r) => (r == null ? r : Math.max(0, r - 1))), 1000);
    return () => clearInterval(id);
  }, [remaining == null, phase, clockRunning]);
  useEffect(() => {
    if (remaining === 0 && S.interviewId && !S.ended && ['speaking', 'listening', 'thinking', 'next'].includes(phase)) void finishRef.current('time');
  }, [remaining, phase]);

  // internet dropped / returned
  useEffect(() => {
    const onOnline = () => { if (phase === 'error' && !S.submitting) retry(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  });

  // development diagnostics: what the speech-to-text connection is really doing (never shown in a production build)
  useEffect(() => {
    if (!showDiagnostics) return undefined;
    let stop = false;
    const tick = async () => {
      const snap = S.sttProvider === 'local' ? null : await sttOpenAI.snapshot();
      if (stop) return;
      setDiag({ ...(snap || {}), sttProvider: S.sttProvider || '?', avatar: avatar.state, listening: S.listening });
    };
    const id = setInterval(() => { void tick(); }, 1000);
    return () => { stop = true; clearInterval(id); };
  }, [showDiagnostics, avatar.state]);

  // ───────────────────────── render ─────────────────────────
  const blockedPhase = phase === 'mic_denied' || phase === 'mic_unavailable' || phase === 'unsupported' || phase === 'unavailable' || phase === 'error';
  const label = PHASE_LABEL[phase];
  const shown = words.slice(0, Math.min(words.length, revealed)).join(' ');
  const progressPct = phase === 'completed' ? 100 : total ? Math.min(100, Math.round((Math.max(0, questionNo - 1) / total) * 100)) : 0;
  const showVideo = !blockedPhase;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#0F1020] text-[#F4F4FA]" data-testid="ai-interview-page">
      {/* top bar */}
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 border-b border-white/10">
        <div className="min-w-0">
          <p className="font-heading text-sm sm:text-base font-bold truncate flex items-center gap-2"><Bot className="w-4 h-4 text-[#B69CF2]" aria-hidden="true" /> AI Interview</p>
          <p className="text-[11px] text-[#A6A8C4]" data-testid="question-counter">
            {questionNo > 0 ? `Question ${questionNo} / ${total}` : 'Getting ready'}
            {remaining != null && phase !== 'loading' && <span className="ml-2 tabular-nums" aria-label={`Time left ${mmss(remaining)}`}>· {mmss(remaining)} left</span>}
          </p>
        </div>
        <button
          type="button" onClick={() => setConfirmEnd(true)} disabled={ending || !S.interviewId || phase === 'loading' || phase === 'unavailable' || phase === 'unsupported'}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/20 px-3 sm:px-4 text-xs font-bold text-[#F4F4FA] hover:bg-white/10 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B69CF2]"
        >
          <PhoneOff className="w-4 h-4" aria-hidden="true" /> End Interview
        </button>
      </header>
      <div className="h-1.5 w-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct} aria-label="Interview progress">
        <div className="h-full bg-gradient-to-r from-[#6C63F2] via-[#B69CF2] to-[#FF8FA3] transition-all duration-500" style={{ width: `${progressPct}%` }} />
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-4 sm:py-6">
        {/* avatar */}
        {showVideo && (
          <section aria-label="AI interviewer" className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#1B1C2E] to-[#242540] shadow-2xl aspect-[4/3] sm:aspect-video">
            <video ref={avatar.videoRef} autoPlay playsInline className="h-full w-full object-cover" aria-label="AI interviewer video" data-testid="avatar-video" />
            {(phase === 'loading' || phase === 'connecting') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#1B1C2E]/90" role="status">
                <Loader2 className="h-9 w-9 animate-spin text-[#B69CF2] motion-reduce:animate-none" aria-hidden="true" />
                <p className="text-sm font-semibold">{label}</p>
                <p className="flex items-center gap-1.5 px-6 text-center text-[11px] text-[#A6A8C4]"><ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" /> Your microphone is used to hear your answers during the interview.</p>
              </div>
            )}
            {avatarNotice && phase !== 'loading' && phase !== 'connecting' && (
              <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-[#1B1C2E]/85 px-4 py-2 text-center text-xs font-semibold text-[#FFC24B]" role="status" data-testid="avatar-notice">
                {S.avatarReconnecting && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{avatarNotice}
              </div>
            )}
            {avatar.audioBlocked && phase !== 'loading' && phase !== 'connecting' && (
              <button type="button" onClick={avatar.resumeAudio} className="absolute inset-x-6 bottom-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#6C63F2] px-4 text-sm font-bold text-white shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
                <Volume2 className="h-4 w-4" aria-hidden="true" /> Tap to hear your interviewer
              </button>
            )}
          </section>
        )}

        {/* status pill */}
        {showVideo && phase !== 'loading' && phase !== 'connecting' && label && (
          <div className="flex items-center justify-center" role="status" aria-live="polite" data-testid="phase-label">
            <span className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold ${phase === 'listening' ? 'bg-[#4ADE9A]/15 text-[#4ADE9A]' : phase === 'completed' ? 'bg-[#4ADE9A]/15 text-[#4ADE9A]' : 'bg-[#6C63F2]/20 text-[#C4ADFF]'}`}>
              {phase === 'listening' ? (
                <span className="flex items-end gap-0.5 h-3.5" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} className="w-0.5 rounded bg-[#4ADE9A] animate-pulse motion-reduce:animate-none" style={{ height: `${6 + ((i * 5) % 9)}px`, animationDelay: `${i * 120}ms` }} />)}</span>
              ) : phase === 'completed' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                : phase === 'thinking' || phase === 'next' ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  : <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />}
              {label}
            </span>
          </div>
        )}

        {/* subtitles */}
        {showVideo && phase !== 'loading' && phase !== 'connecting' && (
          <>
            <section aria-label="Interviewer subtitles" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 min-h-[76px]" data-testid="ai-subtitle">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#B69CF2]">Interviewer</p>
              <p className="text-base leading-relaxed" aria-live="polite">{shown || ' '}</p>
            </section>
            <section aria-label="Your answer" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 min-h-[76px]" data-testid="student-subtitle">
              <p className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#5AC8FA]">
                You
                {liveText && <span className="rounded bg-[#FFC24B]/20 px-1.5 py-0.5 text-[9px] text-[#FFC24B]" data-testid="live-badge">LIVE</span>}
                {!liveText && finalText && <span className="rounded bg-[#4ADE9A]/20 px-1.5 py-0.5 text-[9px] text-[#4ADE9A]" data-testid="final-badge">FINAL</span>}
              </p>
              <p className="text-base leading-relaxed" data-testid="student-text">
                {finalText && <span>{finalText} </span>}
                {liveText && <span className="italic text-[#C4C6DE]">{liveText}</span>}
                {!finalText && !liveText && <span className="text-[#787A9A]">{phase === 'listening' ? 'Speak your answer…' : ' '}</span>}
              </p>
              {sttNotice && <p role="status" className="mt-1 text-xs font-semibold text-[#FFC24B]" data-testid="stt-notice">{sttNotice}</p>}
            </section>
          </>
        )}

        {/* controls */}
        {showVideo && (phase === 'speaking' || phase === 'listening') && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {phase === 'speaking' && (
              <button type="button" onClick={skipToAnswer} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 px-4 text-xs font-bold hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B69CF2]">
                <SkipForward className="h-4 w-4" aria-hidden="true" /> I&apos;m ready to answer
              </button>
            )}
            {phase === 'listening' && (
              <>
                <button type="button" onClick={doneAnswering} data-testid="done-answering" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#6C63F2] px-4 text-xs font-bold text-white hover:bg-[#5A52E0] focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
                  <CircleStop className="h-4 w-4" aria-hidden="true" /> I&apos;m done answering
                </button>
                <button type="button" onClick={repeatQuestion} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 px-4 text-xs font-bold hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B69CF2]">
                  <Repeat className="h-4 w-4" aria-hidden="true" /> Repeat the question
                </button>
              </>
            )}
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[#A6A8C4]">{micOn ? <Mic className="h-3.5 w-3.5 text-[#4ADE9A]" aria-hidden="true" /> : <MicOff className="h-3.5 w-3.5" aria-hidden="true" />} {micOn ? 'Microphone on' : 'Microphone paused while I speak'}</span>
          </div>
        )}

        {/* blocking states */}
        {phase === 'mic_denied' && (
          <StateCard icon={<MicOff className="h-10 w-10 text-[#FF8FA3]" />} title="Microphone access is required for the AI Interview." testId="state-mic-denied"
            body="Allow the microphone for this site in your browser (the lock icon next to the address), then try again. Your microphone is used to hear your answers during the interview."
            primary={{ label: 'Try again', onClick: retry }} secondary={{ label: 'Back to Exams', to: '/student/exams' }} />
        )}
        {phase === 'mic_unavailable' && (
          <StateCard icon={<MicOff className="h-10 w-10 text-[#FF8FA3]" />} title="We could not find a working microphone." testId="state-mic-unavailable"
            body="Plug in or turn on a microphone, close other apps that may be using it, and try again."
            primary={{ label: 'Try again', onClick: retry }} secondary={{ label: 'Back to Exams', to: '/student/exams' }} />
        )}
        {phase === 'unsupported' && (
          <StateCard icon={<AlertTriangle className="h-10 w-10 text-[#FFC24B]" />} title="This browser cannot run the AI Interview." testId="state-unsupported"
            body="Please open LearnIQ in the latest version of Chrome, Edge or Safari on a device with a microphone."
            secondary={{ label: 'Back to Exams', to: '/student/exams' }} />
        )}
        {phase === 'unavailable' && (
          <StateCard icon={<Bot className="h-10 w-10 text-[#B69CF2]" />} title="AI Interview unavailable" testId="state-unavailable" body={message}
            detail={showDiagnostics ? technical : ''}
            secondary={{ label: 'Back to Exams', to: '/student/exams' }} />
        )}
        {phase === 'error' && (
          <StateCard icon={<WifiOff className="h-10 w-10 text-[#FF8FA3]" />} title="Something went wrong. Please try again." testId="state-error" body={message && message !== 'Something went wrong. Please try again.' ? message : 'Your progress is saved on our server.'}
            detail={showDiagnostics ? technical : ''}
            primary={{ label: 'Try again', onClick: retry, icon: <RefreshCw className="h-4 w-4" /> }} secondary={{ label: 'Back to Exams', to: '/student/exams' }} />
        )}

        {/* development-only: the live state of speech-to-text, so a problem is visible without opening the console */}
        {showDiagnostics && diag && (
          <section aria-label="Diagnostics (development only)" data-testid="stt-diagnostics" className="rounded-xl border border-dashed border-white/15 px-3 py-2 font-mono text-[10px] leading-relaxed text-[#8E90AE]">
            <p>DEV · stt={diag.sttProvider} peer={diag.peer ?? '-'} ice={diag.ice ?? '-'} dc={diag.dataChannel ?? '-'} · avatar={diag.avatar} · listening={String(diag.listening)}</p>
            <p>mic enabled={String(diag.trackEnabled ?? '-')} state={diag.trackState ?? '-'} sender=mic:{String(diag.senderIsMic ?? '-')} · packets={diag.packetsSent ?? '-'} bytes={diag.bytesSent ?? '-'} level={diag.micLevel ?? '-'}</p>
            <p>events={diag.events ?? 0} last={diag.lastEvent ?? '-'}{diag.lastError ? ` · lastError=${diag.lastError}` : ''}</p>
            {diag.session && <p>session: {diag.session}</p>}
          </section>
        )}
      </main>

      <ConfirmDialog
        open={confirmEnd} busy={ending} tone="danger"
        title="End the interview?"
        message={attemptUsed || questionNo > 1
          ? 'Your answers so far will be scored. You get only one AI Interview per exam, so you will not be able to take it again.'
          : 'The interviewer has not asked the first question yet, so nothing will be used up and you can start again later.'}
        note={attemptUsed || questionNo > 1 ? 'Once the first question has been asked, it counts as your attempt.' : undefined}
        confirmLabel="End Interview"
        onCancel={() => setConfirmEnd(false)} onConfirm={() => void finish('student')}
      />
    </div>
  );
};

const StateCard: React.FC<{
  icon: React.ReactNode; title: string; body: string; testId: string; detail?: string;
  primary?: { label: string; onClick: () => void; icon?: React.ReactNode };
  secondary?: { label: string; to: string };
}> = ({ icon, title, body, testId, detail, primary, secondary }) => (
  <section role="alert" data-testid={testId} className="mx-auto mt-6 w-full max-w-md rounded-3xl border border-white/10 bg-[#1B1C2E] p-6 text-center shadow-2xl">
    <div className="mb-3 flex justify-center" aria-hidden="true">{icon}</div>
    <h1 className="font-heading text-lg font-bold text-[#F4F4FA]">{title}</h1>
    <p className="mt-2 text-sm leading-relaxed text-[#A6A8C4]">{body}</p>
    {detail && <p className="mt-2 break-words font-mono text-[11px] text-[#FFC24B]" data-testid="error-technical">Technical detail (development only): {detail}</p>}
    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
      {primary && (
        <button type="button" onClick={primary.onClick} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#6C63F2] px-5 text-sm font-bold text-white hover:bg-[#5A52E0] focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
          {primary.icon}{primary.label}
        </button>
      )}
      {secondary && (
        <Link to={secondary.to} replace className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/20 px-5 text-sm font-bold text-[#F4F4FA] hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B69CF2]">{secondary.label}</Link>
      )}
    </div>
  </section>
);

export default AIInterviewPage;
