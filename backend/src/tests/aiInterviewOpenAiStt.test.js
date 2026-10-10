/**
 * AI Interview — OpenAI Realtime speech-to-text: browser side. Run with:  npm run test:aiinterview
 *
 * The real hooks (frontend/src/hooks/useOpenAITranscription.ts and sttDiagnostics.ts) are compiled with the frontend's own
 * TypeScript and executed with a fake RTCPeerConnection / data channel / microphone. No browser, no network, no OpenAI.
 * (The real-browser WebRTC check lives in the project's manual test notes: docs/AI_INTERVIEW.md, "speech-to-text troubleshooting".)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FE = path.join(__dirname, '..', '..', '..', 'frontend');
const HOOKS = path.join(FE, 'src', 'hooks');
const tsPath = path.join(FE, 'node_modules', 'typescript');
const can = fs.existsSync(path.join(HOOKS, 'useOpenAITranscription.ts')) && fs.existsSync(tsPath);
const opts = { skip: can ? false : 'frontend sources / node_modules are not next to the backend in this checkout' };

const SECRET = 'ek_test_SECRET_VALUE_must_never_be_logged';

class FakeTrack {
  constructor(label = 'Test Microphone') { this.kind = 'audio'; this.enabled = true; this.muted = false; this.readyState = 'live'; this.label = label; }
}
class FakeDC {
  constructor() { this.readyState = 'open'; this.closed = false; this.sent = []; }
  send(d) { this.sent.push(JSON.parse(d)); }
  close() { this.closed = true; this.readyState = 'closed'; if (this.onclose) this.onclose(); }
}
class FakePC {
  constructor() {
    FakePC.instances.push(this);
    this.senders = []; this.dc = null;
    this.connectionState = 'new'; this.iceConnectionState = 'new'; this.signalingState = 'stable';
  }
  addTrack(track) { const s = { track }; this.senders.push(s); return s; }
  getSenders() { return this.senders; }
  createDataChannel() { this.dc = new FakeDC(); return this.dc; }
  async createOffer() { return { type: 'offer', sdp: 'v=0 fake offer' }; }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async getStats() { return new Map([['a', { type: 'outbound-rtp', kind: 'audio', packetsSent: 10, bytesSent: 800 }], ['b', { type: 'media-source', kind: 'audio', audioLevel: 0.2 }]]); }
  close() { this.closed = true; }
}
FakePC.instances = [];

const makeEnv = (extraWindow = {}, callsStatus = 201, callsBody = 'v=0 fake answer', fetchImpl = null) => {
  const ts = require(tsPath);
  const compile = (f) => ts.transpileModule(fs.readFileSync(path.join(HOOKS, f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const infos = [];
  const store = {};
  const fetchCalls = [];
  const win = {
    location: { search: '' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    RTCPeerConnection: FakePC,
    ...extraWindow,
  };
  const sandbox = {
    window: win, navigator: { mediaDevices: { getUserMedia: () => {} } }, RTCPeerConnection: FakePC,
    URLSearchParams, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Promise, Error, Date, Map, AbortController,
    console: { info: (...a) => infos.push(a), log() {}, warn() {}, error() {} },
    fetch: async (url, init) => { fetchCalls.push([url, init]); if (fetchImpl) return fetchImpl(url, init); return { ok: callsStatus < 300, status: callsStatus, text: async () => callsBody }; },
  };
  const modules = {};
  const load = (file) => {
    const m = { exports: {} };
    const sb = Object.assign({}, sandbox, {
      module: m, exports: m.exports,
      require: (name) => {
        if (name === 'react') return { useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }) };
        if (name === './sttDiagnostics') return modules.diag;
        throw new Error(`unexpected import ${name}`);
      },
    });
    vm.runInNewContext(compile(file), sb, { filename: file });
    return m.exports;
  };
  modules.diag = load('sttDiagnostics.ts');
  const hook = load('useOpenAITranscription.ts');
  return { ...hook, diag: modules.diag, infos, store, win, fetchCalls };
};

const recorder = () => {
  const calls = [];
  const h = {};
  for (const n of ['onSpeechStart', 'onSpeechStop', 'onPartial', 'onFinal', 'onConnectionLost', 'onTranscriptionFailed']) h[n] = (...a) => calls.push([n, ...a]);
  return { h, calls };
};
const micStream = (n = 1) => { const tracks = Array.from({ length: n }, () => new FakeTrack()); return { tracks, getAudioTracks: () => tracks }; };
const CREDS = { clientSecret: SECRET, callsUrl: 'https://api.openai.test/v1/realtime/calls' };
const send = (pc, ev) => pc.dc.onmessage({ data: JSON.stringify(ev) });
const connected = async (env, handlers, stream = micStream()) => {
  FakePC.instances = [];
  const hook = env.useOpenAITranscription(handlers);
  await hook.connect(stream, CREDS);
  return { hook, pc: FakePC.instances[0], stream };
};

test('OpenAI hook: connect posts the SDP offer to the calls URL with the short-lived secret, over the oai-events channel', opts, async () => {
  const env = makeEnv();
  const { pc, stream } = await connected(env, recorder().h);
  assert.equal(env.fetchCalls.length, 1);
  const [url, init] = env.fetchCalls[0];
  assert.equal(url, CREDS.callsUrl);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/sdp');
  assert.equal(init.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(init.body, 'v=0 fake offer');
  assert.equal(pc.senders.length, 1);
  assert.equal(pc.senders[0].track, stream.tracks[0]);
});

test('OpenAI hook: the microphone track AND the peer-connection sender track are on only while the interviewer is listening', opts, async () => {
  const env = makeEnv();
  const { hook, pc, stream } = await connected(env, recorder().h);
  const track = stream.tracks[0];
  assert.equal(track.enabled, false, 'muted from the moment it is attached (the avatar must not be transcribed)');
  assert.equal(pc.senders[0].track.enabled, false);
  hook.setListening(true);
  assert.equal(track.enabled, true);
  assert.equal(pc.senders[0].track.enabled, true);
  hook.setListening(false);
  assert.equal(track.enabled, false);
  assert.equal(pc.senders[0].track.enabled, false);
  // a sender that carries a DIFFERENT (cloned) track object is kept in step too
  const clone = new FakeTrack(); clone.enabled = false;
  pc.senders[0].track = clone;
  hook.setListening(true);
  assert.equal(clone.enabled, true);
});

test('OpenAI hook: with no live microphone track it refuses to connect (no peer connection, no request, no secret use)', opts, async () => {
  const env = makeEnv();
  FakePC.instances = [];
  const hook = env.useOpenAITranscription(recorder().h);
  await assert.rejects(() => hook.connect({ getAudioTracks: () => [] }, CREDS), /stt_no_microphone_track/);
  const ended = micStream(); ended.tracks[0].readyState = 'ended';
  await assert.rejects(() => hook.connect(ended, CREDS), /stt_no_microphone_track/);
  assert.equal(FakePC.instances.length, 0);
  assert.equal(env.fetchCalls.length, 0);
});

test('OpenAI hook: a rejected /calls request surfaces its HTTP status', opts, async () => {
  const env = makeEnv({}, 401);
  const hook = env.useOpenAITranscription(recorder().h);
  await assert.rejects(() => hook.connect(micStream(), CREDS), /stt_connect_401/);
});

test('OpenAI hook: speech events map one-to-one onto the handlers (partial accumulates, final is trimmed, empty is ignored)', opts, async () => {
  const env = makeEnv();
  const r = recorder();
  const { pc } = await connected(env, r.h);
  send(pc, { type: 'input_audio_buffer.speech_started' });
  send(pc, { type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: 'Tw' });
  send(pc, { type: 'conversation.item.input_audio_transcription.delta', item_id: 'i1', delta: 'o' });
  send(pc, { type: 'input_audio_buffer.speech_stopped' });
  send(pc, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'i1', transcript: '  Two.  ' });
  send(pc, { type: 'conversation.item.input_audio_transcription.completed', item_id: 'i2', transcript: '   ' });
  assert.deepEqual(r.calls.map((c) => c[0]), ['onSpeechStart', 'onPartial', 'onPartial', 'onSpeechStop', 'onFinal']);
  assert.deepEqual(r.calls[2].slice(1), ['Two']);
  assert.deepEqual(r.calls[4].slice(1), ['Two.']);
});

test('OpenAI hook: a failed transcription / error event reaches the page WITH the provider error code (insufficient_quota) and nothing else', opts, async () => {
  const env = makeEnv();
  const r = recorder();
  const { pc } = await connected(env, r.h);
  send(pc, { type: 'conversation.item.input_audio_transcription.failed', item_id: 'i1', error: { type: 'invalid_request_error', code: 'insufficient_quota', message: 'You exceeded your current quota', event_id: 'evt_secret_1', param: 'x' } });
  send(pc, { type: 'error', error: { type: 'server_error', message: 'boom' } });
  send(pc, { type: 'error' });
  assert.equal(r.calls.length, 3);
  assert.deepEqual(r.calls.map((c) => c[0]), ['onTranscriptionFailed', 'onTranscriptionFailed', 'onTranscriptionFailed']);
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls[0][1])), { type: 'invalid_request_error', code: 'insufficient_quota', message: 'You exceeded your current quota' });
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls[1][1])), { type: 'server_error', message: 'boom' });
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls[2][1])), {});
  assert.equal(env.diag.errorCodeForServer(r.calls[0][1]), 'insufficient_quota');
  assert.equal(env.diag.errorCodeForServer({ message: 'x' }), undefined);
  assert.equal(env.diag.errorCodeForServer({ code: 'has spaces' }), undefined);
  assert.equal(env.diag.errorCodeForServer({ code: 'a'.repeat(65) }), undefined);
});

test('diagnostics: completely silent unless switched on, and they never print the client secret', opts, async () => {
  const quiet = makeEnv();
  await connected(quiet, recorder().h);
  assert.equal(quiet.infos.length, 0, 'nothing is logged by default');
  assert.equal(quiet.win.__learniqStt, undefined);

  const loud = makeEnv();
  loud.store.learniq_stt_debug = '1';
  const r = recorder();
  const { hook, pc } = await connected(loud, r.h);
  hook.setListening(true);
  send(pc, { type: 'input_audio_buffer.speech_started' });
  send(pc, { type: 'conversation.item.input_audio_transcription.failed', error: { code: 'insufficient_quota', message: 'quota' } });
  hook.close();
  assert.ok(loud.infos.length >= 4, 'it logs connect / listening / events / the failure when switched on');
  const everything = JSON.stringify(loud.infos) + JSON.stringify(loud.win.__learniqStt);
  assert.ok(!everything.includes(SECRET), 'the client secret is never logged');
  assert.ok(!/Bearer/.test(everything));
  assert.ok(everything.includes('insufficient_quota'));
  assert.equal(loud.win.__learniqStt.events['input_audio_buffer.speech_started'], 1);
});

test('diagnostics: the monitor reports packets / bytes / level and warns when the track is disabled while listening, or nothing is sent', opts, async () => {
  const env = makeEnv();
  env.store.learniq_stt_debug = '1';
  const pc = new FakePC();
  const stream = micStream();
  pc.addTrack(stream.tracks[0]);
  stream.tracks[0].enabled = false;
  const stop = env.diag.startSttMonitor(() => ({ pc, dc: { readyState: 'open' }, stream, listening: true }), 5);
  await new Promise((r) => setTimeout(r, 60));
  stop();
  const lines = env.win.__learniqStt.log.map((l) => l[1] + ' ' + l[2]);
  assert.ok(lines.some((l) => l.startsWith('status') && l.includes('"packetsSent":10') && l.includes('"bytesSent":800') && l.includes('"micLevel":0.2')), 'a status line has packets, bytes and level');
  assert.ok(lines.some((l) => l.includes('WARNING the microphone track is DISABLED')), 'disabled track while listening is flagged');
  assert.ok(lines.some((l) => l.includes('WARNING no audio packets')), 'a stalled sender is flagged');
});


// ── rebuilt hook: precise errors, turn control, provider notices ─────────────────────────────────────────────────────────
test('OpenAI hook: a refused /calls carries OpenAI\'s own reason (code / type / message) and never reports a "lost connection" too', opts, async () => {
  const body = JSON.stringify({ error: { type: 'invalid_request_error', code: 'insufficient_quota', message: 'You exceeded your current quota', param: null } });
  const env = makeEnv({}, 429, body);
  const r = recorder();
  FakePC.instances = [];
  const hook = env.useOpenAITranscription(r.h);
  const err = await hook.connect(micStream(), CREDS).then(() => null, (e) => e);
  assert.ok(err, 'connect must fail');
  assert.equal(err.message, 'stt_connect_429');
  assert.equal(err.code, 'stt_connect_429');
  assert.equal(err.status, 429);
  assert.deepEqual(JSON.parse(JSON.stringify(err.detail)), { type: 'invalid_request_error', code: 'insufficient_quota', message: 'You exceeded your current quota' });
  assert.equal(FakePC.instances[0].closed, true, 'the half-open peer connection is closed');
  FakePC.instances[0].dc.close(); // its data channel closing afterwards must not look like a dropped live connection
  assert.equal(r.calls.filter((c) => c[0] === 'onConnectionLost').length, 0);
});

test('OpenAI hook: an unreachable OpenAI is "stt_connect_network" (a real network failure), a stalled one "stt_connect_timeout"', opts, async () => {
  const net = makeEnv({}, 201, '', async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(() => net.useOpenAITranscription(recorder().h).connect(micStream(), CREDS), /^Error: stt_connect_network$/);
  const slow = makeEnv({}, 201, '', async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  await assert.rejects(() => slow.useOpenAITranscription(recorder().h).connect(micStream(), CREDS), /stt_connect_timeout/);
});

test('OpenAI hook: a new listening turn clears stale audio; "I\'m done" commits the buffer; both go over the data channel', opts, async () => {
  const env = makeEnv();
  const { hook, pc } = await connected(env, recorder().h);
  hook.setListening(true);
  hook.setListening(true); // already listening: no second clear
  assert.deepEqual(pc.dc.sent, [{ type: 'input_audio_buffer.clear' }]);
  assert.equal(hook.commit(), true);
  assert.deepEqual(pc.dc.sent[1], { type: 'input_audio_buffer.commit' });
  hook.setListening(false);
  assert.equal(pc.dc.sent.length, 2, 'stopping to listen sends nothing');
  pc.dc.readyState = 'closing';
  assert.equal(hook.commit(), false, 'never sends on a channel that is not open');
});

test('OpenAI hook: an empty-commit notice is ignored, a session-ending error is a lost connection (reconnect), other errors a failed turn', opts, async () => {
  const env = makeEnv();
  const r = recorder();
  const { pc } = await connected(env, r.h);
  send(pc, { type: 'error', error: { type: 'invalid_request_error', code: 'input_audio_buffer_commit_empty', message: 'buffer too small' } });
  assert.equal(r.calls.length, 0);
  send(pc, { type: 'error', error: { type: 'invalid_request_error', code: 'session_expired', message: 'Your session hit the maximum duration' } });
  assert.deepEqual(r.calls.map((c) => c[0]), ['onConnectionLost']);
  assert.equal(r.calls[0][1], 'provider_session_expired');
});

test('OpenAI hook: the snapshot shows the session config OpenAI applied, the last event / error and the real RTP counters (no secret)', opts, async () => {
  const env = makeEnv();
  const { hook, pc } = await connected(env, recorder().h);
  send(pc, { type: 'session.created', session: { type: 'transcription', audio: { input: { format: { type: 'audio/pcm', rate: 24000 }, transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' }, turn_detection: { type: 'server_vad' } } } } });
  send(pc, { type: 'conversation.item.input_audio_transcription.failed', error: { code: 'rate_limit_exceeded', message: 'slow down' } });
  const snap = await hook.snapshot();
  assert.equal(snap.session, 'type=transcription model=gpt-4o-mini-transcribe lang=en vad=server_vad format=audio/pcm');
  assert.equal(snap.lastEvent, 'conversation.item.input_audio_transcription.failed');
  assert.equal(snap.lastError, 'rate_limit_exceeded / slow down');
  assert.equal(snap.packetsSent, 10);
  assert.equal(snap.bytesSent, 800);
  assert.equal(snap.micLevel, 0.2);
  assert.equal(snap.senderIsMic, true);
  assert.ok(!JSON.stringify(snap).includes(SECRET));
});

// ── the page's error wording: only a real network failure is a "network problem" ───────────────────────────────────────
const loadService = () => {
  const ts = require(tsPath);
  const src = fs.readFileSync(path.join(FE, 'src', 'services', 'aiInterview.ts'), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(out, { module: m, exports: m.exports, require: (n) => (n === './api' ? { default: {} } : {}), String, RegExp, Object }, { filename: 'aiInterview.ts' });
  return m.exports;
};

test('error wording: STT, avatar, timeout and server errors are never called a "network problem"; a real network failure is', opts, () => {
  const { describeInterviewError, aiInterviewErrorMessage } = loadService();
  const NET = /Network problem/;
  // the exact failure behind the reported screenshot: the local STT WebSocket could not be opened
  const local = describeInterviewError(new Error('stt_connect_failed'));
  assert.equal(local.kind, 'stt');
  assert.doesNotMatch(local.message, NET);
  assert.match(local.message, /local speech-to-text/i);
  const quota = describeInterviewError(Object.assign(new Error('stt_connect_429'), { code: 'stt_connect_429', detail: { code: 'insufficient_quota' } }));
  assert.equal(quota.kind, 'stt');
  assert.match(quota.technical, /insufficient_quota/);
  assert.equal(describeInterviewError(Object.assign(new Error('stt_connect_401'), { code: 'stt_connect_401' })).kind, 'stt');
  assert.equal(describeInterviewError(new Error('stt_channel_timeout')).kind, 'stt');
  assert.equal(describeInterviewError(Object.assign(new Error('avatar_start_failed'), { code: 'avatar_start_failed', part: 'avatar' })).kind, 'avatar');
  assert.doesNotMatch(aiInterviewErrorMessage(new Error('avatar_stream_timeout')), NET);
  assert.doesNotMatch(aiInterviewErrorMessage(new Error('something odd')), NET);
  const timeout = describeInterviewError({ isAxiosError: true, code: 'ECONNABORTED', config: { url: '/ai-interviews/x/answer' } });
  assert.equal(timeout.kind, 'timeout');
  assert.doesNotMatch(timeout.message, NET);
  const server = describeInterviewError({ isAxiosError: true, response: { status: 502, data: { code: 'AI_UNAVAILABLE', message: 'The AI interviewer is having trouble. Please try again.', debug: { provider: 'ollama', providerCode: 'NETWORK', detail: 'ECONNREFUSED' } } } });
  assert.equal(server.kind, 'server');
  assert.equal(server.message, 'The AI interviewer is having trouble. Please try again.');
  assert.match(server.technical, /AI_UNAVAILABLE · HTTP 502 · provider=ollama providerCode=NETWORK detail=ECONNREFUSED/);
  const net = describeInterviewError({ isAxiosError: true, code: 'ERR_NETWORK', config: { url: '/ai-interviews/start' } });
  assert.equal(net.kind, 'network');
  assert.match(net.message, NET);
});

test('page: an ACCOUNT problem at the speech provider (no credit / quota / bad key) stops the interview with the real reason; a one-off failed turn does not', opts, () => {
  const page = fs.readFileSync(path.join(FE, 'src', 'pages', 'student', 'AIInterviewPage.tsx'), 'utf8');
  const m = page.match(/const PROVIDER_ACCOUNT_ERRORS = (\/.*\/i);/);
  assert.ok(m, 'PROVIDER_ACCOUNT_ERRORS not found');
  const re = vm.runInNewContext(m[1]);
  // the exact event OpenAI sent in the real browser test: code credit_balance_exhausted, type insufficient_quota
  assert.ok(re.test('credit_balance_exhausted insufficient_quota You have no credits remaining.'));
  assert.ok(re.test('insufficient_quota'));
  assert.ok(re.test('invalid_api_key'));
  assert.ok(!re.test('server_error boom'), 'a transient provider error is only a failed turn');
  assert.ok(!re.test('rate_limit_exceeded'), 'a rate limit is only a failed turn');
  assert.match(page, /This is not a problem with your microphone, and nothing has been used up/);
  // and the hook does not turn an account problem into a reconnect loop
  const hook = fs.readFileSync(path.join(HOOKS, 'useOpenAITranscription.ts'), 'utf8');
  assert.match(hook, /const FATAL_CODES = new Set\(\['session_expired', 'session_closed'\]\);/);
});

test('OpenAI hook: no credit (credit_balance_exhausted / insufficient_quota) reaches the page as a failed turn with the code, never as a lost connection', opts, async () => {
  const env = makeEnv();
  const r = recorder();
  const { pc } = await connected(env, r.h);
  send(pc, { type: 'conversation.item.input_audio_transcription.failed', item_id: 'i1', error: { type: 'insufficient_quota', code: 'credit_balance_exhausted', message: 'You have no credits remaining.' } });
  assert.deepEqual(r.calls.map((c) => c[0]), ['onTranscriptionFailed']);
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls[0][1])), { type: 'insufficient_quota', code: 'credit_balance_exhausted', message: 'You have no credits remaining.' });
});
