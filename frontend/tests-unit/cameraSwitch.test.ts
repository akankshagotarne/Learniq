/**
 * Unit tests for camera switching in the interview room (logic with controlled fake devices - it cannot prove behaviour on
 * physical phones; the real-browser WebRTC check is e2e/real-media/interview-switch-camera.spec.ts).
 *   npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { switchCamera, planNextCamera, facingOf, classifySwitchError, cameraSwitchMessage, constraintsFor, CameraSwitchError, type CameraEnv, type TrackLike } from '../src/services/cameraSwitch.ts';

const mkTrack = (deviceId: string, facingMode?: string, label = ''): TrackLike & { stopped: boolean } => {
  const t: any = { readyState: 'live', enabled: true, label, onended: () => {}, stopped: false,
    getSettings: () => ({ deviceId, ...(facingMode ? { facingMode } : {}) }),
    stop() { t.stopped = true; t.readyState = 'ended'; } };
  return t;
};
const err = (name: string) => Object.assign(new Error(name), { name });
const dev = (ids: string[]) => ids.map((id) => ({ kind: 'videoinput', deviceId: id, label: id }));

/** env whose getUserMedia is scripted per call; records every constraint it was asked for */
const makeEnv = (ids: string[], script: (c: any, n: number) => Promise<any>) => {
  const calls: any[] = []; const opened: ReturnType<typeof mkTrack>[] = [];
  const env: CameraEnv = {
    enumerateDevices: async () => [...dev(ids), { kind: 'audioinput', deviceId: 'mic', label: 'mic' }],
    getUserMedia: async (c) => { calls.push(c); const r = await script(c, calls.length - 1); return r; },
  };
  return { env, calls, opened };
};
const streamOf = (t: any) => ({ getVideoTracks: () => [t], getTracks: () => [t] });
const harness = (current: TrackLike) => {
  const log = { replaced: [] as any[], committed: [] as any[] };
  return { log, replace: async (n: TrackLike) => { log.replaced.push(n); }, commit: (n: TrackLike, p: TrackLike) => { log.committed.push([n, p]); } };
};

test('plan: phone front camera -> rear first (facingMode), then the other device; one camera -> nothing', () => {
  const cams = dev(['a', 'b']).map(({ deviceId, label }) => ({ deviceId, label }));
  assert.deepEqual(planNextCamera(cams, { deviceId: 'a', facing: 'user' }), [{ by: 'facing', facingMode: 'environment' }, { by: 'device', deviceId: 'b' }]);
  assert.deepEqual(planNextCamera(cams, { deviceId: 'b', facing: 'environment' }), [{ by: 'facing', facingMode: 'user' }, { by: 'device', deviceId: 'a' }]);
  assert.deepEqual(planNextCamera(cams.slice(0, 1), { deviceId: 'a', facing: 'user' }), []);
});

test('plan: computer webcams (no facingMode) rotate through the list and wrap around', () => {
  const cams = dev(['a', 'b', 'c']).map(({ deviceId, label }) => ({ deviceId, label }));
  assert.deepEqual(planNextCamera(cams, { deviceId: 'a', facing: 'unknown' }), [{ by: 'device', deviceId: 'b' }, { by: 'device', deviceId: 'c' }]);
  assert.deepEqual(planNextCamera(cams, { deviceId: 'c', facing: 'unknown' }), [{ by: 'device', deviceId: 'a' }, { by: 'device', deviceId: 'b' }]);
  assert.deepEqual(planNextCamera(cams, { deviceId: 'zzz', facing: 'unknown' })[0], { by: 'device', deviceId: 'a' }, 'unknown current device -> first camera');
});

test('facingOf: settings first, label as fallback, otherwise unknown', () => {
  assert.equal(facingOf(mkTrack('a', 'environment')), 'environment');
  assert.equal(facingOf(mkTrack('a', undefined, 'camera2 0, facing back')), 'environment');
  assert.equal(facingOf(mkTrack('a', undefined, 'Back Camera')), 'environment');
  assert.equal(facingOf(mkTrack('a', undefined, 'Front Camera')), 'user');
  assert.equal(facingOf(mkTrack('a', undefined, 'Integrated Webcam')), 'unknown');
  assert.equal(facingOf(null), 'unknown');
});

test('constraints: video only (the microphone is never re-requested) and exact facing / device', () => {
  const f: any = constraintsFor({ by: 'facing', facingMode: 'environment' });
  assert.equal(f.audio, false); assert.deepEqual(f.video.facingMode, { exact: 'environment' });
  const d: any = constraintsFor({ by: 'device', deviceId: 'x' });
  assert.equal(d.audio, false); assert.deepEqual(d.video.deviceId, { exact: 'x' });
});

