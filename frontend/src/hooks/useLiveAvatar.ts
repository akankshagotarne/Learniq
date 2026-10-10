import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentEventsEnum, LiveAvatarSession, SessionDisconnectReason, SessionEvent, SessionState } from '@heygen/liveavatar-web-sdk';

/**
 * HeyGen LiveAvatar (the current successor of the retired Interactive Avatar API) behind a small interface.
 * The page only calls connect / speak / interrupt / stop, so another avatar provider can replace this file later.
 *
 *  - The session token is minted by OUR backend (the HeyGen API key never reaches the browser).
 *  - The avatar is only a face + voice for text OUR interviewer (OpenAI, on our server) decided to say: we only ever call `repeat()`
 *    (= the LLM-free `avatar.speak_text`), never `message()` (which would make LiveAvatar's own LLM answer).
 *  - Microphone: the SDK's default is a LIVE voice chat (it opens the microphone and publishes it to the LiveAvatar room). We do not want
 *    that, so the session is created with `voiceChat: { defaultMuted: true }` AND the SDK's voice chat is never started at all
 *    (see `keepMicrophoneAway`): LiveAvatar never opens a second capture of the student's microphone, never publishes an audio track
 *    and cannot change the microphone's processing. The student's speech is captured ONLY by the transcription hook
 *    (`useOpenAITranscription`) and goes only to OpenAI (live transcription). The avatar is output only: video + voice.
 */
export type AvatarState = 'idle' | 'connecting' | 'ready' | 'speaking' | 'disconnected' | 'error';

export interface AvatarHandlers {
  /** Fired when the avatar really starts saying the current text (used to start the subtitle reveal). */
  onSpeakStart?: () => void;
  /** The avatar connection dropped without us asking (network, provider, time limit). */
  onDisconnected?: (reason: string) => void;
}

/**
 * The avatar is output-only here: replace the SDK's voice-chat start (called once the room connects) with a no-op, so LiveAvatar never
 * calls getUserMedia. Only affects this session object. Returns whether the guard could be installed (logged in debug mode).
 */
const keepMicrophoneAway = (session: LiveAvatarSession): boolean => {
  try {
    const vc: any = (session as any).voiceChat;
    if (!vc || typeof vc.start !== 'function') return false;
    vc.start = async () => { /* the avatar never listens: no microphone capture, no published audio track */ };
    return true;
  } catch { return false; }
};

/** A precise, log-safe avatar error code (the page shows it in development; the student sees a friendly message). */
const avatarError = (code: string, cause?: unknown): Error => {
  const c: any = cause;
  // LiveAvatar's own reason (SessionApiError: message + HTTP status + error code), or the LiveKit / browser error message
  const detail = c && typeof c === 'object'
    ? { message: typeof c.message === 'string' ? c.message.slice(0, 200) : undefined, status: typeof c.status === 'number' ? c.status : undefined, providerCode: c.errorCode != null ? String(c.errorCode).slice(0, 40) : undefined }
    : undefined;
  if (detail) console.warn(`[LearnIQ avatar] ${code}`, detail);
  return Object.assign(new Error(code), { code, part: 'avatar', cause: detail });
};

/** Upper bound for one utterance if the provider never reports the end of speech. */
const speakFallbackMs = (text: string) => Math.min(60000, 5000 + (text.split(/\s+/).filter(Boolean).length / 2.2) * 1000);

