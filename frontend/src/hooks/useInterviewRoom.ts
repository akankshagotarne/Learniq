import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/socket';
import { interviewApi } from '../services/interview';

/**
 * Two-way camera + microphone for ONE interview (browser WebRTC, peer to peer, nothing recorded).
 * The teacher is the offerer, the student the answerer. Authorisation is decided by the backend: room-access (HTTP) and
 * 'interview:join' (socket) both re-check who the caller is and the interview's status.
 */
export type RoomPhase =
  | 'idle' | 'preparing' | 'media-error' | 'joining' | 'waiting-peer' | 'connecting' | 'connected'
  | 'reconnecting' | 'ended' | 'replaced' | 'error';

export type MediaProblem = 'unsupported' | 'insecure' | 'denied' | 'no-device' | 'busy' | 'failed';

export const mediaProblemMessage = (p: MediaProblem): string => ({
  unsupported: 'This browser cannot use the camera and microphone. Please use the latest Chrome, Edge, Firefox or Safari.',
  insecure: 'The camera and microphone only work on a secure (https) page.',
  denied: 'Camera or microphone permission was blocked. Allow access in your browser settings (lock icon in the address bar), then try again.',
  'no-device': 'No camera or microphone was found. Connect one and try again.',
  busy: 'Your camera or microphone is being used by another app. Close it and try again.',
  failed: 'Could not start your camera and microphone. Please check your devices and try again.',
}[p]);

