/**
 * Client state machine for one live class (student, teacher/host). The server is the authority for everything that matters:
 * who is admitted, which mode applies, who may publish, when a question opens/closes and who ranks. This hook turns the server's
 * events into UI state and sends the user's intentions as acknowledged requests - it never "assumes" success.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from '../../services/socket';
import api from '../../services/api';
import { LiveMesh } from './mesh';
import { deadlineFrom, monotonic } from './logic';
import {
  Ack, ChatItem, DEFAULT_CONFIG, HostResults, JoinedPayload, McqProgress, McqQuestion, McqServerState, MeetingConfig, NO_PERMISSIONS, PeerPlanEntry,
  Permissions, RankingCard, RoomParticipant, ScoreEntry, StageInfo, WaitingEntry,
} from './types';

export type RoomStatus = 'loading' | 'joining' | 'waiting-approval' | 'live' | 'denied' | 'removed' | 'ended' | 'error' | 'replaced' | 'use-console';
export type Connection = 'online' | 'reconnecting' | 'offline';
export type MediaIssue = null | 'camera-denied' | 'mic-denied' | 'screen-denied' | 'camera-missing';

export interface McqUi {
  phase: 'idle' | 'open' | 'closing';
  question: McqQuestion | null;
  deadline: number;             // monotonic ms
  submitted: boolean;
  selectedOption: number | null;
  answerTimeMs: number | null;
  submitting: boolean;
  error: string | null;
  result: { answered: boolean; isCorrect: boolean | null; selectedOption: number | null; answerTimeMs: number | null; correctIndex: number } | null;
}
const MCQ_IDLE: McqUi = { phase: 'idle', question: null, deadline: 0, submitted: false, selectedOption: null, answerTimeMs: null, submitting: false, error: null, result: null };

export interface RankUi { card: RankingCard; deadline: number }

export interface HostMcqUi {
  correctIndex: number | null;
  progress: McqProgress | null;
  results: HostResults | null;
  launching: boolean;
}

const asAck = (r: any): Ack => (r && typeof r === 'object' ? r : { ok: false, code: 'TIMEOUT', message: 'The server did not answer. Please try again.' });

export function useLiveRoom(code: string | undefined, user: { _id: string; name: string; role: string } | null, opts: { asAdmin?: boolean } = {}) {
  const socket = getSocket();
  const asAdmin = !!opts.asAdmin;
  const userId = user ? user._id : null;
  const [status, setStatus] = useState<RoomStatus>('loading');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [connection, setConnection] = useState<Connection>('online'); // the first connection attempt is not an "offline" state; trouble is reported by connect_error / disconnect
  const [sessionInfo, setSessionInfo] = useState<{ title: string; subject?: string; standard?: number; ownerId?: string } | null>(null);
  const [consoleUrl, setConsoleUrl] = useState<string | null>(null);
  const [self, setSelf] = useState<{ socketId: string; userId: string; isHost: boolean; isAdmin?: boolean } | null>(null);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [counts, setCounts] = useState({ students: 0, waiting: 0, hostPresent: false, locked: false });
  const [config, setConfig] = useState<MeetingConfig>(DEFAULT_CONFIG);
  const [stage, setStage] = useState<StageInfo | null>(null);
  const [permissions, setPermissions] = useState<Permissions>(NO_PERMISSIONS);
  const [peers, setPeers] = useState<PeerPlanEntry[]>([]);
  const [hostPresent, setHostPresent] = useState(false);
  const [waiting, setWaiting] = useState<WaitingEntry[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteScreens, setRemoteScreens] = useState<Record<string, MediaStream>>({});
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [scoreboard, setScoreboard] = useState<ScoreEntry[]>([]);
  const [podium, setPodium] = useState<any[]>([]);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; name: string }[]>([]);
  const [permRequest, setPermRequest] = useState<{ type: 'camera' | 'mic'; from: string; fromSocketId: string } | null>(null);

  const [isCamOn, setIsCamOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [mediaIssue, setMediaIssue] = useState<MediaIssue>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [localPortrait, setLocalPortrait] = useState(false);

  const [mcq, setMcq] = useState<McqUi>(MCQ_IDLE);
  const [rank, setRank] = useState<RankUi | null>(null);
  const [hostMcq, setHostMcq] = useState<HostMcqUi>({ correctIndex: null, progress: null, results: null, launching: false });

  const meshRef = useRef<LiveMesh | null>(null);
  const camRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const joinedOnce = useRef(false);
  const mcqSeen = useRef<Set<string>>(new Set());
  const rankTimer = useRef<number | null>(null);
  const configRef = useRef(config); configRef.current = config;
  const permsRef = useRef(permissions); permsRef.current = permissions;
  const statusRef = useRef(status); statusRef.current = status;
  const chatOpenRef = useRef(chatOpen); chatOpenRef.current = chatOpen;
  const mcqRef = useRef(mcq); mcqRef.current = mcq;
  const selfRef = useRef(self); selfRef.current = self;

  const isHost = !!self?.isHost;
  const isAdmin = !!self?.isAdmin;
  const isManager = isHost || isAdmin; // the teacher, or an administrator moderator: the server decides which, from the database
  const codeRef = useRef(code); codeRef.current = code;

  // ── mesh <-> local tracks ─────────────────────────────────────────────────────────────────────
  const pushTracks = useCallback(() => {
    const screenTrack = screenRef.current?.getVideoTracks()[0] || null;
    const camTrack = camRef.current?.getVideoTracks()[0] || null;
    const micTrack = micRef.current?.getAudioTracks()[0] || null;
    // the camera and the screen go out in separate media sections, so both stay visible to students at the same time
    meshRef.current?.setLocal(camTrack, micTrack && micTrack.enabled ? micTrack : null, screenTrack);
    setLocalStream(screenRef.current || camRef.current);
    setScreenStream(screenRef.current);
    setCamStream(camRef.current);
  }, []);

  const stopStream = (ref: React.MutableRefObject<MediaStream | null>) => { ref.current?.getTracks().forEach((t) => t.stop()); ref.current = null; };

  const releaseAll = useCallback(() => {
    stopStream(camRef); stopStream(screenRef); stopStream(micRef);
    setIsCamOn(false); setIsMicOn(false); setIsSharing(false); setLocalStream(null); setCamStream(null);
    meshRef.current?.close(); meshRef.current = null;
    setRemoteStreams({}); setRemoteScreens({}); setScreenStream(null);
  }, []);

  // ── MCQ helpers ───────────────────────────────────────────────────────────────────────────────
  const clearRankTimer = () => { if (rankTimer.current) { window.clearTimeout(rankTimer.current); rankTimer.current = null; } };
  const showRank = useCallback((card: RankingCard) => {
    clearRankTimer();
    setMcq(MCQ_IDLE);
    setRank({ card, deadline: deadlineFrom(card.remainingMs) });
    rankTimer.current = window.setTimeout(() => setRank((r) => (r && r.card.mcqId === card.mcqId ? null : r)), Math.max(0, card.remainingMs) + 120);
  }, []);
  const applyMcqState = useCallback((s: McqServerState | undefined | null, mine: boolean) => {
    if (!s) return;
    if (s.state === 'idle') { setMcq(MCQ_IDLE); return; }
    if (s.state === 'ranking') { showRank(s.ranking); return; }
    if (s.state === 'closing') { setMcq((m) => ({ ...m, phase: 'closing' })); return; }
    // open: restore a question after a refresh / reconnect (including "already answered")
    mcqSeen.current.add(s.mcq.mcqId);
    setMcq({
      phase: 'open', question: s.mcq, deadline: deadlineFrom(s.mcq.remainingMs), submitted: !!s.submitted, selectedOption: s.selectedOption ?? null,
      answerTimeMs: s.answerTimeMs ?? null, submitting: false, error: null, result: null,
    });
    if (!mine && s.progress) setHostMcq((h) => ({ ...h, correctIndex: s.correctIndex ?? h.correctIndex, progress: s.progress ?? null }));
  }, [showRank]);

  // ── joining ──────────────────────────────────────────────────────────────────────────────────
  const emitJoin = useCallback(() => { if (code) socket.emit('join-live-session', asAdmin ? { sessionCode: code, asAdmin: true } : { sessionCode: code }); }, [code, socket, asAdmin]);

  useEffect(() => {
    if (!code || !userId) return undefined;
    let alive = true;
    setStatus('loading');
    (async () => {
      try {
        // "Join Live Meeting" (admin): the admin endpoint checks the account is an administrator; no attendance is created. The SAME room is then
        // entered over the live socket, where the role is verified again.
        const res = await api.post(asAdmin ? `/admin/live-classes/${encodeURIComponent(code)}/join` : `/live-sessions/${code}/join`);
        if (!alive) return;
        const s = res.data.session || {};
        setSessionInfo({ title: s.title, subject: s.subject, standard: s.standard, ownerId: String(s.teacher?._id || s.teacher || '') });
        setMessages(res.data.chatHistory || []);
        setStatus('joining');
        emitJoin();
      } catch (err: any) {
        if (!alive) return;
        const d = err?.response?.data;
        if (d?.code === 'AUDIENCE_DENIED') { setStatusMessage(d.message || 'This class is not open to your account.'); setStatus('denied'); return; }
        if (asAdmin && d?.code === 'ENDED') { setStatusMessage(d.message || 'This class has ended.'); setStatus('ended'); return; }
        if (d?.code === 'USE_ADMIN_CONSOLE') { setConsoleUrl(d.consoleUrl || `/admin/live/${code}`); setStatus('use-console'); return; }
        setStatusMessage(d?.message || (err?.message === 'Network Error' ? 'We could not reach LearnIQ. Check your internet connection and try again.' : 'We could not open this class.'));
        setStatus('error');
      }
    })();
    return () => { alive = false; };
  }, [code, userId, emitJoin, asAdmin]); // keyed by the user's id: a new object with the same id must NOT restart the join

  // ── socket events ────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!code || !userId) return undefined;
    const on = (ev: string, fn: (...a: any[]) => void) => { socket.on(ev, fn); return () => { socket.off(ev, fn); }; };
    const offs: Array<() => void> = [];
    if (socket.connected) setConnection('online'); // 'connect' may already have fired before this effect subscribed

    offs.push(on('connect', () => {
      setConnection('online');
      if (joinedOnce.current && !['ended', 'removed', 'denied', 'replaced', 'use-console'].includes(statusRef.current)) { setStatus('joining'); emitJoin(); } // re-admit after a drop
    }));
    offs.push(on('disconnect', () => { setConnection(socket.active ? 'reconnecting' : 'offline'); }));
    offs.push(on('connect_error', () => setConnection('reconnecting')));
    offs.push(on('use-admin-console', (p: any) => { setConsoleUrl(`/admin/live/${p?.sessionCode || code}`); setStatus('use-console'); }));

    // everybody is told when an administrator moderator comes or goes (no covert participation)
    offs.push(on('moderator-joined', (p: any) => window.dispatchEvent(new CustomEvent('live-toast', { detail: { message: p?.message || 'LearnIQ Admin has joined the meeting as a moderator.' } }))));
    offs.push(on('moderator-left', (p: any) => window.dispatchEvent(new CustomEvent('live-toast', { detail: { message: `${p?.name || 'LearnIQ Admin'} (LearnIQ Admin) left the meeting.` } }))));

    offs.push(on('waiting-for-approval', (p: any) => { setHostPresent(!!p?.hostPresent); setStatus('waiting-approval'); }));
    offs.push(on('joined', (p: JoinedPayload) => {
      joinedOnce.current = true;
      setSelf(p.self); setParticipants(p.participants); setCounts(p.counts); setConfig(p.config); setStage(p.stage); setPermissions(p.permissions);
      setPeers(p.peers || []); setHostPresent(p.hostPresent); setScoreboard(p.scoreboard || []); if (p.waitingRoom) setWaiting(p.waitingRoom);
      setSessionInfo((s) => ({ ...(s || { title: p.session.title }), title: p.session.title || s?.title || '' }));
      setStatus('live');
      applyMcqState(p.mcq, p.self.isHost || !!p.self.isAdmin);
      if (!meshRef.current) {
        meshRef.current = new LiveMesh(socket as any, setRemoteStreams, undefined, undefined, setRemoteScreens);
        pushTracks();
      }
      meshRef.current.setPlan(p.peers || []);
    }));
    offs.push(on('peer-plan', (p: { peers: PeerPlanEntry[] }) => { setPeers(p.peers || []); meshRef.current?.setPlan(p.peers || []); }));
    offs.push(on('participants-update', (p: { participants: RoomParticipant[]; counts: any }) => { setParticipants(p.participants); setCounts(p.counts); }));
    offs.push(on('config-update', (p: { config: MeetingConfig; stage: StageInfo; permissions?: Permissions }) => {
      setConfig(p.config); setStage(p.stage); if (p.permissions) setPermissions(p.permissions);
    }));
    offs.push(on('permissions-update', (p: { permissions: Permissions }) => setPermissions(p.permissions)));
    offs.push(on('host-present', (p: { present: boolean }) => setHostPresent(!!p.present)));
    offs.push(on('participant-camera', (p: any) => setParticipants((l) => l.map((x) => (x.socketId === p.socketId ? { ...x, isCameraOn: p.isOn, isPortrait: typeof p.isPortrait === 'boolean' ? p.isPortrait : x.isPortrait } : x)))));
    offs.push(on('participant-mic', (p: any) => setParticipants((l) => l.map((x) => (x.socketId === p.socketId ? { ...x, isMicOn: p.isOn } : x)))));
    offs.push(on('waiting-room-update', (p: { waitingRoom: WaitingEntry[] }) => setWaiting(p.waitingRoom || [])));

    offs.push(on('join-denied', (p: any) => { setStatusMessage(p?.message || 'Your request to join was not accepted.'); setStatus(p?.code === 'REMOVED' ? 'removed' : 'denied'); }));
    offs.push(on('removed-from-session', (p: any) => { setStatusMessage(p?.message || 'You were removed from this class by the host.'); setStatus(p?.code === 'AUDIENCE_CHANGED' ? 'denied' : 'removed'); releaseAll(); }));
    offs.push(on('replaced-by-new-connection', (p: any) => { setStatusMessage(p?.message || 'You joined this class from another tab or device.'); setStatus('replaced'); releaseAll(); }));
    offs.push(on('session-ended', (p: any) => { setPodium(p?.podium || []); setStatusMessage(p?.message || 'This class has ended.'); setStatus('ended'); releaseAll(); }));
    offs.push(on('error', (p: any) => { if (statusRef.current === 'joining' || statusRef.current === 'loading') { setStatusMessage(p?.message || 'Could not join the class.'); setStatus('error'); } }));

    // media instructions from the server
    offs.push(on('force-media-off', (p: { kind: 'camera' | 'mic' | 'screen'; message?: string }) => {
      if (p.kind === 'camera') { stopStream(camRef); setIsCamOn(false); }
      if (p.kind === 'mic') { micRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; }); setIsMicOn(false); }
      if (p.kind === 'screen') { stopStream(screenRef); setIsSharing(false); }
      pushTracks();
      if (p.message) window.dispatchEvent(new CustomEvent('live-toast', { detail: { message: p.message } }));
    }));
    offs.push(on('permission-denied', (p: { message: string }) => window.dispatchEvent(new CustomEvent('live-toast', { detail: { message: p.message, error: true } }))));
    offs.push(on('permission-request', (p: any) => setPermRequest(p)));
    offs.push(on('permission-response', (p: any) => window.dispatchEvent(new CustomEvent('live-toast', { detail: { message: `${p.from || 'Student'} ${p.granted ? 'accepted' : 'declined'} your request to turn on their ${p.type === 'camera' ? 'camera' : 'microphone'}.` } }))));

    // signalling
    offs.push(on('webrtc-offer', (p: any) => meshRef.current?.handleOffer(p.fromSocketId, p.offer)));
    offs.push(on('webrtc-answer', (p: any) => meshRef.current?.handleAnswer(p.fromSocketId, p.answer)));
    offs.push(on('webrtc-ice-candidate', (p: any) => meshRef.current?.handleIce(p.fromSocketId, p.candidate)));

    // chat + reactions + scoreboard
    offs.push(on('chat-message', (m: ChatItem) => { setMessages((l) => [...l, m]); if (!chatOpenRef.current) setUnread((n) => n + 1); }));
    offs.push(on('chat-deleted', (p: { messageId: string }) => setMessages((l) => l.filter((m) => m._id !== p.messageId))));
    offs.push(on('reaction-received', (p: { emoji: string; name: string }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setReactions((l) => [...l.slice(-8), { id, emoji: p.emoji, name: p.name }]);
      window.setTimeout(() => setReactions((l) => l.filter((r) => r.id !== id)), 2800);
    }));
    offs.push(on('scoreboard-update', (p: { scoreboard: ScoreEntry[] }) => setScoreboard(p.scoreboard || [])));

    // ── MCQ ──
    offs.push(on('mcq-raised', ({ mcq: q }: { mcq: McqQuestion }) => {
      if (!q || mcqSeen.current.has(q.mcqId)) return; // duplicate event
      mcqSeen.current.add(q.mcqId);
      clearRankTimer(); setRank(null);
      setMcq({ phase: 'open', question: q, deadline: deadlineFrom(q.remainingMs), submitted: false, selectedOption: null, answerTimeMs: null, submitting: false, error: null, result: null });
      setHostMcq((h) => ({ ...h, results: null, progress: null, correctIndex: null, launching: false }));
    }));
    offs.push(on('mcq-state', (s: McqServerState) => applyMcqState(s, !!(selfRef.current?.isHost || selfRef.current?.isAdmin))));
    offs.push(on('mcq-answer-locked', (p: { mcqId: string; selectedOption: number; answerTimeMs?: number }) => {
      setMcq((m) => (m.question && m.question.mcqId === p.mcqId ? { ...m, submitted: true, submitting: false, selectedOption: p.selectedOption, answerTimeMs: p.answerTimeMs ?? m.answerTimeMs, error: null } : m));
    }));
    offs.push(on('mcq-closed', (p: { mcqId: string }) => {
      setMcq((m) => (m.question && m.question.mcqId === p.mcqId ? { ...m, phase: 'closing', submitting: false } : m));
    }));
    offs.push(on('mcq-my-result', (p: any) => {
      setMcq((m) => (m.question && m.question.mcqId === p.mcqId ? { ...m, result: { answered: p.answered, isCorrect: p.isCorrect, selectedOption: p.selectedOption, answerTimeMs: p.answerTimeMs, correctIndex: p.correctIndex } } : m));
    }));
    offs.push(on('mcq-ranking', (card: RankingCard) => { if (card) showRank(card); }));
    offs.push(on('mcq-ranking-ended', (p: { mcqId: string }) => { clearRankTimer(); setRank((r) => (r && (!p || r.card.mcqId === p.mcqId) ? null : r)); setMcq((m) => (m.phase === 'closing' ? MCQ_IDLE : m)); }));
    offs.push(on('mcq-teacher-info', (p: { correctIndex: number }) => setHostMcq((h) => ({ ...h, correctIndex: p.correctIndex }))));
    offs.push(on('mcq-progress', (p: McqProgress) => setHostMcq((h) => ({ ...h, progress: p }))));
    offs.push(on('mcq-host-results', (r: HostResults) => setHostMcq((h) => ({ ...h, results: r, launching: false }))));

    return () => { offs.forEach((f) => f()); clearRankTimer(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, userId, socket]);

  // leaving the page releases the camera / microphone / screen and the peer connections
  useEffect(() => () => {
    // navigating away from a joined class is a LEAVE (the server removes this connection; it never ends the class)
    if (joinedOnce.current && ['live'].includes(statusRef.current)) { try { socket.emit('leave-live-session', { sessionCode: codeRef.current }); } catch { /* socket gone */ } }
    releaseAll();
  }, [releaseAll, socket]);

  // ── requests (every one is acknowledged by the server) ───────────────────────────────────────
  const request = useCallback((event: string, payload: any = {}): Promise<Ack> => new Promise((resolve) => {
    let done = false;
    const timer = window.setTimeout(() => { if (!done) { done = true; resolve(asAck(null)); } }, 8000);
    socket.emit(event, { sessionCode: code, ...payload }, (r: any) => { if (done) return; done = true; window.clearTimeout(timer); resolve(asAck(r)); });
  }), [code, socket]);

  const toast = (message: string, error = false) => window.dispatchEvent(new CustomEvent('live-toast', { detail: { message, error } }));

  const portraitNow = () => { try { return window.matchMedia('(orientation: portrait)').matches; } catch { return false; } };

  const toggleCamera = useCallback(async (force?: boolean) => {
    if (isCamOn && !force) {
      stopStream(camRef); setIsCamOn(false); pushTracks();
      await request('camera-state', { isOn: false });
      return;
    }
    if (!permsRef.current.canVideo) { toast(permsRef.current.cameraBlocked ? 'The teacher has turned your camera off.' : 'The teacher has not allowed cameras for you right now.', true); return; }
    const ack = await request('camera-state', { isOn: true, isPortrait: portraitNow() });
    if (!ack.ok) { toast(ack.message || 'Your camera could not be turned on.', true); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      stopStream(camRef); camRef.current = stream; setMediaIssue(null);
      setLocalPortrait(portraitNow()); setIsCamOn(true); pushTracks();
    } catch (err: any) {
      await request('camera-state', { isOn: false });
      setMediaIssue(err?.name === 'NotFoundError' ? 'camera-missing' : 'camera-denied');
      toast(err?.name === 'NotFoundError' ? 'No camera was found on this device.' : 'Camera access is blocked. Allow it in your browser settings and try again.', true);
    }
  }, [isCamOn, pushTracks, request]);

  const toggleMic = useCallback(async (force?: boolean) => {
    if (isMicOn && !force) {
      micRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
      setIsMicOn(false); pushTracks();
      await request('mic-state', { isOn: false });
      return;
    }
    if (!permsRef.current.canAudio) { toast(permsRef.current.micBlocked ? 'The teacher has turned your microphone off.' : 'Please wait - the teacher needs to unmute you.', true); return; }
    const ack = await request('mic-state', { isOn: true });
    if (!ack.ok) { toast(ack.message || 'Your microphone could not be turned on.', true); return; }
    try {
      if (!micRef.current || !micRef.current.getAudioTracks().length) {
        micRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      }
      micRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
      setMediaIssue(null); setIsMicOn(true); pushTracks();
    } catch {
      await request('mic-state', { isOn: false });
      setMediaIssue('mic-denied');
      toast('Microphone access is blocked. Allow it in your browser settings and try again.', true);
    }
  }, [isMicOn, pushTracks, request]);

  const toggleScreen = useCallback(async () => {
    if (isSharing) {
      stopStream(screenRef); setIsSharing(false); pushTracks();
      await request('screen-state', { isSharing: false });
      return;
    }
    if (!permsRef.current.canScreen) { toast('Only the teacher can share the screen in this class.', true); return; }
    const ack = await request('screen-state', { isSharing: true });
    if (!ack.ok) { toast(ack.message || 'Screen sharing could not be started.', true); return; }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenRef.current = display; setMediaIssue(null);
      display.getVideoTracks()[0].onended = () => { screenRef.current = null; setIsSharing(false); pushTracks(); request('screen-state', { isSharing: false }); toast('Screen sharing ended'); };
      setIsSharing(true); pushTracks();
    } catch (err: any) {
      await request('screen-state', { isSharing: false });
      if (err?.name !== 'NotAllowedError') toast('Screen sharing could not be started on this device.', true);
      else setMediaIssue('screen-denied');
    }
  }, [isSharing, pushTracks, request]);

  const sendChat = useCallback(async (message: string) => {
    const text = message.trim();
    if (!text) return { ok: true } as Ack;
    const ack = await request('send-chat', { message: text });
    if (!ack.ok) toast(ack.message || 'Your message was not sent.', true);
    return ack;
  }, [request]);

  const sendReaction = useCallback((emoji: string) => { socket.emit('send-reaction', { sessionCode: code, emoji }); }, [code, socket]);

  const openChat = useCallback((open: boolean) => { setChatOpen(open); if (open) setUnread(0); }, []);

  // ── MCQ: student ────────────────────────────────────────────────────────────────────────────
  const selectOption = useCallback((i: number) => setMcq((m) => (m.phase === 'open' && !m.submitted && !m.submitting ? { ...m, selectedOption: i, error: null } : m)), []);
  const submitMcq = useCallback(async () => {
    const cur = mcqRef.current;
    if (!cur.question || cur.phase !== 'open' || cur.submitted || cur.submitting || cur.selectedOption === null) return;
    const mcqId = cur.question.mcqId; const choice = cur.selectedOption;
    setMcq((m) => ({ ...m, submitting: true, error: null }));
    const ack = await request('submit-mcq-answer', { mcqId, selectedOption: choice });
    setMcq((m) => {
      if (!m.question || m.question.mcqId !== mcqId) return m;
      if (ack.ok) return { ...m, submitted: true, submitting: false, selectedOption: ack.selectedOption ?? choice, answerTimeMs: ack.answerTimeMs ?? null, error: null }; // the popup closes only now
      const closed = ack.code === 'QUESTION_CLOSED' || ack.code === 'STALE_QUESTION';
      return { ...m, submitting: false, phase: closed ? 'closing' : m.phase, error: closed ? 'Time is up - this question is closed.' : (ack.message || 'Your answer could not be sent. Please try again.') };
    });
  }, [request]);

  // ── MCQ: host / teacher ─────────────────────────────────────────────────────────────────────
  const launchMcq = useCallback(async (input: { question: string; options: string[]; correctIndex: number }, requestId: string) => {
    setHostMcq((h) => ({ ...h, launching: true }));
    const ack = await request('raise-mcq', { ...input, requestId });
    setHostMcq((h) => ({ ...h, launching: false }));
    if (!ack.ok) toast(ack.message || 'The question could not be launched.', true);
    return ack;
  }, [request]);
  const closeMcq = useCallback(async () => { const ack = await request('close-mcq', {}); if (!ack.ok && ack.code !== 'NOT_OPEN') toast(ack.message || 'The question could not be closed.', true); return ack; }, [request]);

  // ── host controls ───────────────────────────────────────────────────────────────────────────
  const host = useMemo(() => ({
    updateConfig: async (patch: Partial<MeetingConfig>, expectedVersion?: number) => {
      const ack = await request('update-meeting-config', { patch, expectedVersion });
      if (!ack.ok) toast(ack.message || 'The settings were not changed.', true);
      return ack;
    },
    revertConfig: () => request('revert-meeting-config', {}),
    select: (userIds: string[]) => request('select-students', { userIds }),
    spotlight: (userId: string | null) => request('spotlight-participant', { userId }),
    mute: (targetSocketId: string) => request('mute-participant', { targetSocketId }),
    permission: (targetSocketId: string, p: { mic?: boolean; camera?: boolean; present?: boolean }) => request('set-participant-permission', { targetSocketId, ...p }),
    ask: (targetSocketId: string, type: 'camera' | 'mic') => request('request-permission', { targetSocketId, type }),
    remove: (targetSocketId: string, allowRejoin = false) => request('remove-participant', { targetSocketId, allowRejoin }),
    lock: (locked: boolean) => request('lock-admission', { locked }),
    approve: (targetSocketId: string) => request('approve-join', { targetSocketId }),
    deny: (targetSocketId: string) => request('deny-join', { targetSocketId }),
    end: () => request('end-session', {}),
    deleteChat: (messageId: string) => socket.emit('delete-chat', { sessionCode: code, messageId }),
  }), [request, socket, code]);

  const answerPermRequest = useCallback((granted: boolean) => {
    const r = permRequest; if (!r) return;
    socket.emit('permission-response', { sessionCode: code, type: r.type, granted });
    setPermRequest(null);
    if (granted) { if (r.type === 'camera') toggleCamera(true); else toggleMic(true); }
  }, [permRequest, socket, code, toggleCamera, toggleMic]);

  const leave = useCallback(() => {
    if (joinedOnce.current) { try { socket.emit('leave-live-session', { sessionCode: codeRef.current }); } catch { /* socket gone */ } joinedOnce.current = false; }
    releaseAll();
  }, [releaseAll, socket]);
  const retry = useCallback(() => { window.location.reload(); }, []);

  return {
    status, statusMessage, connection, sessionInfo, consoleUrl, self, isHost, isAdmin, isManager, participants, counts, config, stage, permissions, peers, hostPresent, waiting,
    remoteStreams, remoteScreens, screenStream, localStream, camStream, localPortrait, messages, unread, chatOpen, openChat, scoreboard, podium, reactions, permRequest, answerPermRequest,
    isCamOn, isMicOn, isSharing, mediaIssue, toggleCamera, toggleMic, toggleScreen, sendChat, sendReaction,
    mcq, rank, selectOption, submitMcq, hostMcq, launchMcq, closeMcq, host, leave, retry, getScoreboard: () => socket.emit('get-scoreboard', { sessionCode: code }),
  };
}
