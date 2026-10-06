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
 *    that, so the session is created with `voiceChat: { defaultMuted: true }`: the SDK still creates its (second) local audio track, but
 *    it is muted from the start and is never unmuted, so no microphone audio reaches LiveAvatar. The student's speech is captured
 *    separately by `useOpenAITranscription` and goes only to OpenAI (live transcription).
 */
export type AvatarState = 'idle' | 'connecting' | 'ready' | 'speaking' | 'disconnected' | 'error';

export interface AvatarHandlers {
  /** Fired when the avatar really starts saying the current text (used to start the subtitle reveal). */
  onSpeakStart?: () => void;
  /** The avatar connection dropped without us asking (network, provider, time limit). */
  onDisconnected?: (reason: string) => void;
}

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

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('avatar_stream_timeout')), 25000);
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
      session.once(SessionEvent.SESSION_DISCONNECTED, () => { clearTimeout(timer); reject(new Error('avatar_disconnected_early')); });
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
      await session.start();
      await ready;
      if (!connectedAtRef.current) connectedAtRef.current = Date.now();
      setState('ready');
    } catch (err) {
      setState('error');
      await teardown();
      throw err;
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
