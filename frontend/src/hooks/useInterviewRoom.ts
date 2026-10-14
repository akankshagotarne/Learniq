import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/socket';
import { interviewApi } from '../services/interview';
import { diag, InterviewMediaError, mediaPool, mediaProblemMessage, MediaProblem, TimeoutError, withTimeout, type MediaLease } from '../services/interviewMedia';

/**
 * Two-way camera + microphone for ONE interview (browser WebRTC, peer to peer, nothing recorded).
 * The teacher is the offerer, the student the answerer. Authorisation is decided by the backend: room-access (HTTP) and
 * 'interview:join' (socket) both re-check who the caller is and the interview's status.
 *
 * Lifecycle rules (see docs/INTERVIEW_ROOM_STABILITY.md): every wait is finite; the camera is acquired through the shared
 * single-flight pool (never two concurrent getUserMedia); a run that was cancelled never touches state or the socket room
 * of a newer run; reconnection attempts are capped; cleanup is idempotent and only releases what THIS run owns.
 */
export type RoomPhase =
  | 'idle' | 'preparing' | 'awaiting-permission' | 'media-error' | 'joining' | 'waiting-peer' | 'connecting' | 'connected'
  | 'reconnecting' | 'ended' | 'replaced' | 'error';

export { mediaProblemMessage };
export type { MediaProblem };

const ROOM_ACCESS_TIMEOUT_MS = 15000;
const JOIN_TIMEOUT_MS = 12000;
const MAX_RECONNECTS = 4;          // after this many failed recoveries in a row the user gets a clear error + Try again, never an endless loop
const DISCONNECT_GRACE_MS = 3000;  // a 'disconnected' ICE state often heals itself; only restart if it persists

/** who currently owns the socket room of an interview in this tab (a stale run must not leave a room a newer run joined) */
const roomOwners = new Map<string, symbol>();

interface Options {
  interviewId: string | null;
  role: 'teacher' | 'student';
  enabled: boolean;
  onEnded?: () => void;
}

