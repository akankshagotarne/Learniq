/**
 * AI Interview — local (faster-whisper) speech-to-text: browser side. Run with:  npm run test:aiinterview
 *
 * The real hook (frontend/src/hooks/useLocalTranscription.ts) is compiled with the frontend's own TypeScript and executed here with
 * test doubles for the browser pieces (WebSocket, AudioContext, AudioWorklet, microphone). No browser, no network, no model, no
 * microphone. Skipped when the frontend sources / their node_modules are not next to the backend in this checkout.
 * The Python service has its own tests:  cd local-stt && python -m unittest -v test_server
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FE = path.join(__dirname, '..', '..', '..', 'frontend');
const HOOK = path.join(FE, 'src', 'hooks', 'useLocalTranscription.ts');
const tsPath = path.join(FE, 'node_modules', 'typescript');
const can = fs.existsSync(HOOK) && fs.existsSync(tsPath);
const opts = { skip: can ? false : 'frontend sources / node_modules are not next to the backend in this checkout' };
const read = (rel) => fs.readFileSync(path.join(FE, 'src', rel), 'utf8');

// ── browser test doubles ──────────────────────────────────────────────────────────────────────────────────────
class FakeWS {
  constructor(url) {
    this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; this.closed = false;
    FakeWS.instances.push(this);
    setImmediate(() => { if (FakeWS.refuse) { this.readyState = 3; this.onerror && this.onerror({}); this.onclose && this.onclose({}); return; } this.readyState = 1; this.onopen && this.onopen(); });
  }
  send(data) {
    this.sent.push(data);
    if (typeof data === 'string') {
      const m = JSON.parse(data);
      if (m.type === 'start') setImmediate(() => this.emit(FakeWS.startReply || { type: 'ready', model: 'base.en', device: 'cpu', sampleRate: 16000 }));
    }
  }
  emit(obj) { this.onmessage && this.onmessage({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
  close() { this.readyState = 3; this.closed = true; }
  serverClose() { this.readyState = 3; this.onclose && this.onclose({}); }
  json() { return this.sent.filter((s) => typeof s === 'string').map((s) => JSON.parse(s)); }
  binary() { return this.sent.filter((s) => typeof s !== 'string'); }
}
class FakeCtx {
  constructor(options) {
    if (options && options.sampleRate && FakeCtx.rejectSampleOption) throw new Error('sampleRate option not supported');
    this.sampleRate = (options && options.sampleRate) || 48000; this.state = 'suspended'; this.destination = {};
    this.audioWorklet = { addModule: async (url) => { this.module = url; } };
    FakeCtx.instances.push(this);
  }
  createMediaStreamSource() {
    if (FakeCtx.failSourceAt16k && this.sampleRate === 16000) throw new Error('NotSupportedError: different sample-rate');
    return { connect: (n) => n };
  }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
  async resume() { this.state = FakeCtx.stuck ? 'suspended' : 'running'; }
  async close() { this.closed = true; }
}
class FakeNode {
  constructor(ctx, name, o) { this.ctx = ctx; this.name = name; this.options = o; this.port = { onmessage: null }; FakeNode.instances.push(this); }
  connect(n) { return n; }
  disconnect() { this.disconnected = true; }
}
const reset = () => {
  FakeWS.instances = []; FakeWS.refuse = false; FakeWS.startReply = null;
  FakeCtx.instances = []; FakeCtx.rejectSampleOption = false; FakeCtx.failSourceAt16k = false; FakeCtx.stuck = false;
  FakeNode.instances = [];
};

/** Compiles the real hook and returns its exports, running in a sandbox that only has the doubles above. */
const loadHook = () => {
  const ts = require(tsPath);
  const out = ts.transpileModule(fs.readFileSync(HOOK, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const fetchCalls = [];
  const sandbox = {
    module: { exports: {} }, exports: {},
    require: (name) => {
      if (name === 'react') return { useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }) };
      throw new Error(`unexpected import ${name}`);
    },
    window: {}, navigator: { mediaDevices: { getUserMedia: () => {} } },
    WebSocket: FakeWS, AudioContext: FakeCtx, AudioWorkletNode: FakeNode,
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = o && o.type; } },
    URL: { createObjectURL: () => 'blob:worklet', revokeObjectURL: () => {} },
    fetch: (...a) => { fetchCalls.push(a); throw new Error('the local transcription hook must not use fetch'); },
    RTCPeerConnection: function () { throw new Error('the local transcription hook must not use WebRTC'); },
    setTimeout, clearTimeout, console, JSON, Promise, Error,
  };
  sandbox.exports = sandbox.module.exports;
  vm.runInNewContext(out, sandbox, { filename: 'useLocalTranscription.js' });
  return { ...sandbox.module.exports, fetchCalls };
};
const recorder = () => {
  const calls = [];
  const h = {};
  for (const name of ['onSpeechStart', 'onSpeechStop', 'onPartial', 'onFinal', 'onConnectionLost', 'onTranscriptionFailed']) h[name] = (...a) => calls.push([name, ...a]);
  return { h, calls };
};
const micStream = () => { const tracks = [{ enabled: true }]; return { tracks, getAudioTracks: () => tracks }; };
const tick = () => new Promise((r) => setImmediate(r));
const PCM = () => new Int16Array(640).buffer;

