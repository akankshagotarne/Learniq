/**
 * Unit tests for the camera/microphone acquisition pool used by the interview room (application logic with controlled fake
 * devices - it cannot prove behaviour on physical webcams; the real-browser/WebRTC checks are in e2e/real-media).
 *   npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaPool, InterviewMediaError, mediaProblemMessage, type MediaEnv } from '../src/services/interviewMedia.ts';

const track = (kind: string) => ({ kind, readyState: 'live', stopped: false, stop() { this.stopped = true; this.readyState = 'ended'; } });
const stream = () => { const t = [track('video'), track('audio')]; return { tracks: t, getTracks: () => t, getVideoTracks: () => t.filter((x) => x.kind === 'video'), getAudioTracks: () => t.filter((x) => x.kind === 'audio') } as any; };
const err = (name: string) => Object.assign(new Error(name), { name });
const devices = (cam = true, mic = true) => async () => [...(cam ? [{ kind: 'videoinput' }] : []), ...(mic ? [{ kind: 'audioinput' }] : [])];

interface Ctl { calls: any[]; resolve: (s?: any) => void; reject: (e: any) => void }
/** getUserMedia whose result the test controls; `behave` decides per call (kind-specific probes included) */
const makeEnv = (behave?: (c: any, i: number) => Promise<any> | undefined, extra: Partial<MediaEnv> = {}) => {
  const ctl: Ctl = { calls: [], resolve: () => {}, reject: () => {} };
  let n = 0;
  const env: MediaEnv = {
    secure: true, supported: true, enumerateDevices: devices(),
    getUserMedia: (c) => {
      const i = n++; ctl.calls.push(c);
      const custom = behave?.(c, i); if (custom) return custom;
      return new Promise((res, rej) => { ctl.resolve = (s) => res(s ?? stream()); ctl.reject = rej; });
    },
    ...extra,
  };
  return { env, ctl };
};
const pool = (env: MediaEnv) => createMediaPool(() => env);
const rejects = async (p: Promise<any>) => { try { await p; } catch (e) { return e as InterviewMediaError; } assert.fail('expected rejection'); };

test('1/2 camera + microphone granted: resolves one live stream with both tracks', async () => {
  const s = stream(); const { env } = makeEnv(() => Promise.resolve(s));
  const got = await pool(env).acquire().promise;
  assert.equal(got, s); assert.equal(got.getVideoTracks().length, 1); assert.equal(got.getAudioTracks().length, 1);
});

test('3 camera permission denied -> camera-specific problem (the microphone probe succeeds)', async () => {
  const { env } = makeEnv((c) => (c.video === true && !c.audio ? Promise.reject(err('NotAllowedError')) : c.audio === true && !c.video ? Promise.resolve(stream()) : Promise.reject(err('NotAllowedError'))));
  const e = await rejects(pool(env).acquire().promise);
  assert.deepEqual(e.problem, { code: 'denied', device: 'camera' });
  assert.match(mediaProblemMessage(e.problem), /Unable to access your camera/);
});

test('4 microphone permission denied -> microphone-specific problem', async () => {
  const { env } = makeEnv((c) => (c.audio === true && !c.video ? Promise.reject(err('NotAllowedError')) : c.video === true && !c.audio ? Promise.resolve(stream()) : Promise.reject(err('NotAllowedError'))));
  const e = await rejects(pool(env).acquire().promise);
  assert.deepEqual(e.problem, { code: 'denied', device: 'microphone' });
  assert.match(mediaProblemMessage(e.problem), /microphone/);
});

test('5/6 no camera / no microphone: known immediately from enumerateDevices, getUserMedia is never called', async () => {
  for (const [cam, mic, device] of [[false, true, 'camera'], [true, false, 'microphone'], [false, false, 'both']] as const) {
    const { env, ctl } = makeEnv(undefined, { enumerateDevices: devices(cam, mic) });
    const e = await rejects(pool(env).acquire().promise);
    assert.deepEqual(e.problem, { code: 'no-device', device });
    assert.equal(ctl.calls.length, 0);
  }
});

test('7 device already in use -> busy, no retry loop (exactly the combined call + one probe per device)', async () => {
  const { env, ctl } = makeEnv(() => Promise.reject(err('NotReadableError')));
  const e = await rejects(pool(env).acquire().promise);
  assert.deepEqual(e.problem, { code: 'busy', device: 'both' });
  assert.equal(ctl.calls.length, 3);
});

test('7b a failure with no identifiable device is reported as a generic failure, not a crash', async () => {
  let n = 0; const { env } = makeEnv((c) => (n++ === 0 ? Promise.reject(err('WeirdError')) : Promise.resolve(stream())));
  const e = await rejects(pool(env).acquire().promise);
  assert.deepEqual(e.problem, { code: 'failed', device: 'unknown' });
});

