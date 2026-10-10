import { useCallback, useEffect, useRef } from 'react';
import { describeProviderError, startSttMonitor, sttCountEvent, sttLog, type ProviderErrorInfo } from './sttDiagnostics';

/**
 * Live speech-to-text through OpenAI Realtime (transcription session) over WebRTC.
 *
 *  - The BROWSER connects straight to OpenAI with a short-lived client secret minted by our backend
 *    (POST /api/ai-interviews/:id/realtime-session). No permanent key ever reaches the browser.
 *  - The session (model, language, server VAD = end-of-answer detection) is configured by the backend when it mints the secret.
 *  - Audio goes only to OpenAI for transcription. It is never recorded, stored or sent to our server or the avatar.
 *  - `onPartial` = LIVE text (may still change); `onFinal` = FINAL text of one spoken turn. Only finals are sent to
 *    the backend and saved.
 *  - The microphone track is switched on only while the interviewer is listening (prevents the avatar's own voice
 *    from being transcribed as the student's answer).
 *  - Every failure is thrown / reported with a precise code (stt_connect_401, stt_channel_timeout, OpenAI's own error code ...),
 *    never as a generic "network" error, so the page can say what really went wrong.
 */
export interface TranscriptionHandlers {
  onSpeechStart?: () => void;
  onSpeechStop?: () => void;
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onConnectionLost?: (reason: string) => void;
  /** OpenAI could not transcribe a turn (a technical problem, not silence). `detail` = OpenAI's error type / code / message (never a secret). */
  onTranscriptionFailed?: (detail?: ProviderErrorInfo) => void;
}

export interface SttCredentials { clientSecret: string; callsUrl: string }

/** What the page's development diagnostics panel shows (no secret, no audio, no transcript text). */
export interface SttSnapshot {
  provider: 'openai';
  peer?: string; ice?: string; dataChannel?: string;
  trackEnabled?: boolean; trackState?: string; trackMuted?: boolean; senderIsMic?: boolean;
  packetsSent?: number; bytesSent?: number; micLevel?: number;
  events: number; lastEvent?: string; lastError?: string; session?: string;
}

export const isTranscriptionSupported = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.RTCPeerConnection !== 'undefined'
  && !!navigator.mediaDevices
  && typeof navigator.mediaDevices.getUserMedia === 'function';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** An Error whose `message` and `code` are a precise, log-safe reason (e.g. "stt_connect_401"); `detail` = OpenAI's error, if any. */
const sttError = (code: string, extra: { status?: number; detail?: ProviderErrorInfo } = {}): Error =>
  Object.assign(new Error(code), { code, ...extra });

/** OpenAI error codes that end the whole session (as opposed to one failed turn). */
// (account problems such as insufficient_quota / credit_balance_exhausted are NOT reconnected: a new connection would fail the same
// way. They are reported as a failed turn with the provider's code, and the page stops the interview with the real reason.)
const FATAL_CODES = new Set(['session_expired', 'session_closed']);
/** Harmless: e.g. a manual commit when the server VAD had already committed the turn. */
const IGNORED_CODES = new Set(['input_audio_buffer_commit_empty']);

/** The part of a session.created / session.updated event that matters for debugging (no ids, no secrets). */
const describeSession = (s: any): string => {
  if (!s || typeof s !== 'object') return '';
  const input = (s.audio && s.audio.input) || {};
  const tr = input.transcription || s.input_audio_transcription || {};
  const td = input.turn_detection || s.turn_detection;
  const fmt = input.format && typeof input.format === 'object' ? input.format.type : input.format || s.input_audio_format;
  return [`type=${s.type || s.object || '?'}`, `model=${tr.model || '?'}`, `lang=${tr.language || '-'}`,
    `vad=${td ? td.type : 'none'}`, `format=${fmt || '?'}`].join(' ');
};