// ── message -> callback mapping ───────────────────────────────────────────────────────────────────────────────────
test('local STT messages map to the SAME five callbacks the OpenAI hook offers', opts, () => {
  const { mapLocalSttMessage } = loadHook();
  const { h, calls } = recorder();
  assert.equal(mapLocalSttMessage(JSON.stringify({ type: 'speech_started' }), h), 'speech_started');
  assert.equal(mapLocalSttMessage(JSON.stringify({ type: 'partial', text: '  plants need ' }), h), 'partial');
  assert.equal(mapLocalSttMessage(JSON.stringify({ type: 'speech_stopped' }), h), 'speech_stopped');
  assert.equal(mapLocalSttMessage(JSON.stringify({ type: 'final', text: ' Plants need sunlight. ' }), h), 'final');
  assert.equal(mapLocalSttMessage(JSON.stringify({ type: 'transcription_failed' }), h), 'transcription_failed');
  assert.equal(mapLocalSttMessage(JSON.stringify({ type: 'error', code: 'x' }), h), 'error');
  assert.deepEqual(calls, [
    ['onSpeechStart'], ['onPartial', 'plants need'], ['onSpeechStop'], ['onFinal', 'Plants need sunlight.'],
    ['onTranscriptionFailed'], ['onTranscriptionFailed'],
  ]);
});

test('local STT mapping ignores junk, empty text and unknown types, and never throws when handlers are missing', opts, () => {
  const { mapLocalSttMessage } = loadHook();
  const { h, calls } = recorder();
  for (const junk of ['not json', '[]', 'null', '42', '{"type":"partial","text":"   "}', '{"type":"final"}', '{"type":"final","text":5}', '{"type":"unknown"}', '{}', undefined, null, 7, { type: 'final', text: 'x' }]) {
    assert.equal(mapLocalSttMessage(junk, h), null, String(junk));
  }
  assert.deepEqual(calls, []);
  assert.doesNotThrow(() => { for (const t of ['speech_started', 'speech_stopped', 'error']) mapLocalSttMessage(JSON.stringify({ type: t }), {}); });
  assert.doesNotThrow(() => { for (const t of ['partial', 'final']) mapLocalSttMessage(JSON.stringify({ type: t, text: 'hi' }), {}); });
});

// ── the hook itself ───────────────────────────────────────────────────────────────────────────────────────────────
test('connect: opens ONE WebSocket to the configured local address, handshakes, and sends audio nowhere else', opts, async () => {
  reset();
  const { useLocalTranscription, fetchCalls } = loadHook();
  const { h } = recorder();
  const stt = useLocalTranscription(h);
  await stt.connect(micStream(), { url: 'ws://127.0.0.1:8765', silenceDurationMs: 1400 });
  assert.equal(FakeWS.instances.length, 1);
  const ws = FakeWS.instances[0];
  assert.equal(ws.url, 'ws://127.0.0.1:8765');
  assert.deepEqual(ws.json()[0], { type: 'start', sampleRate: 16000, language: 'en', silenceMs: 1400 });
  assert.equal(FakeCtx.instances[0].sampleRate, 16000, 'the audio context asks for 16 kHz');
  assert.equal(FakeNode.instances[0].name, 'learniq-pcm');
  assert.equal(FakeCtx.instances[0].state, 'running');
  assert.deepEqual(fetchCalls, [], 'no fetch: nothing is sent over HTTP');
});

