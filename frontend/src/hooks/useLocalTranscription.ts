import { useCallback, useEffect, useRef } from 'react';
import type { TranscriptionHandlers } from './useOpenAITranscription';

/**
 * Live speech-to-text through the LOCAL faster-whisper service (/local-stt) — LOCAL DEVELOPMENT ONLY, English only.
 *
 * Same contract as useOpenAITranscription (the interview page cannot tell the two apart):
 *   onSpeechStart / onSpeechStop / onPartial (live text) / onFinal (final text of one spoken turn) /
 *   onConnectionLost / onTranscriptionFailed
 *
 *  - The BROWSER streams the microphone (16 kHz mono PCM) over a WebSocket to a process on THIS computer
 *    (ws://127.0.0.1:8765 by default; the address comes from the backend's realtime-session response).
 *  - The audio goes nowhere else: not to our backend, not to the avatar, not to any third party, and it is never stored.
 *  - The backend refuses to hand out this configuration in production, where OpenAI Realtime is used.
 *  - The microphone track is switched on (and audio is sent) only while the interviewer is listening.
 */
export interface LocalSttCredentials { url: string; silenceDurationMs?: number }

const TARGET_RATE = 16000;
const READY_TIMEOUT_MS = 10000;
const MAX_BUFFERED_BYTES = 1_000_000; // never let a stalled socket pile up audio

export const isLocalTranscriptionSupported = (): boolean =>
  typeof window !== 'undefined'
  && typeof WebSocket !== 'undefined'
  && typeof AudioContext !== 'undefined'
  && typeof AudioWorkletNode !== 'undefined'
  && !!navigator.mediaDevices
  && typeof navigator.mediaDevices.getUserMedia === 'function';

/**
 * Turns one message from the local service into exactly one callback. Returns the message type it handled
 * (or null for anything it ignores), so the mapping can be tested without a browser.
 *
 *   speech_started -> onSpeechStart      speech_stopped -> onSpeechStop
 *   partial        -> onPartial(text)    final          -> onFinal(text)
 *   transcription_failed | error -> onTranscriptionFailed
 */
export const mapLocalSttMessage = (raw: unknown, h: TranscriptionHandlers): string | null => {
  let msg: any;
  try { msg = typeof raw === 'string' ? JSON.parse(raw) : null; } catch { return null; }
  if (!msg || typeof msg !== 'object') return null;
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  switch (msg.type) {
    case 'speech_started': h.onSpeechStart?.(); return msg.type;
    case 'speech_stopped': h.onSpeechStop?.(); return msg.type;
    case 'partial': if (!text) return null; h.onPartial?.(text); return msg.type;
    case 'final': if (!text) return null; h.onFinal?.(text); return msg.type;
    case 'transcription_failed':
    case 'error':
      // one failed turn is not fatal (the silence flow covers "nothing was heard"), but it is reported so the server can
      // tell a technical fault apart from a student who simply did not answer
      h.onTranscriptionFailed?.();
      return msg.type;
    default: return null;
  }
};

/**
 * AudioWorklet that converts the microphone to 16 kHz mono signed 16-bit PCM (40 ms chunks). Normally the AudioContext already
 * runs at 16 kHz and this only converts the format; if the browser refused that rate it resamples (linear interpolation).
 */
export const WORKLET_SOURCE = `
class LearnIqPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${TARGET_RATE};
    this.pos = 0;
    this.last = 0;
    this.out = new Int16Array(640);
    this.n = 0;
  }
  push(v) {
    const c = v < -1 ? -1 : v > 1 ? 1 : v;
    this.out[this.n++] = c < 0 ? c * 32768 : c * 32767;
    if (this.n === this.out.length) {
      const chunk = this.out;
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
      this.out = new Int16Array(640);
      this.n = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const N = ch.length;
    while (this.pos < N) {
      const i = Math.floor(this.pos);
      if (i + 1 >= N) break;
      const a = i < 0 ? this.last : ch[i];
      const b = ch[i + 1];
      this.push(a + (b - a) * (this.pos - i));
      this.pos += this.ratio;
    }
    this.pos -= N;
    this.last = ch[N - 1];
    return true;
  }
}
registerProcessor('learniq-pcm', LearnIqPcm);
`;