export const useLiveAvatar = (handlers: AvatarHandlers = {}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<LiveAvatarSession | null>(null);
  const stoppingRef = useRef(false);
  const pendingRef = useRef<{ resolve: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const connectedMsRef = useRef(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [state, setState] = useState<AvatarState>('idle');
  const [audioBlocked, setAudioBlocked] = useState(false);

  const settleSpeech = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    p.resolve();
  }, []);

  const markDisconnected = useCallback(() => {
    if (connectedAtRef.current) {
      connectedMsRef.current += Date.now() - connectedAtRef.current;
      connectedAtRef.current = null;
    }
  }, []);

  const teardown = useCallback(async () => {
    stoppingRef.current = true;
    settleSpeech();
    markDisconnected();
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s) {
      try { s.removeAllListeners(); } catch { /* ignore */ }
      try { await s.stop(); } catch { /* the provider-side max duration is the backstop */ }
    }
    if (videoRef.current) { try { videoRef.current.srcObject = null; } catch { /* ignore */ } }
  }, [markDisconnected, settleSpeech]);

  /** Connect to the avatar and show it in the <video> element. Resolves when the video stream is live. */
  const connect = useCallback(async (sessionToken: string): Promise<void> => {
    await teardown();
    stoppingRef.current = false;
    setState('connecting');
    setAudioBlocked(false);

    // voiceChat.defaultMuted: the SDK's default would publish the live microphone to LiveAvatar (see the header comment)
    const session = new LiveAvatarSession(sessionToken, { autoKeepAlive: true, voiceChat: { defaultMuted: true } });
    sessionRef.current = session;
    keepMicrophoneAway(session);

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(avatarError('avatar_stream_timeout')), 25000);
      session.once(SessionEvent.SESSION_STREAM_READY, () => {
        clearTimeout(timer);
        const el = videoRef.current;
        if (el) {
          session.attach(el);
          // browsers may refuse to start sound without a tap
          setTimeout(() => { if (el.paused) setAudioBlocked(true); }, 1200);
          el.play?.().catch(() => setAudioBlocked(true));
        }
        resolve();
      });
      session.once(SessionEvent.SESSION_DISCONNECTED, (reason: SessionDisconnectReason) => { clearTimeout(timer); reject(avatarError(`avatar_disconnected_early_${String(reason || 'unknown').toLowerCase()}`)); });
    });

    session.on(SessionEvent.SESSION_DISCONNECTED, (reason: SessionDisconnectReason) => {
      if (stoppingRef.current || sessionRef.current !== session) return;
      markDisconnected();
      settleSpeech();
      setState('disconnected');
      handlersRef.current.onDisconnected?.(String(reason));
    });
    session.on(SessionEvent.SESSION_STATE_CHANGED, (s: SessionState) => {
      if (s === SessionState.CONNECTED && !connectedAtRef.current) connectedAtRef.current = Date.now();
    });
    session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
      setState('speaking');
      handlersRef.current.onSpeakStart?.();
    });
    session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
      setState('ready');
      settleSpeech();
    });

    try {
      try { await session.start(); } catch (err) { throw avatarError('avatar_start_failed', err); }
      await ready;
      if (!connectedAtRef.current) connectedAtRef.current = Date.now();
      setState('ready');
    } catch (err: any) {
      setState('error');
      await teardown();
      throw err && err.part === 'avatar' ? err : avatarError('avatar_start_failed', err);
    }
  }, [markDisconnected, settleSpeech, teardown]);

  /** Make the avatar say `text`. Resolves when it has finished (or after a safe fallback timeout). */
  const speak = useCallback(async (text: string): Promise<void> => {
    const s = sessionRef.current;
    if (!s || stoppingRef.current) throw new Error('avatar_not_connected');
    settleSpeech();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => { pendingRef.current = null; setState('ready'); resolve(); }, speakFallbackMs(text));
      pendingRef.current = { resolve, timer };
      try {
        s.repeat(text);
      } catch (err) {
        clearTimeout(timer);
        pendingRef.current = null;
        resolve();
        throw err;
      }
    });
  }, [settleSpeech]);

  /** Stop the avatar mid-sentence (the student is ready to answer). */
  const interrupt = useCallback(() => {
    try { sessionRef.current?.interrupt(); } catch { /* ignore */ }
    settleSpeech();
    setState((s) => (s === 'speaking' ? 'ready' : s));
  }, [settleSpeech]);

  const resumeAudio = useCallback(() => {
    videoRef.current?.play().then(() => setAudioBlocked(false)).catch(() => { /* still blocked */ });
  }, []);

  const stop = useCallback(async () => { await teardown(); setState('idle'); }, [teardown]);

  /** Seconds the avatar was connected (analytics only). */
  const connectedSeconds = useCallback(() => {
    const live = connectedAtRef.current ? Date.now() - connectedAtRef.current : 0;
    return Math.round((connectedMsRef.current + live) / 1000);
  }, []);

  useEffect(() => () => { void teardown(); }, [teardown]);

  return { videoRef, state, audioBlocked, connect, speak, interrupt, stop, resumeAudio, connectedSeconds };
};
