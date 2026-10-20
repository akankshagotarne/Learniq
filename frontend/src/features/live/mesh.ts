/**
 * Browser WebRTC mesh for a live class, driven ENTIRELY by the server's peer plan.
 *
 *  - The server sends `peer-plan`: for every other participant this client may talk to, whether it may SEND to them and whether it
 *    should RECEIVE from them. A participant that is not in the plan has no connection at all (and the server would drop its signals).
 *  - One RTCPeerConnection per planned peer. The side with the lexicographically smaller socket id makes the offer, so two sides can
 *    never offer at the same moment (no "glare").
 *  - Tracks are swapped with RTCRtpSender.replaceTrack (no renegotiation): the camera / screen / mic go out only to peers we may SEND to;
 *    to everyone else we send an inert placeholder, so a disallowed direction carries no real media even before the server reacts.
 *  - A peer we should not RECEIVE from is never exposed to the UI (no tile, no audio element).
 * Honest limit: this is the client half of the enforcement. The server half (signalling refusal, state validation, filtered rosters) is in
 * backend/src/services/live. A modified browser could ignore the plan; it can still not get a connection the server refuses to signal.
 */
import type { PeerPlanEntry } from './types';

export interface SocketLike {
  id?: string;
  emit: (event: string, payload?: any, ack?: (r: any) => void) => any;
}

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  // Free public TURN relay (Open Relay Project) - fine for small classes; replace with a paid provider + env credentials at scale.
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

export type PeerState = 'new' | 'connecting' | 'connected' | 'failed' | 'closed';

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  initiator: boolean;
  send: boolean;
  receive: boolean;
  pending: RTCIceCandidateInit[];
  stream: MediaStream | null;
  retries: number;
  planned: boolean;
}

const makeBlankVideo = (): MediaStreamTrack | null => {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const paint = () => { if (ctx) { ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, 16, 16); } };
    paint();
    const stream: MediaStream | null = (canvas as any).captureStream ? (canvas as any).captureStream(5) : null;
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return null;
    const timer = window.setInterval(() => { if (track.readyState === 'ended') window.clearInterval(timer); else paint(); }, 1000);
    return track;
  } catch { return null; }
};

const makeSilentAudio = (): MediaStreamTrack | null => {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const dst = ctx.createMediaStreamDestination();
    osc.connect(gain); gain.connect(dst); osc.start();
    return dst.stream.getAudioTracks()[0] || null;
  } catch { return null; }
};

export class LiveMesh {
  private peers = new Map<string, Peer>();
  private video: MediaStreamTrack | null = null;
  private audio: MediaStreamTrack | null = null;
  private blankVideo: MediaStreamTrack | null = null;
  private silentAudio: MediaStreamTrack | null = null;
  private closed = false;

  constructor(
    private socket: SocketLike,
    private onStreams: (streams: Record<string, MediaStream>) => void,
    private onPeerState: (socketId: string, state: PeerState) => void = () => {},
    private iceServers: RTCIceServer[] = ICE_SERVERS,
  ) {}

  private selfId(): string { return this.socket.id || ''; }
  private isInitiator(otherId: string): boolean { return this.selfId() < otherId; }

  private placeholderVideo(): MediaStreamTrack | null {
    if (!this.blankVideo || this.blankVideo.readyState !== 'live') this.blankVideo = makeBlankVideo();
    return this.blankVideo;
  }
  private placeholderAudio(): MediaStreamTrack | null {
    if (!this.silentAudio || this.silentAudio.readyState !== 'live') this.silentAudio = makeSilentAudio();
    return this.silentAudio;
  }

  private publishStreams() {
    const out: Record<string, MediaStream> = {};
    this.peers.forEach((p) => { if (p.receive && p.stream) out[p.id] = p.stream; });
    this.onStreams(out);
  }

  /** tracks that go to one peer: the real ones only if we may SEND to them */
  private applySenders(p: Peer) {
    if (p.pc.signalingState === 'closed') return;
    const v = p.send ? (this.video || this.placeholderVideo()) : this.placeholderVideo();
    const a = p.send ? (this.audio || this.placeholderAudio()) : this.placeholderAudio();
    for (const t of p.pc.getTransceivers()) {
      const kind = (t.receiver && t.receiver.track && t.receiver.track.kind) || (t.sender.track && t.sender.track.kind);
      const track = kind === 'video' ? v : kind === 'audio' ? a : null;
      if (!track || t.sender.track === track) continue;
      t.sender.replaceTrack(track).catch(() => { /* peer is going away */ });
    }
  }