export const useLocalTranscription = (handlers: TranscriptionHandlers) => {
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const closedByUs = useRef(false);
  const listeningRef = useRef(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const applyTrackState = useCallback(() => {
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = listeningRef.current; });
  }, []);

  const teardown = useCallback(() => {
    const ws = wsRef.current; const node = nodeRef.current; const ctx = ctxRef.current;
    wsRef.current = null; nodeRef.current = null; ctxRef.current = null;
    try { if (node) node.port.onmessage = null; } catch { /* ignore */ }
    try { node?.disconnect(); } catch { /* ignore */ }
    try { if (ws) { ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.close(); } } catch { /* ignore */ }
    try { void ctx?.close(); } catch { /* ignore */ }
  }, []);

  /** Open (or re-open) the connection to the local service for an already granted microphone stream. */
  const connect = useCallback(async (stream: MediaStream, creds: LocalSttCredentials): Promise<void> => {
    closedByUs.current = false;
    teardown();
    if (!isLocalTranscriptionSupported()) throw new Error('stt_unsupported');
    streamRef.current = stream;
    applyTrackState();

    const ws = new WebSocket(creds.url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    const lost = (why: string) => {
      if (closedByUs.current || wsRef.current !== ws) return;
      handlersRef.current.onConnectionLost?.(why);
    };

    // 1. handshake: "start" -> "ready"
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stt_connect_timeout')), READY_TIMEOUT_MS);
      const fail = (err: Error) => { clearTimeout(timer); reject(err); };
      ws.onopen = () => ws.send(JSON.stringify({ type: 'start', sampleRate: TARGET_RATE, language: 'en', silenceMs: creds.silenceDurationMs }));
      ws.onerror = () => fail(new Error('stt_connect_failed'));
      ws.onclose = () => fail(new Error('stt_connect_closed'));
      ws.onmessage = (ev: MessageEvent) => {
        let msg: any;
        try { msg = JSON.parse(String(ev.data)); } catch { return; }
        if (msg?.type === 'ready') { clearTimeout(timer); resolve(); }
        else if (msg?.type === 'error') fail(new Error(`stt_server_${msg.code || 'error'}`));
      };
    }).catch((err) => { if (wsRef.current === ws) teardown(); throw err; });

    // 2. from now on: events in, connection problems out
    ws.onmessage = (ev: MessageEvent) => { mapLocalSttMessage(ev.data, handlersRef.current); };
    ws.onclose = () => lost('channel_closed');
    ws.onerror = () => lost('ws_error');

    // 3. microphone -> 16 kHz PCM -> WebSocket (only while listening)
    const attach = async (ctx: AudioContext) => {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'learniq-pcm', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      nodeRef.current = node;
      node.port.onmessage = (e: MessageEvent) => {
        if (!listeningRef.current || ws.readyState !== 1 || ws.bufferedAmount > MAX_BUFFERED_BYTES) return;
        ws.send(e.data);
      };
      const mute = ctx.createGain(); // keeps the graph running without ever playing the microphone back
      mute.gain.value = 0;
      source.connect(node); node.connect(mute); mute.connect(ctx.destination);
      if (ctx.state !== 'running') await ctx.resume();
      if (ctx.state !== 'running') throw new Error('stt_audio_suspended');
    };
    let ctx: AudioContext;
    try { ctx = new AudioContext({ sampleRate: TARGET_RATE }); } catch { ctx = new AudioContext(); }
    ctxRef.current = ctx;
    try {
      try { await attach(ctx); } catch (err: any) {
        // some browsers cannot connect a microphone to a 16 kHz context: retry once at the native rate (the worklet resamples)
        if (ctx.sampleRate !== TARGET_RATE || err?.message === 'stt_audio_suspended') throw err;
        try { void ctx.close(); } catch { /* ignore */ }
        ctx = new AudioContext();
        ctxRef.current = ctx;
        await attach(ctx);
      }
    } catch (err) {
      if (wsRef.current === ws) teardown();
      throw err;
    }
  }, [applyTrackState, teardown]);

  /** Turn the microphone on only while the interviewer is listening; the service starts every turn from a clean slate. */
  const setListening = useCallback((on: boolean) => {
    listeningRef.current = on;
    applyTrackState();
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify({ type: 'listening', on })); } catch { /* the close handler reports a dead socket */ }
    }
  }, [applyTrackState]);

  /** Close the connection. The microphone stream itself is owned (and stopped) by the caller. */
  const close = useCallback(() => {
    closedByUs.current = true;
    listeningRef.current = false;
    teardown();
    // let go of the stream: when the page uses OpenAI Realtime this hook is idle, and it must never touch the shared microphone tracks
    streamRef.current = null;
  }, [teardown]);

  useEffect(() => close, [close]);

  return { connect, setListening, close };
};
