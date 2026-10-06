/**
 * Opt-in diagnostics for the live speech-to-text path (microphone -> OpenAI Realtime -> transcript -> page).
 *
 * OFF by default: when it is not switched on, every function here does nothing (no console output, no timers, no network).
 * Switch it on in the browser console, then reload the interview page:
 *
 *     localStorage.setItem('learniq_stt_debug', '1')        (or open the page with ?sttdebug=1)
 *
 * It prints "[LearnIQ STT] ..." lines to the console and keeps the last lines in `window.__learniqStt.log` (type that in the
 * console to read them). It never prints a client secret or an API key; it only reads this browser's own state.
 *
 * What it answers (in order of the pipeline):
 *   microphone track live/enabled -> sender track enabled -> peer / ICE / data channel state -> RTP packets + bytes really sent
 *   -> microphone level -> every event OpenAI sends back (speech_started / stopped / transcription delta / completed / error) ->
 *   what the page did with it (partial, final, submitted).
 */
export interface ProviderErrorInfo { type?: string; code?: string; message?: string }

const MAX_LINES = 300;

const text = (v: unknown, max: number): string | undefined =>
  (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined);

export const sttDebugEnabled = (): boolean => {
  try {
    if (typeof window === 'undefined') return false;
    if (window.localStorage && window.localStorage.getItem('learniq_stt_debug') === '1') return true;
    return new URLSearchParams(window.location.search).get('sttdebug') === '1';
  } catch { return false; }
};

/**
 * The part of an OpenAI error / failed-transcription event that is safe to show or log: error type, code and message
 * (e.g. insufficient_quota). Never the event id, the item id or anything else.
 */
export const describeProviderError = (ev: any): ProviderErrorInfo => {
  const inner = ev && typeof ev === 'object' && ev.error && typeof ev.error === 'object' ? ev.error : undefined;
  const e: any = inner || {};
  return { type: text(e.type, 64), code: text(e.code, 64), message: text(e.message, 200) };
};

/** A short, log-safe code for the backend ("insufficient_quota"), or undefined. */
export const errorCodeForServer = (d?: ProviderErrorInfo): string | undefined => {
  const raw = d && (d.code || d.type);
  return raw && /^[A-Za-z0-9_.:-]{1,64}$/.test(raw) ? raw : undefined;
};

export const sttLog = (tag: string, data?: unknown): void => {
  if (!sttDebugEnabled()) return;
  try { if (data === undefined) console.info(`[LearnIQ STT] ${tag}`); else console.info(`[LearnIQ STT] ${tag}`, data); } catch { /* ignore */ }
  try {
    const w: any = window;
    const box = (w.__learniqStt = w.__learniqStt || { log: [], events: {} });
    box.log.push([new Date().toISOString().slice(11, 23), tag, data === undefined ? '' : JSON.stringify(data).slice(0, 400)]);
    if (box.log.length > MAX_LINES) box.log.shift();
  } catch { /* ignore */ }
};

/** Counts one data-channel event type (visible as window.__learniqStt.events). */
export const sttCountEvent = (type: string): void => {
  if (!sttDebugEnabled()) return;
  try {
    const w: any = window;
    const box = (w.__learniqStt = w.__learniqStt || { log: [], events: {} });
    box.events[type] = (box.events[type] || 0) + 1;
  } catch { /* ignore */ }
};

export interface MonitorTarget {
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  stream: MediaStream | null;
  listening: boolean;
}

/**
 * Every `everyMs`: logs one status line (track, sender, peer, ICE, data channel, packets / bytes sent, microphone level) and a
 * WARNING when the student should be heard but nothing is going out. Returns a function that stops it.
 */
export const startSttMonitor = (target: () => MonitorTarget, everyMs = 2000): (() => void) => {
  if (!sttDebugEnabled()) return () => { /* off */ };
  let lastPackets = -1;
  let quietTicks = 0;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const { pc, dc, stream, listening } = target();
      if (!pc) return;
      const track = stream ? stream.getAudioTracks()[0] : undefined;
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'audio');
      let packets: number | undefined; let bytes: number | undefined; let level: number | undefined;
      try {
        const stats = await pc.getStats();
        stats.forEach((r: any) => {
          if (r.type === 'outbound-rtp' && r.kind === 'audio') { packets = r.packetsSent; bytes = r.bytesSent; }
          if (r.type === 'media-source' && r.kind === 'audio') level = r.audioLevel;
        });
      } catch { /* ignore */ }
      const delta = packets != null && lastPackets >= 0 ? packets - lastPackets : undefined;
      if (packets != null) lastPackets = packets;
      sttLog('status', {
        listening,
        mic: track && { label: track.label, enabled: track.enabled, muted: track.muted, state: track.readyState },
        senderTrackIsMic: !!(sender && track && sender.track === track),
        senderTrackEnabled: sender && sender.track ? sender.track.enabled : null,
        peer: pc.connectionState, ice: pc.iceConnectionState, signaling: pc.signalingState, dataChannel: dc ? dc.readyState : null,
        packetsSent: packets, bytesSent: bytes, packetsSinceLast: delta, micLevel: level != null ? +level.toFixed(4) : undefined,
      });
      if (listening) {
        if (track && !track.enabled) sttLog('WARNING the microphone track is DISABLED while the interviewer is listening');
        if (sender && sender.track && !sender.track.enabled) sttLog('WARNING the peer connection sender track is DISABLED while listening');
        if (delta === 0) sttLog('WARNING no audio packets were sent to OpenAI during the last interval');
        quietTicks = level != null && level < 0.001 ? quietTicks + 1 : 0;
        if (quietTicks === 3) sttLog('WARNING the microphone level is ~0 for 6 s while listening: the browser receives no sound (check the Windows input device / mute / privacy settings)');
      } else quietTicks = 0;
    } finally { busy = false; }
  };
  const id = setInterval(() => { void tick(); }, everyMs);
  void tick();
  return () => clearInterval(id);
};