  private create(otherId: string, planned: boolean, entry?: PeerPlanEntry): Peer {
    const existing = this.peers.get(otherId);
    if (existing && existing.pc.signalingState !== 'closed') return existing;
    const initiator = this.isInitiator(otherId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { id: otherId, pc, initiator, send: entry ? entry.send : false, receive: entry ? entry.receive : false, pending: [], stream: null, retries: 0, planned };
    this.peers.set(otherId, peer);

    pc.onicecandidate = (e) => { if (e.candidate && !this.closed) this.socket.emit('webrtc-ice-candidate', { targetSocketId: otherId, candidate: e.candidate }); };
    pc.ontrack = (e) => {
      const cur = peer.stream;
      if (cur) {
        cur.getTracks().forEach((t) => { if (t.kind === e.track.kind && t.id !== e.track.id) cur.removeTrack(t); });
        cur.addTrack(e.track);
        peer.stream = new MediaStream(cur.getTracks());
      } else {
        peer.stream = new MediaStream(e.streams && e.streams[0] ? e.streams[0].getTracks() : [e.track]);
      }
      e.track.onunmute = () => { if (peer.stream) { peer.stream = new MediaStream(peer.stream.getTracks()); this.publishStreams(); } };
      this.publishStreams();
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState as PeerState;
      this.onPeerState(otherId, s);
      if (s === 'connected') peer.retries = 0;
      if (s === 'failed' && !this.closed) this.recover(peer);
    };

    if (initiator) { // the offering side creates the media sections; the answering side takes them from the offer
      const a = peer.send ? (this.audio || this.placeholderAudio()) : this.placeholderAudio();
      const v = peer.send ? (this.video || this.placeholderVideo()) : this.placeholderVideo();
      try { a ? pc.addTransceiver(a, { direction: 'sendrecv' }) : pc.addTransceiver('audio', { direction: 'sendrecv' }); } catch { /* ignore */ }
      try { v ? pc.addTransceiver(v, { direction: 'sendrecv' }) : pc.addTransceiver('video', { direction: 'sendrecv' }); } catch { /* ignore */ }
    }
    return peer;
  }

  private async offer(peer: Peer, iceRestart = false) {
    try {
      if (peer.pc.signalingState !== 'stable') return;
      const offer = await peer.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      await peer.pc.setLocalDescription(offer);
      this.socket.emit('webrtc-offer', { targetSocketId: peer.id, offer });
    } catch (err) { console.warn('[mesh] offer failed', err); }
  }

  private recover(peer: Peer) {
    if (peer.retries >= 4) return;
    peer.retries += 1;
    window.setTimeout(() => {
      const cur = this.peers.get(peer.id);
      if (this.closed || cur !== peer || !peer.planned) return;
      if (peer.initiator) {
        this.dropPeer(peer.id);
        const fresh = this.create(peer.id, true, { socketId: peer.id, userId: '', send: peer.send, receive: peer.receive });
        fresh.retries = peer.retries;
        this.offer(fresh);
      } else {
        this.dropPeer(peer.id); // the offering side will start again; we answer a new offer from scratch
      }
    }, 800 * peer.retries);
  }

  private dropPeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    try { p.pc.onicecandidate = null; p.pc.ontrack = null; p.pc.onconnectionstatechange = null; p.pc.close(); } catch { /* already closed */ }
  }

  /** Apply the server's plan: open new connections, close removed ones, re-aim the senders of the others. */
  setPlan(plan: PeerPlanEntry[]) {
    if (this.closed) return;
    const want = new Map(plan.map((e) => [e.socketId, e]));
    for (const id of [...this.peers.keys()]) {
      const peer = this.peers.get(id)!;
      const entry = want.get(id);
      if (!entry) { if (peer.planned || peer.pc.signalingState === 'stable') this.dropPeer(id); continue; }
      peer.planned = true;
      peer.send = entry.send;
      peer.receive = entry.receive;
      this.applySenders(peer);
    }
    for (const entry of plan) {
      if (this.peers.has(entry.socketId)) continue;
      const peer = this.create(entry.socketId, true, entry);
      if (peer.initiator) this.offer(peer);
    }
    this.publishStreams();
  }

  /** The tracks we publish. The camera and the screen share one video slot: a screen share replaces the camera picture. */
  setLocal(video: MediaStreamTrack | null, audio: MediaStreamTrack | null) {
    this.video = video; this.audio = audio;
    this.peers.forEach((p) => this.applySenders(p));
  }

  async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    if (this.closed) return;
    try {
      const peer = this.peers.get(from) || this.create(from, false);
      if (peer.pc.signalingState === 'have-local-offer') { try { await peer.pc.setLocalDescription({ type: 'rollback' }); } catch { /* ignore */ } }
      await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));
      for (const c of peer.pending.splice(0)) { try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* stale candidate */ } }
      for (const t of peer.pc.getTransceivers()) { try { t.direction = 'sendrecv'; } catch { /* ignore */ } }
      this.applySenders(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.socket.emit('webrtc-answer', { targetSocketId: from, answer });
    } catch (err) { console.warn('[mesh] handleOffer failed', err); }
  }

  async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    const peer = this.peers.get(from);
    if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      for (const c of peer.pending.splice(0)) { try { await peer.pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* stale */ } }
      this.applySenders(peer);
    } catch (err) { console.warn('[mesh] handleAnswer failed', err); }
  }

  async handleIce(from: string, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(from) || this.create(from, false);
    if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) { try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* ignore */ } }
    else peer.pending.push(candidate);
  }

  /** The server told us that this peer left, or may no longer be reached. */
  removePeer(id: string) { this.dropPeer(id); this.publishStreams(); }

  peerIds(): string[] { return [...this.peers.keys()]; }

  close() {
    this.closed = true;
    [...this.peers.keys()].forEach((id) => this.dropPeer(id));
    this.blankVideo?.stop(); this.silentAudio?.stop();
    this.blankVideo = null; this.silentAudio = null;
    this.onStreams({});
  }
}