const classifyMediaError = (err: any): MediaProblem => {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-device';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'failed';
};

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
    let cancelled = false;
    let stream: MediaStream | null = null;
    let pc: RTCPeerConnection | null = null;
    let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    let pendingCandidates: RTCIceCandidateInit[] = [];
    let remoteSet = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let peerHere = false;
    let joined = false;
    const socket = getSocket();

    const signal = (data: any) => socket.emit('interview:signal', { data });

    const closePeer = () => {
      if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.onconnectionstatechange = null; try { pc.close(); } catch { /* ignore */ } }
      pc = null; remoteSet = false; pendingCandidates = [];
      setRemoteStream(null);
    };

    const makePeer = (): RTCPeerConnection => {
      closePeer();
      const conn = new RTCPeerConnection({ iceServers });
      pc = conn;
      const remote = new MediaStream();
      setRemoteStream(remote);
      stream?.getTracks().forEach((t) => conn.addTrack(t, stream as MediaStream));
      conn.ontrack = (e) => { e.streams[0]?.getTracks().forEach((t) => { if (!remote.getTracks().includes(t)) remote.addTrack(t); }); setRemoteStream(new MediaStream(remote.getTracks())); };
      conn.onicecandidate = (e) => { if (e.candidate) signal({ candidate: e.candidate.toJSON() }); };
      conn.onconnectionstatechange = () => {
        if (cancelled || pc !== conn) return;
        const s = conn.connectionState;
        if (s === 'connected') { setPhase('connected'); socket.emit('interview:connected'); }
        else if (s === 'connecting') setPhase((p) => (p === 'connected' ? 'reconnecting' : 'connecting'));
        else if (s === 'disconnected') {
          setPhase('reconnecting');
          if (role === 'teacher') offer(true).catch(() => {}); // try an ICE restart
        } else if (s === 'failed') {
          setPhase('reconnecting');
          if (role === 'teacher' && peerHere) startOffer().catch(() => {});
        }
      };
      return conn;
    };

    const offer = async (iceRestart = false) => {
      if (!pc) return;
      const o = await pc.createOffer({ iceRestart });
      await pc.setLocalDescription(o);
      signal({ sdp: pc.localDescription });
    };
    const startOffer = async () => { makePeer(); setPhase('connecting'); await offer(false); };

    const flushCandidates = async () => {
      const list = pendingCandidates; pendingCandidates = [];
      for (const c of list) { try { await pc?.addIceCandidate(c); } catch { /* stale candidate */ } }
    };

    const onSignal = async ({ data }: { data: any }) => {
      try {
        if (data.sdp) {
          if (data.sdp.type === 'offer' && role === 'student') {
            if (!pc || pc.signalingState !== 'stable') makePeer();
            await pc!.setRemoteDescription(data.sdp); remoteSet = true; await flushCandidates();
            const a = await pc!.createAnswer(); await pc!.setLocalDescription(a);
            signal({ sdp: pc!.localDescription }); setPhase((p) => (p === 'connected' ? p : 'connecting'));
          } else if (data.sdp.type === 'answer' && role === 'teacher' && pc) {
            await pc.setRemoteDescription(data.sdp); remoteSet = true; await flushCandidates();
          }
        } else if (data.candidate) {
          if (pc && remoteSet) await pc.addIceCandidate(data.candidate); else pendingCandidates.push(data.candidate);
        }
      } catch (e) { console.warn('[interview] signalling error', e); }
    };

    const onPeerJoined = () => {
      peerHere = true;
      if (role === 'teacher') startOffer().catch(() => setPhase('error')); // fresh connection each time the student (re)joins
      else { closePeer(); setPhase('connecting'); }
    };
    const onPeerLeft = () => { peerHere = false; closePeer(); setPhase('waiting-peer'); };
    const onEnd = () => { setPhase('ended'); cleanup(); endedRef.current?.(); };
    const onReplaced = () => { setPhase('replaced'); cleanup(); };
    const onMediaState = (m: { camera: boolean; mic: boolean }) => setPeerMedia({ camera: !!m.camera, mic: !!m.mic });

    const join = () => new Promise<void>((resolve, reject) => {
      socket.emit('interview:join', { interviewId }, (res: any) => {
        if (!res || !res.ok) return reject(new Error((res && res.message) || 'Could not join the interview.'));
        joined = true; peerHere = !!res.peerPresent;
        if (res.peerPresent) { if (role === 'teacher') startOffer().catch(() => setPhase('error')); else setPhase('connecting'); }
        else setPhase('waiting-peer');
        resolve();
      });
    });

    const onReconnect = () => { if (joined && !cancelled) join().catch((e) => { setError(e.message); setPhase('error'); }); };

    function cleanup() {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
      socket.off('interview:signal', onSignal);
      socket.off('interview:peer-joined', onPeerJoined);
      socket.off('interview:peer-left', onPeerLeft);
      socket.off('interview:ended', onEnd);
      socket.off('interview:replaced', onReplaced);
      socket.off('interview:media-state', onMediaState);
      socket.off('connect', onReconnect);
      if (joined) socket.emit('interview:leave');
      joined = false;
      closePeer();
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      setLocalStream(null);
    }

    (async () => {
      setError(null); setMediaProblem(null); setPhase('preparing');
      if (!window.isSecureContext && location.hostname !== 'localhost') { setMediaProblem('insecure'); setPhase('media-error'); return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof RTCPeerConnection === 'undefined') { setMediaProblem('unsupported'); setPhase('media-error'); return; }
      try {
        const access = await interviewApi.roomAccess(interviewId);
        if (cancelled) return;
        if (access.iceServers && access.iceServers.length) iceServers = access.iceServers;
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.response?.data?.message || 'You cannot join this interview right now.'); setPhase('error'); return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) {
        if (cancelled) return;
        setMediaProblem(classifyMediaError(e)); setPhase('media-error'); return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      setLocalStream(stream); setMicOn(true); setCamOn(true);
      // a device unplugged mid-call ends its track: tell the user instead of failing silently
      stream.getTracks().forEach((t) => { t.onended = () => { if (!cancelled) { if (t.kind === 'video') setCamOn(false); else setMicOn(false); } }; });

      socket.on('interview:signal', onSignal);
      socket.on('interview:peer-joined', onPeerJoined);
      socket.on('interview:peer-left', onPeerLeft);
      socket.on('interview:ended', onEnd);
      socket.on('interview:replaced', onReplaced);
      socket.on('interview:media-state', onMediaState);
      socket.on('connect', onReconnect);
      setPhase('joining');
      try { await join(); } catch (e: any) { if (!cancelled) { setError(e.message); setPhase('error'); } return; }
      heartbeat = setInterval(() => socket.emit('interview:heartbeat'), 20000);
      socket.emit('interview:heartbeat');
    })();

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