export const useInterviewRoom = ({ interviewId, role, enabled, onEnded }: Options) => {
  const [phase, setPhase] = useState<RoomPhase>('idle');
  const [mediaProblem, setMediaProblem] = useState<MediaProblem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [peerMedia, setPeerMedia] = useState<{ camera: boolean; mic: boolean }>({ camera: true, mic: true });
  const [attempt, setAttempt] = useState(0);

  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  useEffect(() => {
    if (!enabled || !interviewId) return undefined;
    const owner = Symbol(interviewId);
    roomOwners.set(interviewId, owner);
    let cancelled = false;          // this run was cleaned up: nothing it still has in flight may touch state or the socket
    let cleaned = false;
    let lease: MediaLease | null = null;
    let stream: MediaStream | null = null;
    let pc: RTCPeerConnection | null = null;
    let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    let pendingCandidates: RTCIceCandidateInit[] = [];
    let remoteSet = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let peerHere = false;
    let joined = false;
    let recoveries = 0;
    const socket = getSocket();
    const alive = () => !cancelled;
    const ctx = { interviewId, role };

    const signal = (data: any) => socket.emit('interview:signal', { data });

    const closePeer = () => {
      if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
      if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.onconnectionstatechange = null; try { pc.close(); } catch { /* ignore */ } }
      pc = null; remoteSet = false; pendingCandidates = [];
      if (alive()) setRemoteStream(null);
    };

    const fail = (message: string) => { if (!alive()) return; diag('connection-error', { ...ctx, message }); setError(message); setPhase('error'); };

    /** one bounded recovery step; after MAX_RECONNECTS in a row the user gets an error + Try again instead of an endless loop */
    const recover = (why: string, action: () => Promise<void> | void) => {
      if (!alive()) return;
      recoveries += 1;
      if (recoveries > MAX_RECONNECTS) { closePeer(); fail('The connection could not be restored. Check your internet connection and try again.'); return; }
      diag('recovery', { ...ctx, why, attempt: recoveries });
      setPhase('reconnecting');
      Promise.resolve(action()).catch((e) => diag('recovery-failed', { ...ctx, why, message: e && e.message }));
    };

    const makePeer = (): RTCPeerConnection => {
      closePeer();
      const conn = new RTCPeerConnection({ iceServers });
      pc = conn;
      const remote = new MediaStream();
      setRemoteStream(remote);
      stream?.getTracks().forEach((t) => conn.addTrack(t, stream as MediaStream));
      conn.ontrack = (e) => {
        if (!alive() || pc !== conn) return;
        e.streams[0]?.getTracks().forEach((t) => { if (!remote.getTracks().includes(t)) remote.addTrack(t); });
        diag('remote-track', { ...ctx, kind: e.track.kind });
        setRemoteStream(new MediaStream(remote.getTracks()));
      };
      conn.onicecandidate = (e) => { if (e.candidate && alive() && pc === conn) signal({ candidate: e.candidate.toJSON() }); };
      conn.onconnectionstatechange = () => {
        if (!alive() || pc !== conn) return;
        const st = conn.connectionState;
        if (st === 'connected') {
          if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
          recoveries = 0; diag('peer-connected', ctx); setPhase('connected'); socket.emit('interview:connected');
        } else if (st === 'connecting') setPhase((p) => (p === 'connected' ? 'reconnecting' : 'connecting'));
        else if (st === 'disconnected') {
          setPhase('reconnecting');
          if (role === 'teacher' && !graceTimer) { // wait: 'disconnected' frequently heals itself
            graceTimer = setTimeout(() => { graceTimer = null; if (pc === conn && conn.connectionState === 'disconnected') recover('ice-disconnected', () => offer(true)); }, DISCONNECT_GRACE_MS);
          }
        } else if (st === 'failed') {
          if (role === 'teacher' && peerHere) recover('ice-failed', () => startOffer());
          else setPhase('reconnecting'); // the student side waits for the teacher's new offer
        }
      };
      return conn;
    };

    const offer = async (iceRestart = false) => {
      const conn = pc; if (!conn) return;
      const o = await conn.createOffer({ iceRestart });
      if (!alive() || pc !== conn) return;
      await conn.setLocalDescription(o);
      signal({ sdp: conn.localDescription });
    };
    const startOffer = async () => { makePeer(); setPhase('connecting'); await offer(false); };

    const flushCandidates = async () => {
      const list = pendingCandidates; pendingCandidates = [];
      for (const c of list) { try { await pc?.addIceCandidate(c); } catch { /* stale candidate */ } }
    };

    const onSignal = async ({ data }: { data: any }) => {
      if (!alive()) return;
      try {
        if (data.sdp) {
          if (data.sdp.type === 'offer' && role === 'student') {
            if (!pc || pc.signalingState !== 'stable') makePeer();
            const conn = pc!;
            await conn.setRemoteDescription(data.sdp); remoteSet = true; await flushCandidates();
            const a = await conn.createAnswer(); if (!alive() || pc !== conn) return; await conn.setLocalDescription(a);
            signal({ sdp: conn.localDescription }); setPhase((p) => (p === 'connected' ? p : 'connecting'));
          } else if (data.sdp.type === 'answer' && role === 'teacher' && pc) {
            await pc.setRemoteDescription(data.sdp); remoteSet = true; await flushCandidates();
          }
        } else if (data.candidate) {
          if (pc && remoteSet) await pc.addIceCandidate(data.candidate); else pendingCandidates.push(data.candidate);
        }
      } catch (e: any) { diag('signalling-error', { ...ctx, message: e && e.message }); }
    };

    const onPeerJoined = () => {
      if (!alive()) return;
      peerHere = true; diag('peer-joined', ctx);
      if (role === 'teacher') startOffer().catch((e) => fail(e?.message || 'Could not start the video connection.')); // fresh connection each time the student (re)joins
      else { closePeer(); setPhase('connecting'); }
    };
    const onPeerLeft = () => { if (!alive()) return; peerHere = false; diag('peer-left', ctx); closePeer(); setPhase('waiting-peer'); };
    const onEnd = () => { if (!alive()) return; diag('ended', ctx); setPhase('ended'); cleanup(); endedRef.current?.(); };
    const onReplaced = () => { if (!alive()) return; diag('replaced', ctx); setPhase('replaced'); cleanup(); };
    const onMediaState = (m: { camera: boolean; mic: boolean }) => { if (alive()) setPeerMedia({ camera: !!m.camera, mic: !!m.mic }); };

    const join = () => { let timedOut = false; return withTimeout(new Promise<void>((resolve, reject) => {
      socket.emit('interview:join', { interviewId }, (res: any) => {
        if (!res || !res.ok) return reject(new Error((res && res.message) || 'Could not join the interview.'));
        joined = true;
        if (timedOut) return resolve(); // the user already saw the timeout error; cleanup (Try again / leave) will release this join
        if (cancelled) { // we left while the server was answering: undo OUR join, unless a newer run of this page already owns the room
          if (!roomOwners.has(interviewId)) socket.emit('interview:leave');
          return resolve();
        }
        peerHere = !!res.peerPresent;
        if (res.peerPresent) { if (role === 'teacher') startOffer().catch((e) => fail(e?.message || 'Could not start the video connection.')); else setPhase('connecting'); }
        else setPhase('waiting-peer');
        resolve();
      });
    }), JOIN_TIMEOUT_MS, 'join').catch((e) => { if (e instanceof TimeoutError) timedOut = true; throw e; }); };
    const joinError = (e: any) => (e instanceof TimeoutError ? 'The interview server did not answer in time. Check your connection and try again.' : (e && e.message) || 'Could not join the interview.');

    const onReconnect = () => { if (joined && alive()) join().catch((e) => fail(joinError(e))); };

    function cleanup() {
      if (cleaned) return; cleaned = true;
      diag('cleanup-start', ctx);
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      socket.off('interview:signal', onSignal);
      socket.off('interview:peer-joined', onPeerJoined);
      socket.off('interview:peer-left', onPeerLeft);
      socket.off('interview:ended', onEnd);
      socket.off('interview:replaced', onReplaced);
      socket.off('interview:media-state', onMediaState);
      socket.off('connect', onReconnect);
      if (roomOwners.get(interviewId) === owner) roomOwners.delete(interviewId);
      if (joined) socket.emit('interview:leave');   // only THIS interview's room (the server resolves it from the socket)
      joined = false;
      closePeer();
      stream?.getTracks().forEach((t) => { t.onended = null; });
      if (!cancelled) setLocalStream(null);
      lease?.release();   // the pool stops the camera only when no other holder needs it
      lease = null; stream = null;
      diag('cleanup-done', ctx);
    }

    (async () => {
      diag('init', ctx);
      setError(null); setMediaProblem(null); setLocalStream(null); setPhase('preparing');
      try {
        const access = await withTimeout(interviewApi.roomAccess(interviewId), ROOM_ACCESS_TIMEOUT_MS, 'room-access');
        if (!alive()) return;
        if (access.iceServers && access.iceServers.length) iceServers = access.iceServers;
        diag('room-access-ok', ctx);
      } catch (e: any) {
        if (!alive()) return;
        fail(e instanceof TimeoutError ? 'The interview server did not answer in time. Check your connection and try again.' : e?.response?.data?.message || 'You cannot join this interview right now.');
        return;
      }
      lease = mediaPool.acquire({ onAwaitingPermission: () => { if (alive()) setPhase((p) => (p === 'preparing' ? 'awaiting-permission' : p)); } });
      try {
        stream = await lease.promise;
      } catch (e) {
        if (!alive()) return;
        const problem: MediaProblem = e instanceof InterviewMediaError ? e.problem : { code: 'failed', device: 'unknown' };
        diag('media-failed', { ...ctx, code: problem.code, device: problem.device });
        lease.release(); lease = null;
        setMediaProblem(problem); setPhase('media-error'); return;
      }
      if (!alive()) return;
      diag('media-ready', { ...ctx, video: stream.getVideoTracks().length, audio: stream.getAudioTracks().length });
      setLocalStream(stream); setMicOn(true); setCamOn(true);
      // a device unplugged mid-call ends its track: tell the user instead of failing silently
      stream.getTracks().forEach((t) => { t.onended = () => { if (alive()) { diag('track-ended', { ...ctx, kind: t.kind }); if (t.kind === 'video') setCamOn(false); else setMicOn(false); } }; });

      socket.on('interview:signal', onSignal);
      socket.on('interview:peer-joined', onPeerJoined);
      socket.on('interview:peer-left', onPeerLeft);
      socket.on('interview:ended', onEnd);
      socket.on('interview:replaced', onReplaced);
      socket.on('interview:media-state', onMediaState);
      socket.on('connect', onReconnect);
      setPhase('joining'); diag('joining', ctx);
      try { await join(); } catch (e: any) { fail(joinError(e)); return; }
      if (!alive()) return;
      heartbeat = setInterval(() => socket.emit('interview:heartbeat'), 20000);
      socket.emit('interview:heartbeat');
    })().catch((e) => { fail((e && e.message) || 'Something went wrong while joining.'); });

    return () => { cancelled = true; cleanup(); };
  }, [enabled, interviewId, role, attempt]);

  const toggle = useCallback((kind: 'audio' | 'video') => {
    if (!localStream) return;
    const tracks = kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
    if (!tracks.length) return;
    const next = !tracks[0].enabled;
    tracks.forEach((t) => { t.enabled = next; });
    if (kind === 'audio') setMicOn(next); else setCamOn(next);
    const s = getSocket();
    const mic = kind === 'audio' ? next : localStream.getAudioTracks()[0]?.enabled ?? false;
    const camera = kind === 'video' ? next : localStream.getVideoTracks()[0]?.enabled ?? false;
    s.emit('interview:media-state', { camera, mic });
  }, [localStream]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { phase, mediaProblem, error, localStream, remoteStream, micOn, camOn, peerMedia, toggleMic: () => toggle('audio'), toggleCam: () => toggle('video'), retry };
};
