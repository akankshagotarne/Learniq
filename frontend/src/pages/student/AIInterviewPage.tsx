import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Bot, CheckCircle2, Loader2, Mic, MicOff, PhoneOff, RefreshCw, Repeat, ShieldCheck, SkipForward, Volume2, WifiOff,
} from 'lucide-react';
import { ConfirmDialog } from '../../components/admin/ProfileParts';
import { aiInterviewApi, aiInterviewErrorCode, aiInterviewErrorMessage, aiInterviewStatusCode } from '../../services/aiInterview';
import { useLiveAvatar } from '../../hooks/useLiveAvatar';
import { isTranscriptionSupported, requestMicrophone, useOpenAITranscription, MicFailure } from '../../hooks/useOpenAITranscription';
import { useLocalTranscription } from '../../hooks/useLocalTranscription';
import { errorCodeForServer, sttLog, type ProviderErrorInfo } from '../../hooks/sttDiagnostics';
import { AIInterviewTurn, AIInterviewSttSession } from '../../types/aiInterview';

/**
 * The immersive AI Interview screen (the ONLY AI Interview page; opened from the exam card).
 *
 * Everything that matters is decided by the backend: who may take it, the question list, the clock, the scores and the
 * state. This page only (1) connects the microphone + live transcription + avatar, (2) shows what the server tells it
 * to say, and (3) sends the student's FINAL spoken answer back.
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

const WORDS_PER_SECOND = 2.6; // subtitle reveal pace while the avatar speaks (snaps to "all" the moment it stops)
const ANSWER_SETTLE_MS = 900;  // wait this long after a finished sentence for the student to continue
const MAX_RECONNECTS = 2;
const STT_GRACE_MS = 10000; // how long to wait for a transcript after the student stopped speaking (a cough / noise is not a word)

const mmss = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

const AIInterviewPage: React.FC = () => {
  const { examId = '' } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [questionNo, setQuestionNo] = useState(0);
  const [total, setTotal] = useState(8);
  const [aiText, setAiText] = useState('');
  const [revealed, setRevealed] = useState(0);
  const [finalText, setFinalText] = useState('');
  const [liveText, setLiveText] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [attemptUsed, setAttemptUsed] = useState(false); // the first question was presented: this is now the student's one attempt
  const [ending, setEnding] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [sttNotice, setSttNotice] = useState(''); // shown in the YOU box when speech could not be turned into text

  // mutable interview state (never read during render)
  const S = useRef({
    gen: 0, ended: false, interviewId: '', questionId: '', total: 8, silenceMs: 15000,
    finalParts: [] as string[], pendingTranscript: null as string | null, submitting: false,
    silenceTimer: 0 as any, settleTimer: 0 as any, revealTimer: 0 as any, speakStartedAt: 0,
    reconnects: 0, reconnecting: false, sttFailReported: false, sttFailures: 0, presentedSent: false, stream: null as MediaStream | null, sttSeconds: 0, sttSince: 0,
  }).current;

  const fns = useRef<any>({});
  const micOnRef = useRef(false);
  micOnRef.current = micOn;

  const avatar = useLiveAvatar({
    onSpeakStart: () => fns.current.onAvatarSpeakStart?.(),
    onDisconnected: (reason) => fns.current.onConnectionProblem?.(`avatar:${reason}`),
  });
  const sttHandlers = {
    onSpeechStart: () => fns.current.onSpeechStart?.(),
    onSpeechStop: () => fns.current.onSpeechStop?.(),
    onPartial: (t: string) => fns.current.onPartial?.(t),
    onFinal: (t: string) => fns.current.onFinal?.(t),
    onConnectionLost: (why: string) => fns.current.onConnectionProblem?.(`stt:${why}`),
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
    close: () => { sttOpenAI.close(); sttLocal.close(); },
  };

  const words = useMemo(() => aiText.split(/\s+/).filter(Boolean), [aiText]);

  // ───────────────────────── helpers ─────────────────────────
  const clearTimers = () => {
    clearTimeout(S.silenceTimer); clearTimeout(S.settleTimer); clearInterval(S.revealTimer);
    S.silenceTimer = 0; S.settleTimer = 0; S.revealTimer = 0;
  };
  const alive = (gen: number) => !S.ended && gen === S.gen;

  const stopSttClock = () => {
    if (S.sttSince) { S.sttSeconds += (Date.now() - S.sttSince) / 1000; S.sttSince = 0; }
  };

  const releaseEverything = useCallback(async () => {
    S.ended = true;
    clearTimers();
    stt.close();
    stopSttClock();
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

  // ───────────────────────── the conversation loop ─────────────────────────
  fns.current.onAvatarSpeakStart = () => { if (!S.ended) startReveal(); };

  /** The interviewer says `text`; afterwards the student's turn begins (unless the interview is over). */
  const deliver = async (gen: number, text: string, opts: { thenListen?: boolean; firstQuestion?: boolean } = {}) => {
    const thenListen = opts.thenListen !== false;
    clearTimeout(S.silenceTimer); clearTimeout(S.settleTimer);
    stt.setListening(false);
    setMicOn(false);
    setLiveText(''); setFinalText(''); S.finalParts = [];
    setAiText(text); setRevealed(0);
    setPhase('speaking');
    try {
      // if the avatar never reports "started", the subtitles still move (fallback reveal)
      const fallback = setTimeout(() => { if (alive(gen) && !S.revealTimer) startReveal(); }, 1800);
      await avatar.speak(text);
      clearTimeout(fallback);
    } catch {
      if (!alive(gen)) return;
      finishReveal();
      await fns.current.onConnectionProblem?.('avatar:speak_failed');
      return;
    }
    if (!alive(gen)) return;
    finishReveal();
    // the FIRST question has now been spoken to the student: tell the server, which consumes the purchase's single attempt.
    // (Not while a reconnect is in progress: a dropped avatar never counts as "presented".)
    if (opts.firstQuestion && !S.presentedSent && !S.reconnecting && !S.ended) void confirmPresented(gen);
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
    S.finalParts = []; S.pendingTranscript = null;
    setLiveText(''); setFinalText(''); setSttNotice('');
    stt.setListening(true);
    setMicOn(true);
    S.sttSince = S.sttSince || Date.now();
    setPhase('listening');
    clearTimeout(S.silenceTimer);
    S.silenceTimer = setTimeout(() => fns.current.onSilence?.(gen), S.silenceMs);
  };

  fns.current.onSpeechStart = () => {
    sttLog('page: speech started', { listening: micOnRef.current });
    setSttNotice('');
    clearTimeout(S.silenceTimer); clearTimeout(S.settleTimer); // the student is talking: no silence prompt, no early submit
  };
  // The student stopped speaking but no transcript has arrived (a cough that was not a word, an empty transcript, a slow or failed
  // transcription). Without this the silence prompt, which stops while the student is speaking, would never come back and the
  // interview would sit on "I'm listening..." for ever. A transcript that does arrive within the grace period cancels it (onFinal).
  fns.current.onSpeechStop = () => {
    sttLog('page: speech stopped', { listening: micOnRef.current, haveFinal: S.finalParts.length > 0 });
    if (S.ended || S.submitting || !micOnRef.current || S.finalParts.length) return;
    clearTimeout(S.silenceTimer);
    const gen = S.gen;
    S.silenceTimer = setTimeout(() => fns.current.onSilence?.(gen), STT_GRACE_MS);
  };
  fns.current.onPartial = (t: string) => {
    if (S.ended || S.submitting) return;
    S.sttFailures = 0;
    setSttNotice('');
    setLiveText(t); // LIVE text (italic, "live" badge) — not saved
  };
  fns.current.onFinal = (t: string) => {
    sttLog('page: final transcript', { listening: micOnRef.current, submitting: S.submitting, ended: S.ended, chars: t.length });
    if (S.ended || S.submitting || !micOnRef.current) return;
    S.sttFailures = 0;
    setSttNotice('');
    S.finalParts.push(t);
    setFinalText(S.finalParts.join(' '));   // FINAL text
    setLiveText('');
    clearTimeout(S.silenceTimer); clearTimeout(S.settleTimer);
    const gen = S.gen;
    S.settleTimer = setTimeout(() => fns.current.submit?.(gen), ANSWER_SETTLE_MS);
  };
  fns.current.onSilence = (gen: number) => {
    if (!alive(gen) || S.submitting) return;
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
    sttLog('page: sending turn to the backend', { kind: turn.kind || 'answer', chars: (turn.transcript || '').length });
    stt.setListening(false); setMicOn(false); setSttNotice('');
    clearTimeout(S.silenceTimer); clearTimeout(S.settleTimer);
    setPhase('thinking');
    S.pendingTranscript = turn.transcript ?? null;
    let reply: AIInterviewTurn;
    try {
      reply = await aiInterviewApi.answer(S.interviewId, { questionId: S.questionId, transcript: turn.transcript, kind: turn.kind });
    } catch (err: any) {
      if (!alive(gen)) { S.submitting = false; return; }
      const code = aiInterviewErrorCode(err);
      const status = aiInterviewStatusCode(err);
      if (code === 'BUSY' && attempt < 3) { await new Promise((r) => setTimeout(r, 900)); return sendTurn(gen, turn, attempt + 1); }
      if (code === 'STALE_QUESTION') { S.submitting = false; return fns.current.resync?.(gen); }
      if (status === 404 || status === 403) { S.submitting = false; return fns.current.blocked?.(aiInterviewErrorMessage(err)); }
      if (attempt < 1) { await new Promise((r) => setTimeout(r, 1500)); return sendTurn(gen, turn, attempt + 1); } // one quiet automatic retry
      S.submitting = false;
      setMessage('Something went wrong. Please try again.');
      setPhase('error'); // the student's answer is kept; "Try again" sends it again
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
      setPhase('completed');
      const hadResult = !!reply.result;
      const line = reply.closing || '';
      setAiText(line); setRevealed(0);
      if (line) {
        try { startReveal(); await avatar.speak(line); } catch { /* the result page shows the same feedback */ }
        finishReveal();
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
    if (isNewQuestion) setPhase('next'); // "Here's your next question…" (not for a repeat or a silence prompt)
    await deliver(gen, reply.utterance || '');
  };

  /** The server and this screen disagree about the current question (e.g. a late duplicate): ask the server, continue from its state. */
  fns.current.resync = async (gen: number) => {
    try {
      const { interview } = await aiInterviewApi.get(S.interviewId);
      if (!alive(gen)) return;
      if (interview.completed) { await releaseEverything(); goToResult(); return; }
      if (interview.currentQuestion) {
        S.questionId = interview.currentQuestion.questionId;
        setQuestionNo(interview.currentQuestion.index);
        if (interview.remainingSeconds != null) setRemaining(interview.remainingSeconds);
        if (interview.attemptConsumed) { S.presentedSent = true; setAttemptUsed(true); }
        await deliver(gen, `Let me ask that again. ${interview.currentQuestion.question}`, { firstQuestion: interview.currentQuestion.index === 1 });
      }
    } catch (err: any) {
      setMessage(aiInterviewErrorMessage(err)); setPhase('error');
    }
  };

  fns.current.blocked = async (msg: string) => {
    await releaseEverything();
    setMessage(msg || 'The AI Interview is not available right now.');
    setPhase('unavailable');
  };

  // ───────────────────────── connection / start-up ─────────────────────────
  const connectProviders = async (gen: number, stream: MediaStream) => {
    const rt = await aiInterviewApi.realtimeSession(S.interviewId);
    if (!alive(gen)) return false;
    S.silenceMs = rt.config?.silenceTimeoutMs || S.silenceMs;
    await Promise.all([avatar.connect(rt.avatar.sessionToken), stt.connect(stream, rt.stt)]);
    if (!alive(gen)) return false;
    aiInterviewApi.event(S.interviewId, 'avatar_connected');
    aiInterviewApi.event(S.interviewId, 'stt_connected');
    return true;
  };

  const explainFailure = (err: any): { phase: Phase; text: string } => {
    const code = aiInterviewErrorCode(err);
    if (code === 'NOT_CONFIGURED' || code === 'DISABLED') return { phase: 'unavailable', text: 'The AI Interview is not available right now. Please try again later.' };
    if (code === 'PURCHASE_REQUIRED' || code === 'NOT_STUDENT') return { phase: 'unavailable', text: aiInterviewErrorMessage(err) };
    if (code === 'ALREADY_COMPLETED') return { phase: 'unavailable', text: 'Your AI Interview for this exam has already been completed.' };
    if (code === 'INTERVIEW_UNAVAILABLE') return { phase: 'unavailable', text: aiInterviewErrorMessage(err) };
    if (code === 'CONNECTION_LIMIT') return { phase: 'error', text: 'Too many connection attempts. Please wait a minute and try again.' };
    return { phase: 'error', text: aiInterviewErrorMessage(err, 'Something went wrong. Please try again.') };
  };

  /** Full start-up (and "Try again"): server session → microphone → short-lived credentials → avatar + transcription → begin. */
  const init = async (gen: number) => {
    setPhase('loading'); setMessage('');
    S.ended = false; S.submitting = false; S.reconnects = 0; S.reconnecting = false;
    try {
      // 1. the backend validates the purchase and creates / returns the one interview
      const routed = (location.state as any)?.started;
      const started = routed && routed.interview ? routed : await aiInterviewApi.start(examId);
      if (!alive(gen)) return;
      const iv = started.interview;
      if (iv.completed) { goToResult(); return; }
      S.interviewId = iv.id; S.total = iv.totalQuestions; S.silenceMs = started.config?.silenceTimeoutMs || S.silenceMs;
      setTotal(iv.totalQuestions); setRemaining(iv.remainingSeconds ?? iv.maxDurationSeconds);

      // 2. browser support + microphone (permission prompt)
      if (!isTranscriptionSupported()) {
        aiInterviewApi.event(S.interviewId, 'unsupported_browser');
        setPhase('unsupported'); return;
      }
      setPhase('connecting');
      let stream: MediaStream;
      try { stream = await requestMicrophone(); } catch (e: any) {
        if (!alive(gen)) return;
        const kind = (e?.kind as MicFailure) || 'unavailable';
        aiInterviewApi.event(S.interviewId, kind === 'denied' ? 'mic_denied' : 'mic_unavailable');
        setPhase(kind === 'denied' ? 'mic_denied' : kind === 'unsupported' ? 'unsupported' : 'mic_unavailable'); return;
      }
      if (!alive(gen)) { stream.getTracks().forEach((t) => t.stop()); return; }
      S.stream?.getTracks().forEach((t) => t.stop());
      S.stream = stream;
      stream.getAudioTracks().forEach((t) => { t.onended = () => fns.current.onConnectionProblem?.('mic:ended'); });

      // 3. avatar + live transcription
      if (!(await connectProviders(gen, stream))) return;

      // 4. "ready": the server starts the clock and gives the greeting + question 1 (or resumes)
      const begin = await aiInterviewApi.begin(S.interviewId);
      if (!alive(gen)) return;
      S.questionId = begin.question.questionId;
      setQuestionNo(begin.question.index); setTotal(begin.interview.totalQuestions); setRemaining(begin.remainingSeconds);
      if (begin.interview.attemptConsumed) { S.presentedSent = true; setAttemptUsed(true); }
      await deliver(gen, begin.utterance, { firstQuestion: begin.question.index === 1 });
    } catch (err: any) {
      if (!alive(gen)) return;
      const f = explainFailure(err);
      if (f.phase === 'unavailable') { await releaseEverything(); }
      else { stt.close(); await avatar.stop(); }
      if (aiInterviewErrorCode(err) == null && S.interviewId) aiInterviewApi.event(S.interviewId, 'stt_error');
      setMessage(f.text); setPhase(f.phase);
    }
  };

  /** avatar / transcription / microphone dropped: reconnect a limited number of times, then let the student retry. */
  fns.current.onTranscriptionFailed = (detail?: ProviderErrorInfo) => {
    sttLog('page: transcription failed', detail);
    if (!S.ended && !S.submitting && micOnRef.current) {
      // Tell the student (they would otherwise stare at an empty box) and keep the interview moving: the silence prompt comes back.
      S.sttFailures += 1;
      // the provider's own reason (e.g. insufficient_quota), so the cause is visible without opening the console
      const why = errorCodeForServer(detail) || (detail && detail.message ? detail.message.slice(0, 100) : '');
      setSttNotice((S.sttFailures >= 2
        ? "Your voice still can't be turned into text. Please check your internet connection and microphone, or tell your instructor if this keeps happening."
        : "I couldn't turn your voice into text just now. Please try again.") + (why ? ` (Reason from the speech service: ${why})` : ''));
      setLiveText('');
      clearTimeout(S.silenceTimer);
      const gen = S.gen;
      S.silenceTimer = setTimeout(() => fns.current.onSilence?.(gen), S.silenceMs);
    }
    if (S.sttFailReported || !S.interviewId) return;
    S.sttFailReported = true; // once per interview is enough for the server to treat it as a technical fault
    aiInterviewApi.event(S.interviewId, 'stt_error', errorCodeForServer(detail)); // the code (e.g. insufficient_quota) shows in the server log
  };
  fns.current.onConnectionProblem = async (why: string) => {
    const gen = S.gen;
    if (S.ended || S.reconnecting || S.submitting || !alive(gen)) return;
    S.reconnecting = true;
    clearTimers(); stt.setListening(false); setMicOn(false);
    if (S.interviewId) aiInterviewApi.event(S.interviewId, why.startsWith('mic') ? 'mic_unavailable' : why.startsWith('avatar') ? 'avatar_disconnected' : 'stt_error');
    try {
      while (S.reconnects < MAX_RECONNECTS && alive(gen)) {
        S.reconnects += 1;
        setPhase('connecting');
        aiInterviewApi.event(S.interviewId, 'reconnect_attempt');
        try {
          if (!S.stream || S.stream.getAudioTracks().every((t) => t.readyState === 'ended')) {
            S.stream = await requestMicrophone();
            S.stream.getAudioTracks().forEach((t) => { t.onended = () => fns.current.onConnectionProblem?.('mic:ended'); });
          }
          if (!(await connectProviders(gen, S.stream))) return;
          const begin = await aiInterviewApi.begin(S.interviewId); // resume: same question, the clock keeps running
          if (!alive(gen)) return;
          S.questionId = begin.question.questionId;
          setQuestionNo(begin.question.index); setRemaining(begin.remainingSeconds);
          if (begin.interview.attemptConsumed) { S.presentedSent = true; setAttemptUsed(true); }
          S.reconnecting = false;
          await deliver(gen, begin.utterance, { firstQuestion: begin.question.index === 1 });
          return;
        } catch (err: any) {
          if (!alive(gen)) return;
          const code = aiInterviewErrorCode(err);
          if (code === 'NOT_ACTIVE' || code === 'NOT_CONFIGURED' || code === 'CONNECTION_LIMIT') break;
          if (err?.kind === 'denied') { setPhase('mic_denied'); return; }
          await new Promise((r) => setTimeout(r, 1200 * S.reconnects));
        }
      }
      if (!alive(gen)) return;
      setMessage('Connection lost. Please check your internet and try again.');
      setPhase('error');
    } finally {
      S.reconnecting = false;
    }
  };

  // ───────────────────────── student actions ─────────────────────────
  const retry = () => {
    // a saved-but-unsent answer is re-sent; otherwise everything is reconnected from the server's state
    if (S.pendingTranscript && S.interviewId && S.stream) {
      const gen = S.gen; const t = S.pendingTranscript;
      void sendTurn(gen, { transcript: t });
      return;
    }
    S.gen += 1; void init(S.gen);
  };

  const skipToAnswer = () => {
    avatar.interrupt();          // stops the avatar; `deliver` then continues to the listening state
  };
  const repeatQuestion = () => {
    if (phase !== 'listening' || S.submitting) return;
    void sendTurn(S.gen, { kind: 'repeat' });
  };

  const finish = async (reason: 'student' | 'time') => {
    if (ending) return;
    setEnding(true); setConfirmEnd(false);
    const gen = S.gen;
    stopSttClock();
    const usage = { avatarConnectedSeconds: avatar.connectedSeconds(), transcribeSeconds: Math.round(S.sttSeconds) };
    clearTimers(); stt.setListening(false); setMicOn(false);
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
    if (remaining == null || phase === 'completed' || phase === 'unavailable' || phase === 'loading') return undefined;
    const id = setInterval(() => setRemaining((r) => (r == null ? r : Math.max(0, r - 1))), 1000);
    return () => clearInterval(id);
  }, [remaining == null, phase]);
  useEffect(() => {
    if (remaining === 0 && S.interviewId && !S.ended && ['speaking', 'listening', 'thinking', 'next'].includes(phase)) void finishRef.current('time');
  }, [remaining, phase]);

  // internet dropped / returned
  useEffect(() => {
    const onOnline = () => { if (phase === 'error' && !S.submitting) retry(); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  });

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
              <p className="text-base leading-relaxed" aria-live="polite">{shown || ' '}</p>
            </section>
            <section aria-label="Your answer" className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 min-h-[76px]" data-testid="student-subtitle">
              <p className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#5AC8FA]">
                You
                {liveText && <span className="rounded bg-[#FFC24B]/20 px-1.5 py-0.5 text-[9px] text-[#FFC24B]" data-testid="live-badge">LIVE</span>}
                {!liveText && finalText && <span className="rounded bg-[#4ADE9A]/20 px-1.5 py-0.5 text-[9px] text-[#4ADE9A]" data-testid="final-badge">FINAL</span>}
              </p>
              <p className="text-base leading-relaxed">
                {finalText && <span>{finalText} </span>}
                {liveText && <span className="italic text-[#C4C6DE]">{liveText}</span>}
                {!finalText && !liveText && <span className="text-[#787A9A]">{phase === 'listening' ? 'Speak your answer…' : ' '}</span>}
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
              <button type="button" onClick={repeatQuestion} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 px-4 text-xs font-bold hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B69CF2]">
                <Repeat className="h-4 w-4" aria-hidden="true" /> Repeat the question
              </button>
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
            secondary={{ label: 'Back to Exams', to: '/student/exams' }} />
        )}
        {phase === 'error' && (
          <StateCard icon={<WifiOff className="h-10 w-10 text-[#FF8FA3]" />} title="Something went wrong. Please try again." testId="state-error" body={message && message !== 'Something went wrong. Please try again.' ? message : 'Your progress is saved on our server.'}
            primary={{ label: 'Try again', onClick: retry, icon: <RefreshCw className="h-4 w-4" /> }} secondary={{ label: 'Back to Exams', to: '/student/exams' }} />
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
  icon: React.ReactNode; title: string; body: string; testId: string;
  primary?: { label: string; onClick: () => void; icon?: React.ReactNode };
  secondary?: { label: string; to: string };
}> = ({ icon, title, body, testId, primary, secondary }) => (
  <section role="alert" data-testid={testId} className="mx-auto mt-6 w-full max-w-md rounded-3xl border border-white/10 bg-[#1B1C2E] p-6 text-center shadow-2xl">
    <div className="mb-3 flex justify-center" aria-hidden="true">{icon}</div>
    <h1 className="font-heading text-lg font-bold text-[#F4F4FA]">{title}</h1>
    <p className="mt-2 text-sm leading-relaxed text-[#A6A8C4]">{body}</p>
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
