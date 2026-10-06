import { useCallback, useEffect, useRef } from 'react';
import { describeProviderError, startSttMonitor, sttCountEvent, sttLog, type ProviderErrorInfo } from './sttDiagnostics';

/**
 * Live speech-to-text through OpenAI Realtime (transcription session) over WebRTC.
 *
 *  - The BROWSER connects straight to OpenAI with a short-lived client secret minted by our backend
 *    (POST /api/ai-interviews/:id/realtime-session). No permanent key ever reaches the browser.
 *  - Audio goes only to OpenAI for transcription. It is never recorded, stored or sent to our server or the avatar.
 *  - `onPartial` = LIVE text (may still change); `onFinal` = FINAL text of one spoken turn. Only finals are sent to
 *    the backend and saved.
 *  - The microphone track is switched on only while the interviewer is listening (prevents the avatar's own voice
 *    from being transcribed as the student's answer).
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

export const isTranscriptionSupported = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.RTCPeerConnection !== 'undefined'
  && !!navigator.mediaDevices
  && typeof navigator.mediaDevices.getUserMedia === 'function';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const useOpenAITranscription = (handlers: TranscriptionHandlers) => {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const itemsRef = useRef<Map<string, string>>(new Map());
  const closedByUs = useRef(false);
  const listeningRef = useRef(false);
  const stopMonitorRef = useRef<() => void>(() => { /* off */ });
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

  /** Open (or re-open) the live-transcription connection for an already granted microphone stream. */
  const connect = useCallback(async (stream: MediaStream, creds: SttCredentials): Promise<void> => {
    closedByUs.current = false;
    // tear down any previous connection (reconnect)
    try { dcRef.current?.close(); } catch { /* ignore */ }
    try { pcRef.current?.close(); } catch { /* ignore */ }
    itemsRef.current.clear();
    stopMonitorRef.current();
    const tracks = stream.getAudioTracks().filter((t) => t.readyState !== 'ended');
    if (!tracks.length) throw new Error('stt_no_microphone_track');
    streamRef.current = stream;
    sttLog('connect: microphone', tracks.map((t) => ({ label: t.label, enabled: t.enabled, muted: t.muted, state: t.readyState })));

    const pc = new RTCPeerConnection();
    pcRef.current = pc;
    tracks.forEach((t) => pc.addTrack(t, stream));
    applyTrackState();

    const lost = (why: string) => {
      if (closedByUs.current || pcRef.current !== pc) return;
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

    const dc = pc.createDataChannel('oai-events');
    dcRef.current = dc;
    dc.onmessage = (msg) => {
      let ev: any;
      try { ev = JSON.parse(msg.data); } catch { return; }
      const h = handlersRef.current;
      if (ev && typeof ev.type === 'string') { sttCountEvent(ev.type); if (ev.type !== 'conversation.item.input_audio_transcription.delta') sttLog(`event ${ev.type}`); }
      switch (ev.type) {
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
          if (text) h.onFinal?.(text);
          break;
        }
        case 'conversation.item.input_audio_transcription.failed':
        case 'error':
          // a single failed turn is not fatal (the silence flow covers "nothing was heard"), but it is reported so the
          // server can tell a technical fault apart from a student who simply did not answer
          sttLog('transcription FAILED', describeProviderError(ev));
          h.onTranscriptionFailed?.(describeProviderError(ev));
          break;
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
    } finally { clearTimeout(timer); }
    sttLog('calls response', res.status);
    if (!res.ok) throw new Error(`stt_connect_${res.status}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });

    // wait until the data channel is open (events flow)
    const started = Date.now();
    while (dc.readyState !== 'open') {
      if (dc.readyState === 'closed' || Date.now() - started > 10000) throw new Error('stt_channel_timeout');
      await wait(100);
    }
    sttLog('data channel open');
    stopMonitorRef.current = startSttMonitor(() => ({ pc: pcRef.current, dc: dcRef.current, stream: streamRef.current, listening: listeningRef.current }));
  }, [applyTrackState]);

  /** Turn the microphone on only while the interviewer is listening. */
  const setListening = useCallback((on: boolean) => {
    listeningRef.current = on;
    applyTrackState();
    sttLog(on ? 'listening ON (microphone enabled)' : 'listening OFF (microphone muted)');
    if (!on) itemsRef.current.clear();
  }, [applyTrackState]);

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

  return { connect, setListening, close };
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