test('student/teacher switch (front -> rear): new camera opened FIRST, published via replace, old stopped only after, audio never requested', async () => {
  const front = mkTrack('a', 'user'); const rear = mkTrack('b', 'environment');
  const order: string[] = [];
  const { env, calls } = makeEnv(['a', 'b'], async () => { order.push('open'); return streamOf(rear); });
  const h = harness(front);
  const res = await switchCamera({ env, current: front, replace: async (n) => { order.push(`replace(oldStopped=${front.stopped})`); await h.replace(n); }, commit: (n, p) => { order.push(`commit(oldStopped=${front.stopped})`); h.commit(n, p); } });
  assert.deepEqual(order, ['open', 'replace(oldStopped=false)', 'commit(oldStopped=false)']);
  assert.equal(front.stopped, true, 'old camera released afterwards'); assert.equal(rear.stopped, false);
  assert.equal(res.track, rear); assert.equal(res.facing, 'environment'); assert.equal(res.handoff, false);
  assert.equal(calls.length, 1); assert.equal(calls[0].audio, false);
  assert.equal(h.log.replaced.length, 1); assert.equal(h.log.committed.length, 1);
});

test('repeated switching: front -> rear -> front leaves exactly one live camera track and one open per switch', async () => {
  const cams = { a: mkTrack('a', 'user'), b: mkTrack('b', 'environment') } as Record<string, ReturnType<typeof mkTrack>>;
  let current: ReturnType<typeof mkTrack> = cams.a; const live = new Set<TrackLike>([current]); let opens = 0;
  const { env } = makeEnv(['a', 'b'], async (c) => { opens += 1; const id = c.video.facingMode ? (c.video.facingMode.exact === 'environment' ? 'b' : 'a') : c.video.deviceId.exact; const t = mkTrack(id, id === 'b' ? 'environment' : 'user'); live.add(t); return streamOf(t); });
  for (let i = 0; i < 6; i += 1) {
    const prev = current;
    const r = await switchCamera({ env, current: prev, replace: async () => {}, commit: (n, p) => { live.delete(p); current = n as any; } });
    assert.equal(r.facing, i % 2 === 0 ? 'environment' : 'user');
  }
  assert.equal(opens, 6);
  assert.equal([...live].filter((t) => t.readyState === 'live').length, 1, 'no duplicate tracks accumulate');
});

test('desktop with two webcams: switches by deviceId', async () => {
  const w1 = mkTrack('cam1'); const w2 = mkTrack('cam2');
  const { env, calls } = makeEnv(['cam1', 'cam2'], async () => streamOf(w2));
  const r = await switchCamera({ env, current: w1, replace: async () => {}, commit: () => {} });
  assert.deepEqual(calls[0].video.deviceId, { exact: 'cam2' }); assert.equal(r.track, w2);
});

test('rear camera not available as facingMode (Overconstrained) -> falls back to the other device id', async () => {
  const front = mkTrack('a', 'user'); const other = mkTrack('b');
  const { env, calls } = makeEnv(['a', 'b'], async (c, n) => { if (n === 0) throw err('OverconstrainedError'); return streamOf(other); });
  const r = await switchCamera({ env, current: front, replace: async () => {}, commit: () => {} });
  assert.equal(calls.length, 2); assert.ok(calls[0].video.facingMode); assert.deepEqual(calls[1].video.deviceId, { exact: 'b' }); assert.equal(r.track, other);
});

test('only one camera: refuses with no-alternative, nothing is opened or stopped', async () => {
  const cur = mkTrack('a', 'user'); const { env, calls } = makeEnv(['a'], async () => { throw new Error('must not be called'); });
  await assert.rejects(() => switchCamera({ env, current: cur, replace: async () => {}, commit: () => {} }), (e: any) => e instanceof CameraSwitchError && e.code === 'no-alternative');
  assert.equal(calls.length, 0); assert.equal(cur.stopped, false);
});

test('camera OFF: never silently turned on - refuses with camera-off and opens nothing', async () => {
  const cur = mkTrack('a', 'user'); cur.enabled = false; const { env, calls } = makeEnv(['a', 'b'], async () => { throw new Error('no'); });
  await assert.rejects(() => switchCamera({ env, current: cur, replace: async () => {}, commit: () => {} }), (e: any) => e.code === 'camera-off');
  assert.equal(calls.length, 0); assert.equal(cur.enabled, false);
});