export const useOpenAITranscription = (handlers: TranscriptionHandlers) => {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const itemsRef = useRef<Map<string, string>>(new Map());
  const closedByUs = useRef(false);
  const listeningRef = useRef(false);
  const stopMonitorRef = useRef<() => void>(() => { /* off */ });
  const infoRef = useRef<{ events: number; lastEvent?: string; lastError?: string; session?: string }>({ events: 0 });
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  /** The microphone (and the track the peer connection really sends) is on only while the interviewer is listening. */
  const applyTrackState = useCallback(() => {
    const on = listeningRef.current;
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = on; });
    try {
      // the sender normally carries the very same track object; this keeps it in step even if a browser handed back a clone
      pcRef.current?.getSenders?.().forEach((s) => { if (s.track && s.track.kind === 'audio') s.track.enabled = on; });
    } catch { /* ignore */ }
  }, []);

  /** Send one client event over the data channel (only when it is open). */
  const sendEvent = useCallback((ev: Record<string, unknown>): boolean => {
    const dc = dcRef.current as any;
    if (!dc || dc.readyState !== 'open' || typeof dc.send !== 'function') return false;
    try { dc.send(JSON.stringify(ev)); return true; } catch { return false; }
  }, []);

  /** Open (or re-open) the live-transcription connection for an already granted microphone stream. */
  const connect = useCallback(async (stream: MediaStream, creds: SttCredentials): Promise<void> => {
    closedByUs.current = false;
    // tear down any previous connection (reconnect)
    try { dcRef.current?.close(); } catch { /* ignore */ }
    try { pcRef.current?.close(); } catch { /* ignore */ }
    itemsRef.current.clear();
    stopMonitorRef.current();
    infoRef.current = { events: 0 };
    const tracks = stream.getAudioTracks().filter((t) => t.readyState !== 'ended');
    if (!tracks.length) throw sttError('stt_no_microphone_track');
    streamRef.current = stream;
    sttLog('connect: microphone', tracks.map((t) => ({ label: t.label, enabled: t.enabled, muted: t.muted, state: t.readyState })));

    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    tracks.forEach((t) => pc.addTrack(t, stream));
    applyTrackState();

    /** A connection attempt that failed is dropped silently (the caller gets the thrown error, not a "lost" callback as well). */
    const abandon = () => {
      if (pcRef.current === pc) { pcRef.current = null; dcRef.current = null; }
      try { pc.close(); } catch { /* ignore */ }
    };
    const lost = (why: string) => {
      if (closedByUs.current || pcRef.current !== pc) return;
      sttLog('connection LOST', why);
      handlersRef.current.onConnectionLost?.(why);
    };
    pc.onconnectionstatechange = () => {
      sttLog('peer connection', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        // "disconnected" often heals by itself within a few seconds
        if (pc.connectionState === 'disconnected') {
          setTimeout(() => { if (pcRef.current === pc && pc.connectionState === 'disconnected') lost('disconnected'); }, 4000);
        } else lost(pc.connectionState);
      }
    };
    pc.oniceconnectionstatechange = () => sttLog('ice', pc.iceConnectionState);

    const dc = pc.createDataChannel('oai-events');
    dcRef.current = dc;
    dc.onmessage = (msg) => {
      let ev: any;
      try { ev = JSON.parse(msg.data); } catch { return; }
      if (!ev || typeof ev.type !== 'string') return;
      const h = handlersRef.current;
      const info = infoRef.current;
      info.events += 1;
      info.lastEvent = ev.type;
      sttCountEvent(ev.type);
      if (ev.type !== 'conversation.item.input_audio_transcription.delta') sttLog(`event ${ev.type}`);
      switch (ev.type) {
        case 'session.created':
        case 'session.updated':
        case 'transcription_session.created':
        case 'transcription_session.updated':
          info.session = describeSession(ev.session);
          sttLog(`${ev.type}: ${info.session}`);
          break;
        case 'input_audio_buffer.speech_started': h.onSpeechStart?.(); break;
        case 'input_audio_buffer.speech_stopped': h.onSpeechStop?.(); break;
        case 'conversation.item.input_audio_transcription.delta': {
          if (!ev.item_id || typeof ev.delta !== 'string') break;
          const next = (itemsRef.current.get(ev.item_id) || '') + ev.delta;
          itemsRef.current.set(ev.item_id, next);
          h.onPartial?.(next);
          break;
        }
        case 'conversation.item.input_audio_transcription.completed': {
          if (ev.item_id) itemsRef.current.delete(ev.item_id);
          const text = String(ev.transcript || '').trim();
          sttLog('transcript completed', { chars: text.length });
          if (text) h.onFinal?.(text);
          break;
        }
        case 'conversation.item.input_audio_transcription.failed':
        case 'error': {
          const d = describeProviderError(ev);
          info.lastError = [d.code, d.type, d.message].filter(Boolean).join(' / ') || ev.type;
          if (d.code && IGNORED_CODES.has(d.code)) { sttLog('ignored provider notice', d); break; }
          sttLog('transcription FAILED', d);
          if (d.code && FATAL_CODES.has(d.code)) { lost(`provider_${d.code}`); break; }
          // a single failed turn is not fatal (the silence flow covers "nothing was heard"), but it is reported so the
          // server can tell a technical fault apart from a student who simply did not answer
          h.onTranscriptionFailed?.(d);
          break;
        }
        default: break;
      }
    };
    dc.onclose = () => { sttLog('data channel closed'); lost('channel_closed'); };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(creds.callsUrl, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${creds.clientSecret}`, 'Content-Type': 'application/sdp' },
        signal: controller.signal,
      });
    } catch (err: any) {
      abandon();
      throw sttError(err && err.name === 'AbortError' ? 'stt_connect_timeout' : 'stt_connect_network');
    } finally { clearTimeout(timer); }
    sttLog('calls response', res.status);
    if (!res.ok) {
      // OpenAI explains a refusal in a JSON body ({ error: { type, code, message } }); keep only those three fields
      let detail: ProviderErrorInfo | undefined;
      try { const body = JSON.parse(await res.text()); detail = describeProviderError(body); } catch { /* not JSON */ }
      sttLog('calls REFUSED', { status: res.status, ...(detail || {}) });
      abandon();
      throw sttError(`stt_connect_${res.status}`, { status: res.status, detail });
    }
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
    } catch {
      abandon();
      throw sttError('stt_sdp_rejected');
    }

    // wait until the data channel is open (ICE + DTLS done, events flow)
    const started = Date.now();
    while (dc.readyState !== 'open') {
      if (dc.readyState === 'closed' || Date.now() - started > 10000) {
        sttLog('data channel did not open', { dc: dc.readyState, peer: pc.connectionState, ice: pc.iceConnectionState });
        abandon();
        throw sttError('stt_channel_timeout', { detail: { message: `peer=${pc.connectionState} ice=${pc.iceConnectionState}` } });
      }
      await wait(100);
    }
    sttLog('data channel open');
    stopMonitorRef.current = startSttMonitor(() => ({ pc: pcRef.current, dc: dcRef.current, stream: streamRef.current, listening: listeningRef.current }));
  }, [applyTrackState]);

  /** Turn the microphone on only while the interviewer is listening. A new turn starts from an empty audio buffer. */
  const setListening = useCallback((on: boolean) => {
    const was = listeningRef.current;
    listeningRef.current = on;
    applyTrackState();
    sttLog(on ? 'listening ON (microphone enabled)' : 'listening OFF (microphone muted)');
    if (!on) itemsRef.current.clear();
    // drop anything buffered while the interviewer was talking (the track was muted, so this is at most silence)
    if (on && !was) sendEvent({ type: 'input_audio_buffer.clear' });
  }, [applyTrackState, sendEvent]);

  /**
   * End the current answer NOW (the student pressed "I'm done", or the server VAD never heard the end because of background
   * noise): OpenAI transcribes what is in the buffer and sends `...transcription.completed`. Harmless if nothing is buffered.
   */
  const commit = useCallback((): boolean => {
    const ok = sendEvent({ type: 'input_audio_buffer.commit' });
    sttLog(ok ? 'manual commit sent' : 'manual commit NOT sent (channel not open)');
    return ok;
  }, [sendEvent]);

  /** Current state for the development diagnostics panel (reads this browser's own WebRTC stats; nothing is sent anywhere). */
  const snapshot = useCallback(async (): Promise<SttSnapshot | null> => {
    const pc = pcRef.current;
    if (!pc) return null;
    const track = streamRef.current ? streamRef.current.getAudioTracks()[0] : undefined;
    const sender = pc.getSenders().find((x) => x.track && x.track.kind === 'audio');
    const out: SttSnapshot = {
      provider: 'openai', peer: pc.connectionState, ice: pc.iceConnectionState, dataChannel: dcRef.current ? dcRef.current.readyState : undefined,
      trackEnabled: track ? track.enabled : undefined, trackState: track ? track.readyState : undefined, trackMuted: track ? track.muted : undefined,
      senderIsMic: !!(sender && track && sender.track === track), ...infoRef.current,
    };
    try {
      const stats = await pc.getStats();
      stats.forEach((r: any) => {
        if (r.type === 'outbound-rtp' && r.kind === 'audio') { out.packetsSent = r.packetsSent; out.bytesSent = r.bytesSent; }
        if (r.type === 'media-source' && r.kind === 'audio' && typeof r.audioLevel === 'number') out.micLevel = Math.round(r.audioLevel * 1000) / 1000;
      });
    } catch { /* ignore */ }
    return out;
  }, []);

  /** Close the connection. The microphone stream itself is owned (and stopped) by the caller. */
  const close = useCallback(() => {
    closedByUs.current = true;
    stopMonitorRef.current();
    stopMonitorRef.current = () => { /* off */ };
    try { dcRef.current?.close(); } catch { /* ignore */ }
    try { pcRef.current?.close(); } catch { /* ignore */ }
    dcRef.current = null;
    pcRef.current = null;
    itemsRef.current.clear();
  }, []);

  useEffect(() => close, [close]);

  return { connect, setListening, commit, snapshot, close };
};

/** Ask for the microphone. Rejects with a friendly `kind` so the UI can show the right message. */
export type MicFailure = 'denied' | 'unavailable' | 'unsupported';
export const requestMicrophone = async (): Promise<MediaStream> => {
  if (!isTranscriptionSupported()) throw Object.assign(new Error('unsupported'), { kind: 'unsupported' as MicFailure });
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
  } catch (err: any) {
    const name = err?.name || '';
    const kind: MicFailure = name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' ? 'denied' : 'unavailable';
    throw Object.assign(new Error(kind), { kind });
  }
};
