/** Live class: camera and screen share are separate tracks, so students get both at once.   npm run test:unit */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isLegacyPeer, slotOfIndex, trackForSlot, type Outgoing } from '../src/features/live/tracks.ts';
import { LiveMesh } from '../src/features/live/mesh.ts';

const out = (over: Partial<Outgoing<string>> = {}): Outgoing<string> => ({ audio: 'mic', video: 'cam', screen: null, blankVideo: 'blankV', blankAudio: 'blankA', ...over });

test('every connection has audio, camera and screen sections in a fixed order', () => {
  assert.deepEqual([0, 1, 2].map(slotOfIndex), ['audio', 'camera', 'screen']);
  assert.equal(slotOfIndex(3), null); assert.equal(slotOfIndex(-1), null);
  assert.equal(isLegacyPeer(2), true); assert.equal(isLegacyPeer(3), false);
});

test('while sharing, the camera section keeps the camera and the screen section carries the screen', () => {
  const o = out({ screen: 'screen' });
  assert.equal(trackForSlot('camera', o, true, false), 'cam');
  assert.equal(trackForSlot('screen', o, true, false), 'screen');
  assert.equal(trackForSlot('audio', o, true, false), 'mic');
});

test('the screen section is empty when nothing is shared, and the camera is not touched by stopping a share', () => {
  assert.equal(trackForSlot('screen', out(), true, false), null);
  assert.equal(trackForSlot('camera', out(), true, false), 'cam');
  assert.equal(trackForSlot('camera', out({ video: null }), true, false), 'blankV', 'camera off -> inert placeholder, never a stale picture');
});

test('a peer we may not send to gets no real media at all', () => {
  const o = out({ screen: 'screen' });
  assert.equal(trackForSlot('camera', o, false, false), 'blankV');
  assert.equal(trackForSlot('audio', o, false, false), 'blankA');
  assert.equal(trackForSlot('screen', o, false, false), null);
});

test('an older client (no screen section) still gets the screen in the camera section', () => {
  const o = out({ screen: 'screen' });
  assert.equal(trackForSlot('camera', o, true, true), 'screen');
  assert.equal(trackForSlot('screen', o, true, true), null);
  assert.equal(trackForSlot('camera', out(), true, true), 'cam');
});

// ── mesh with a fake RTCPeerConnection ─────────────────────────────────────────────────────────
class FakeTrack { muted = false; readyState = 'live'; onunmute: any; onmute: any; kind: string; id: string; constructor(kind: string, id: string) { this.kind = kind; this.id = id; } stop() { this.readyState = 'ended'; } }
class FakeStream { t: FakeTrack[]; constructor(tracks: FakeTrack[] = []) { this.t = tracks.slice(); } getTracks() { return this.t; } getVideoTracks() { return this.t.filter((x) => x.kind === 'video'); } getAudioTracks() { return this.t.filter((x) => x.kind === 'audio'); } addTrack(x: FakeTrack) { this.t.push(x); } removeTrack(x: FakeTrack) { this.t = this.t.filter((y) => y !== x); } }
class FakeTransceiver { sender: any; receiver: any; direction = 'sendrecv'; kind: string; constructor(kind: string, track: FakeTrack | null) { this.kind = kind; this.sender = { track, replaced: [] as any[], replaceTrack: async (t: any) => { this.sender.replaced.push(t); this.sender.track = t; } }; this.receiver = { track: new FakeTrack(kind, `rx-${kind}`) }; } }
const pcs: FakePC[] = [];
class FakePC {
  transceivers: FakeTransceiver[] = []; signalingState = 'stable'; connectionState = 'new'; ontrack: any; onicecandidate: any; onconnectionstatechange: any;
  constructor() { pcs.push(this); }
  addTransceiver(x: any) { this.transceivers.push(new FakeTransceiver(typeof x === 'string' ? x : x.kind, typeof x === 'string' ? null : x)); return this.transceivers[this.transceivers.length - 1]; }
  getTransceivers() { return this.transceivers; }
  async createOffer() { return { type: 'offer', sdp: 'x' }; }
  async setLocalDescription() {}
  close() { this.signalingState = 'closed'; }
}
(globalThis as any).RTCPeerConnection = FakePC; (globalThis as any).MediaStream = FakeStream;

const sock = (id: string) => ({ id, emit: () => {} });
const newMesh = () => {
  const streams: any[] = []; const screens: any[] = [];
  const mesh = new LiveMesh(sock('A') as any, (s) => streams.push(s), () => {}, [], (s) => screens.push(s));
  return { mesh, streams, screens };
};