test('permission denied: current camera keeps running and stays published (restored=true)', async () => {
  const cur = mkTrack('a', 'user'); const h = harness(cur);
  const { env } = makeEnv(['a', 'b'], async () => { throw err('NotAllowedError'); });
  await assert.rejects(() => switchCamera({ env, current: cur, ...h }), (e: any) => e.code === 'denied' && e.restored === true);
  assert.equal(cur.stopped, false); assert.equal(h.log.replaced.length, 0); assert.equal(h.log.committed.length, 0);
});

test('phones that allow ONE camera at a time (NotReadable): old camera is released, the new one opens, the swap succeeds', async () => {
  const front = mkTrack('a', 'user'); const rear = mkTrack('b', 'environment'); const h = harness(front);
  const { env, calls } = makeEnv(['a', 'b'], async () => { if (!front.stopped) throw err('NotReadableError'); return streamOf(rear); });
  const r = await switchCamera({ env, current: front, ...h });
  assert.equal(r.handoff, true); assert.equal(front.stopped, true); assert.equal(h.log.replaced[0], rear); assert.ok(calls.length >= 2);
});

test('handoff fails: the PREVIOUS camera is re-opened and re-published (the interview keeps video)', async () => {
  const front = mkTrack('a', 'user'); const back = mkTrack('a', 'user'); const h = harness(front);
  const { env } = makeEnv(['a', 'b'], async (c) => { if (c.video.deviceId && c.video.deviceId.exact === 'a') return streamOf(back); throw err('NotReadableError'); });
  await assert.rejects(() => switchCamera({ env, current: front, ...h }), (e: any) => e.code === 'busy' && e.restored === true);
  assert.equal(h.log.replaced[0], back); assert.equal(h.log.committed[0][0], back); assert.equal(back.stopped, false);
});

test('handoff fails AND the previous camera cannot be re-opened: reports restored=false (the UI shows the camera as off)', async () => {
  const front = mkTrack('a', 'user'); const h = harness(front);
  const { env } = makeEnv(['a', 'b'], async () => { throw err('NotReadableError'); });
  await assert.rejects(() => switchCamera({ env, current: front, ...h }), (e: any) => e.code === 'busy' && e.restored === false);
});

test('replaceTrack failure: the new track is stopped, the old camera keeps running', async () => {
  const front = mkTrack('a', 'user'); const rear = mkTrack('b', 'environment'); const { env } = makeEnv(['a', 'b'], async () => streamOf(rear));
  await assert.rejects(() => switchCamera({ env, current: front, replace: async () => { throw err('InvalidStateError'); }, commit: () => { assert.fail('must not commit'); } }), (e: any) => e.code === 'failed' && e.restored === true);
  assert.equal(rear.stopped, true); assert.equal(front.stopped, false);
});

test('timeout: a camera that never answers gives a timeout error; a stream that arrives LATE is stopped (no leaked camera light)', async () => {
  const front = mkTrack('a', 'user'); const late = mkTrack('b', 'environment'); let release: (v: any) => void = () => {};
  const { env } = makeEnv(['a', 'b'], () => new Promise((res) => { release = res; }));
  await assert.rejects(() => switchCamera({ env, current: front, replace: async () => {}, commit: () => {}, openTimeoutMs: 30 }), (e: any) => e.code === 'timeout');
  release(streamOf(late)); await new Promise((r) => setTimeout(r, 10));
  assert.equal(late.stopped, true); assert.equal(front.stopped, false);
});

test('interview ends during the switch: the freshly opened camera is stopped and nothing is committed', async () => {
  const front = mkTrack('a', 'user'); const rear = mkTrack('b', 'environment'); let cancelled = false;
  const { env } = makeEnv(['a', 'b'], async () => { cancelled = true; return streamOf(rear); });
  await assert.rejects(() => switchCamera({ env, current: front, isCancelled: () => cancelled, replace: async () => { assert.fail('no replace after cancel'); }, commit: () => { assert.fail('no commit'); } }), (e: any) => e.code === 'cancelled');
  assert.equal(rear.stopped, true);
});

test('messages are friendly (no raw technical text) and errors are classified', () => {
  for (const c of ['unsupported', 'no-alternative', 'camera-off', 'denied', 'busy', 'timeout', 'failed'] as const) {
    const m = cameraSwitchMessage(c); assert.ok(m.length > 10); assert.doesNotMatch(m, /DOMException|Error:|undefined|getUserMedia|NotReadable/);
  }
  assert.match(cameraSwitchMessage('failed'), /Your current interview is still active/);
  assert.equal(classifySwitchError(err('NotAllowedError')), 'denied'); assert.equal(classifySwitchError(err('NotReadableError')), 'busy'); assert.equal(classifySwitchError(err('weird')), 'failed');
});