test('microphone audio is sent only while the interviewer is listening; every turn is announced to the service', opts, async () => {
  reset();
  const { useLocalTranscription } = loadHook();
  const stt = useLocalTranscription(recorder().h);
  const stream = micStream();
  await stt.connect(stream, { url: 'ws://127.0.0.1:8765' });
  const ws = FakeWS.instances[0]; const node = FakeNode.instances[0];
  node.port.onmessage({ data: PCM() });
  assert.equal(ws.binary().length, 0, 'not listening yet: nothing leaves the page');
  stt.setListening(true);
  assert.equal(stream.tracks[0].enabled, true);
  node.port.onmessage({ data: PCM() }); node.port.onmessage({ data: PCM() });
  assert.equal(ws.binary().length, 2);
  stt.setListening(false);
  assert.equal(stream.tracks[0].enabled, false, 'the microphone track is switched off while the avatar speaks');
  node.port.onmessage({ data: PCM() });
  assert.equal(ws.binary().length, 2);
  assert.deepEqual(ws.json().slice(1), [{ type: 'listening', on: true }, { type: 'listening', on: false }]);
  ws.bufferedAmount = 5_000_000; stt.setListening(true);
  node.port.onmessage({ data: PCM() });
  assert.equal(ws.binary().length, 2, 'a stalled socket never piles up audio');
});

test('events from the service reach the page callbacks; a dropped connection is reported once, our own close is not', opts, async () => {
  reset();
  const { useLocalTranscription } = loadHook();
  const { h, calls } = recorder();
  const stt = useLocalTranscription(h);
  await stt.connect(micStream(), { url: 'ws://127.0.0.1:8765' });
  const ws = FakeWS.instances[0];
  ws.emit({ type: 'speech_started' }); ws.emit({ type: 'partial', text: 'hello' }); ws.emit({ type: 'speech_stopped' }); ws.emit({ type: 'final', text: 'hello there' });
  assert.deepEqual(calls.map((c) => c[0]), ['onSpeechStart', 'onPartial', 'onSpeechStop', 'onFinal']);
  ws.serverClose();
  assert.deepEqual(calls.at(-1), ['onConnectionLost', 'channel_closed']);

  reset();
  const second = recorder();
  const stt2 = useLocalTranscription(second.h);
  await stt2.connect(micStream(), { url: 'ws://127.0.0.1:8765' });
  stt2.close();
  FakeWS.instances[0].onclose && FakeWS.instances[0].onclose({});
  assert.equal(FakeWS.instances[0].closed, true);
  assert.deepEqual(second.calls, [], 'closing it ourselves is not a connection problem');
});

test('reconnect replaces the old connection; handshake failures reject with a clear error', opts, async () => {
  reset();
  const { useLocalTranscription } = loadHook();
  const stt = useLocalTranscription(recorder().h);
  await stt.connect(micStream(), { url: 'ws://127.0.0.1:8765' });
  await stt.connect(micStream(), { url: 'ws://127.0.0.1:8765' });
  assert.equal(FakeWS.instances.length, 2);
  assert.equal(FakeWS.instances[0].closed, true, 'the previous connection was torn down');
  assert.equal(FakeCtx.instances[0].closed, true);

  reset(); FakeWS.startReply = { type: 'error', code: 'english_only' };
  await assert.rejects(() => useLocalTranscription(recorder().h).connect(micStream(), { url: 'ws://127.0.0.1:8765' }), /stt_server_english_only/);
  assert.equal(FakeWS.instances[0].closed, true);

  reset(); FakeWS.refuse = true; // service not running
  await assert.rejects(() => useLocalTranscription(recorder().h).connect(micStream(), { url: 'ws://127.0.0.1:8765' }), /stt_connect_(failed|closed)/);
});

test('audio-context fallbacks: no 16 kHz option -> default rate; cannot connect at 16 kHz -> retry at the native rate; suspended -> clear error', opts, async () => {
  reset(); FakeCtx.rejectSampleOption = true;
  let stt = loadHook().useLocalTranscription(recorder().h);
  await stt.connect(micStream(), { url: 'ws://127.0.0.1:8765' });
  assert.equal(FakeCtx.instances[0].sampleRate, 48000);

  reset(); FakeCtx.failSourceAt16k = true;
  stt = loadHook().useLocalTranscription(recorder().h);
  await stt.connect(micStream(), { url: 'ws://127.0.0.1:8765' });
  assert.deepEqual(FakeCtx.instances.map((c) => c.sampleRate), [16000, 48000]);
  assert.equal(FakeCtx.instances[0].closed, true);

  reset(); FakeCtx.stuck = true;
  stt = loadHook().useLocalTranscription(recorder().h);
  await assert.rejects(() => stt.connect(micStream(), { url: 'ws://127.0.0.1:8765' }), /stt_audio_suspended/);
  assert.equal(FakeWS.instances[0].closed, true, 'a failed connect leaves nothing open');
});