test('8 media initialisation timeout: a never-resolving getUserMedia ends in a defined error and shows the permission hint first', async () => {
  const { env } = makeEnv(); let hinted = 0;
  const lease = pool(env).acquire({ promptAfterMs: 20, timeoutMs: 80, onAwaitingPermission: () => { hinted += 1; } });
  const e = await rejects(lease.promise);
  assert.deepEqual(e.problem, { code: 'timeout', device: 'unknown' }); assert.equal(hinted, 1);
  assert.match(mediaProblemMessage(e.problem), /did not respond in time/);
});

test('unsupported / insecure browsers are reported without touching the devices', async () => {
  const a = makeEnv(undefined, { supported: false }); const b = makeEnv(undefined, { secure: false });
  assert.equal((await rejects(pool(a.env).acquire().promise)).problem.code, 'unsupported');
  assert.equal((await rejects(pool(b.env).acquire().promise)).problem.code, 'insecure');
  assert.equal(a.ctl.calls.length + b.ctl.calls.length, 0);
});

test('12 duplicate initialisation: concurrent leases share ONE getUserMedia (no concurrent opens of the camera)', async () => {
  const { env, ctl } = makeEnv(); const p = pool(env);
  const a = p.acquire(); const b = p.acquire(); const c = p.acquire();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ctl.calls.length, 1); ctl.resolve();
  const [sa, sb, sc] = await Promise.all([a.promise, b.promise, c.promise]);
  assert.ok(sa === sb && sb === sc);
});

test('13/14 a holder that leaves while the browser is still asking: stream is stopped on arrival; no leaked camera', async () => {
  const { env, ctl } = makeEnv(); const p = pool(env);
  const lease = p.acquire(); await new Promise((r) => setTimeout(r, 10));
  lease.release();                                   // component unmounted during initialisation
  const s = stream(); ctl.resolve(s); await new Promise((r) => setTimeout(r, 10));
  assert.ok(s.tracks.every((t: any) => t.stopped), 'late stream must be stopped');
});

test('Strict-Mode style remount during a pending request: the second holder reuses the SAME request and keeps the stream', async () => {
  const { env, ctl } = makeEnv(); const p = pool(env);
  const first = p.acquire(); await new Promise((r) => setTimeout(r, 10));
  first.release();                                   // effect cleanup
  const second = p.acquire(); await new Promise((r) => setTimeout(r, 10));   // effect re-run
  assert.equal(ctl.calls.length, 1, 'no second concurrent getUserMedia');
  const s = stream(); ctl.resolve(s);
  assert.equal(await second.promise, s);
  assert.ok(s.tracks.every((t: any) => !t.stopped), 'the live holder still has its camera');
});

test('15 repeated page entry and exit: every cycle releases its tracks; nothing is left running', async () => {
  const made: any[] = []; const { env } = makeEnv(() => { const s = stream(); made.push(s); return Promise.resolve(s); }); const p = pool(env);
  for (let i = 0; i < 25; i++) { const l = p.acquire(); await l.promise; l.release(); l.release(); /* double release is harmless */ }
  assert.equal(made.length, 25);
  assert.ok(made.every((s) => s.tracks.every((t: any) => t.stopped)), 'all tracks stopped after each exit');
});

test('releasing one holder does not stop a stream another holder still uses (two interview pages in one tab)', async () => {
  const s = stream(); const { env } = makeEnv(() => Promise.resolve(s)); const p = pool(env);
  const a = p.acquire(); const b = p.acquire(); await Promise.all([a.promise, b.promise]);
  a.release(); assert.ok(s.tracks.every((t: any) => !t.stopped));
  b.release(); assert.ok(s.tracks.every((t: any) => t.stopped));
});

test('an unplugged device (ended tracks) is not handed to the next holder: a new request is made', async () => {
  const made: any[] = []; const { env, ctl } = makeEnv(() => { const s = stream(); made.push(s); return Promise.resolve(s); }); const p = pool(env);
  const a = p.acquire(); const s1 = await a.promise;
  s1.tracks.forEach((t: any) => { t.readyState = 'ended'; });
  const b = p.acquire(); const s2 = await b.promise;
  assert.notEqual(s1, s2); assert.equal(ctl.calls.length, 2);
});

test('after a timeout "Try again" opens a FRESH request (the hung one is not reused) and a late stream from the hung one is stopped', async () => {
  const calls: any[] = []; const { env } = makeEnv((c) => { const i = calls.length; calls.push(c); if (i === 0) return new Promise((res) => { (calls as any).late = res; }); return Promise.resolve(stream()); });
  const p = pool(env);
  const first = p.acquire({ timeoutMs: 40 }); await rejects(first.promise);
  const second = p.acquire(); const s = await second.promise;
  assert.equal(calls.length, 2); assert.ok(s.tracks.every((t: any) => !t.stopped));
  const late = stream(); (calls as any).late(late); await new Promise((r) => setTimeout(r, 10));
  assert.ok(late.tracks.every((t: any) => t.stopped), 'the stream that arrived for the abandoned request is stopped');
  assert.ok(s.tracks.every((t: any) => !t.stopped), 'the new holder keeps its own stream');
});