test('the offering side opens audio, camera and screen sections in that order', () => {
  pcs.length = 0; const { mesh } = newMesh();
  mesh.setPlan([{ socketId: 'B', userId: 'u', send: true, receive: true }]);
  const pc = pcs[0];
  assert.deepEqual(pc.transceivers.map((t) => t.kind), ['audio', 'video', 'video']);
});

test('camera and screen are sent on different sections; stopping the share leaves the camera on', () => {
  pcs.length = 0; const { mesh } = newMesh();
  mesh.setPlan([{ socketId: 'B', userId: 'u', send: true, receive: true }]);
  const [aud, cam, scr] = pcs[0].transceivers;
  const camT = new FakeTrack('video', 'cam') as any; const micT = new FakeTrack('audio', 'mic') as any; const screenT = new FakeTrack('video', 'screen') as any;
  mesh.setLocal(camT, micT, screenT);
  assert.equal(cam.sender.track, camT); assert.equal(scr.sender.track, screenT); assert.equal(aud.sender.track, micT);
  mesh.setLocal(camT, micT, null);
  assert.equal(cam.sender.track, camT, 'camera untouched'); assert.equal(scr.sender.track, null, 'screen section emptied');
  assert.equal(cam.sender.replaced.length <= 1, true, 'no needless camera re-attachment');
});

test('a peer we may not send to is sent no camera, screen or microphone', () => {
  pcs.length = 0; const { mesh } = newMesh();
  mesh.setPlan([{ socketId: 'B', userId: 'u', send: false, receive: true }]);
  const [aud, cam, scr] = pcs[0].transceivers;
  mesh.setLocal(new FakeTrack('video', 'cam') as any, new FakeTrack('audio', 'mic') as any, new FakeTrack('video', 'screen') as any);
  assert.notEqual(cam.sender.track && (cam.sender.track as any).id, 'cam');
  assert.notEqual(aud.sender.track && (aud.sender.track as any).id, 'mic');
  assert.equal(scr.sender.track, null);
});

test('the receiving side keeps the teacher camera and the shared screen as two streams of the same participant', () => {
  pcs.length = 0; const { mesh, streams, screens } = newMesh();
  mesh.setPlan([{ socketId: 'B', userId: 'u', send: true, receive: true }]);
  const pc = pcs[0]; const [aud, cam, scr] = pc.transceivers;
  const camTrack = new FakeTrack('video', 'rc'); const scrTrack = new FakeTrack('video', 'rs'); const audTrack = new FakeTrack('audio', 'ra');
  pc.ontrack({ track: audTrack, transceiver: aud, streams: [] });
  pc.ontrack({ track: camTrack, transceiver: cam, streams: [] });
  scrTrack.muted = true;
  pc.ontrack({ track: scrTrack, transceiver: scr, streams: [] });
  let lastStreams = streams[streams.length - 1]; let lastScreens = screens[screens.length - 1];
  assert.ok(lastStreams.B, 'camera stream exposed'); assert.deepEqual(lastStreams.B.getVideoTracks(), [camTrack]);
  assert.equal(lastScreens.B, undefined, 'no screen frames yet -> no screen stream (no black box)');
  scrTrack.muted = false; scrTrack.onunmute();                                        // the screen starts flowing
  lastStreams = streams[streams.length - 1]; lastScreens = screens[screens.length - 1];
  assert.deepEqual(lastScreens.B.getVideoTracks()[0], scrTrack, 'screen is its own stream');
  assert.deepEqual(lastStreams.B.getVideoTracks(), [camTrack], 'the camera stream still has the CAMERA - not replaced by the screen');
  assert.equal(Object.keys(lastStreams).length, 1, 'still ONE participant');
  scrTrack.muted = true; scrTrack.onmute();                                           // the share stops
  assert.equal(screens[screens.length - 1].B, undefined, 'screen stream removed, no stale frame');
  assert.deepEqual(streams[streams.length - 1].B.getVideoTracks(), [camTrack], 'camera still there after the share stops');
});

test('an older peer (only audio + one video section) shows its screen share through the camera stream', () => {
  pcs.length = 0; const { mesh, screens } = newMesh();
  mesh.setPlan([{ socketId: 'B', userId: 'u', send: true, receive: true }]);
  const pc = pcs[0]; pc.transceivers.pop();                                          // the answer only kept two sections
  const t = new FakeTrack('video', 'legacy');
  pc.ontrack({ track: t, transceiver: pc.transceivers[1], streams: [] });
  assert.ok(screens[screens.length - 1].B, 'legacy peer: the single video stream doubles as the screen');
});