// ── the audio worklet (microphone -> 16 kHz PCM) ──────────────────────────────────────────────────────────────────────
const runWorklet = (rate, blocks) => {
  const posted = [];
  let Processor;
  const sandbox = {
    sampleRate: rate, Int16Array, Math,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (buf) => posted.push(new Int16Array(buf)) }; } },
    registerProcessor: (name, cls) => { Processor = cls; },
  };
  vm.runInNewContext(loadHook().WORKLET_SOURCE, sandbox);
  const p = new Processor();
  for (const b of blocks) assert.equal(p.process([[b]]), true);
  const all = []; for (const c of posted) all.push(...c);
  return all;
};
const sine = (rate, seconds, freq, amp) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));
const blocksOf = (arr, n = 128) => { const out = []; for (let i = 0; i + n <= arr.length; i += n) out.push(arr.subarray(i, i + n)); return out; };
const crossings = (arr) => { let c = 0; for (let i = 1; i < arr.length; i += 1) if (arr[i - 1] < 0 && arr[i] >= 0) c += 1; return c; };

test('worklet: a 48 kHz microphone becomes 16 kHz 16-bit PCM with the same pitch and level', opts, () => {
  const out = runWorklet(48000, blocksOf(sine(48000, 1.0, 440, 0.5)));
  assert.ok(Math.abs(out.length - 16000) < 640 + 16, `about 16000 samples, got ${out.length}`);
  const peak = Math.max(...out);
  assert.ok(peak > 0.45 * 32767 && peak < 0.55 * 32767, `level kept (peak ${peak})`);
  assert.ok(Math.abs(crossings(out) - 440) <= 4, `pitch kept (${crossings(out)} cycles for 440 Hz)`);
});

test('worklet: an already-16 kHz microphone is passed through unchanged (and clipped, never wrapped)', opts, () => {
  const out = runWorklet(16000, blocksOf(Float32Array.from({ length: 128 * 10 }, (_, i) => (i % 2 ? 2.5 : -2.5))));
  assert.ok(out.length >= 640 && out.length <= 1280, `about one chunk per 640 samples, got ${out.length}`);
  for (const v of out) assert.ok(v === 32767 || v === -32768, `clipped sample ${v}`);
});

// ── page wiring (source level) ─────────────────────────────────────────────────────────────────────────────────────────
test('the interview page picks the transcription hook from the BACKEND-provided provider; the OpenAI hook is untouched', opts, () => {
  const page = read('pages/student/AIInterviewPage.tsx');
  assert.match(page, /useOpenAITranscription\(sttHandlers\)/);
  assert.match(page, /useLocalTranscription\(sttHandlers\)/);
  assert.match(page, /s\.provider === 'local'/);
  assert.match(page, /stt\.connect\(stream, rt\.stt\)/);
  assert.ok(!/VITE_[A-Z_]*STT/.test(page + read('hooks/useLocalTranscription.ts')), 'the provider is never chosen by a frontend env variable');
  const openai = read('hooks/useOpenAITranscription.ts');
  assert.match(openai, /RTCPeerConnection/);
  assert.match(openai, /creds\.callsUrl/);
  assert.match(openai, /oai-events/);
  assert.ok(!/useLocalTranscription|local-stt/i.test(openai), 'the OpenAI hook knows nothing about the local service');
  const local = read('hooks/useLocalTranscription.ts');
  assert.ok(!/fetch\(|RTCPeerConnection|api\.openai/.test(local), 'the local hook never contacts a remote service');
});

// ── restored setup: OpenAI Realtime is the active speech-to-text path; the local hook must stay out of its way ────────────
test('an idle or closed local hook never touches the shared microphone tracks (the OpenAI hook owns them while it is the active path)', opts, async () => {
  reset();
  const { useLocalTranscription } = loadHook();
  // never connected (exactly what happens while the page uses OpenAI Realtime): no WebSocket, no audio context, nothing touched
  const idle = useLocalTranscription(recorder().h);
  const mic = micStream();
  idle.setListening(true); idle.setListening(false); idle.close();
  assert.equal(FakeWS.instances.length, 0, 'no connection to the local service is ever opened');
  assert.equal(FakeCtx.instances.length, 0);
  assert.equal(mic.tracks[0].enabled, true);

  // after a real connection has been closed, late setListening() calls must not mute / unmute the tracks any more
  const stt = useLocalTranscription(recorder().h);
  await stt.connect(mic, { url: 'ws://127.0.0.1:8765' });
  assert.equal(mic.tracks[0].enabled, false, 'while connected the tracks follow the listening state');
  stt.setListening(true);
  assert.equal(mic.tracks[0].enabled, true);
  stt.close();
  mic.tracks[0].enabled = true;              // another owner (the OpenAI hook) switches the microphone on
  stt.setListening(false);                   // the page always calls both hooks; this must now be a no-op for the stream
  stt.setListening(true); stt.setListening(false);
  assert.equal(mic.tracks[0].enabled, true, 'the closed local hook does not touch the microphone tracks');
});

test('the page uses OpenAI Realtime whenever the backend does not say "local" (provider "openai" or absent); only the exact "local" opens the local service', opts, () => {
  const page = read('pages/student/AIInterviewPage.tsx');
  // the one place where the provider is decided
  const m = page.match(/connect: async \(stream: MediaStream, s: AIInterviewSttSession\) => \{([\s\S]*?)\n    \},/);
  assert.ok(m, 'stt.connect(...) not found in the page');
  const body = m[1];
  assert.match(body, /^\s*if \(s\.provider === 'local'\) \{\s*sttOpenAI\.close\(\);\s*await sttLocal\.connect\(stream, \{ url: s\.url, silenceDurationMs: s\.silenceDurationMs \}\);\s*\} else \{\s*sttLocal\.close\(\);\s*await sttOpenAI\.connect\(stream, \{ clientSecret: s\.clientSecret, callsUrl: s\.callsUrl \}\);\s*\}\s*$/);
  assert.equal(/provider\s*(===|!==|==|!=)\s*'openai'/.test(page), false, 'the OpenAI path is the default branch, not a condition that could be missed');
  // the same page code drives both hooks: listening state and teardown reach the OpenAI hook exactly as before
  assert.match(page, /setListening: \(on: boolean\) => \{ sttOpenAI\.setListening\(on\); sttLocal\.setListening\(on\); \}/);
  assert.match(page, /close: \(\) => \{ sttOpenAI\.close\(\); sttLocal\.close\(\); \}/);
  // the OpenAI hook receives the page's own handlers (partial / final / speech start / connection lost / failed turn)
  assert.match(page, /const sttHandlers = \{[\s\S]*onSpeechStart[\s\S]*onPartial[\s\S]*onFinal[\s\S]*onConnectionLost[\s\S]*onTranscriptionFailed[\s\S]*\};\s*const sttOpenAI = useOpenAITranscription\(sttHandlers\);/);
  // the shared types: provider "openai" (or none) carries a client secret, "local" carries an address
  const types = read('types/aiInterview.ts');
  assert.match(types, /\{ provider\?: 'openai'; clientSecret: string; expiresAt: number; model: string; language: string; callsUrl: string \}/);
  assert.match(types, /\{ provider: 'local'; url: string;/);
  // no frontend env variable can change the choice, and the OpenAI hook never mentions the local service
  assert.ok(!/VITE_[A-Z_]*STT/.test(page + types), 'the provider is never chosen by a frontend env variable');
  assert.ok(!/local-stt|useLocalTranscription|127\.0\.0\.1|8765/i.test(read('hooks/useOpenAITranscription.ts')));
});

// ── "I'm done answering" with the local service ───────────────────────────────────────────────────────────────────
test('commit ("I\'m done"): sent only while listening AND while the service reports speech; otherwise false so the page moves on at once', opts, async () => {
  reset();
  const { useLocalTranscription } = loadHook();
  const stt = useLocalTranscription(recorder().h);
  await stt.connect(micStream(), { url: 'ws://127.0.0.1:8765' });
  const ws = FakeWS.instances[0];
  assert.equal(stt.commit(), false, 'not listening yet');
  stt.setListening(true);
  assert.equal(stt.commit(), false, 'listening, but nobody is speaking');
  ws.emit({ type: 'speech_started' });
  assert.equal(stt.commit(), true);
  assert.deepEqual(ws.json().filter((m) => m.type === 'commit'), [{ type: 'commit' }]);
  ws.emit({ type: 'speech_stopped' });
  assert.equal(stt.commit(), false, 'the turn already ended');
  ws.emit({ type: 'speech_started' });
  stt.setListening(false);
  assert.equal(stt.commit(), false, 'a new listening state starts clean');
  stt.close();
  assert.equal(stt.commit(), false);
});
