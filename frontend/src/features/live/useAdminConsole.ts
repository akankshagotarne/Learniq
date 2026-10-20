import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from '../../services/socket';
import { deadlineFrom } from './logic';
import type { HostMcqUi, McqUi } from './useLiveRoom';
import type { Ack, AdminSnapshot, ChatItem, HostResults, McqProgress, McqServerState, MeetingConfig, RoomParticipant, StageInfo, WaitingEntry } from './types';
import { DEFAULT_CONFIG } from './types';

export type ConsoleStatus = 'connecting' | 'ready' | 'ended' | 'error' | 'not-active';

const IDLE: McqUi = { phase: 'idle', question: null, deadline: 0, submitted: false, selectedOption: null, answerTimeMs: null, submitting: false, error: null, result: null };
const asAck = (r: any): Ack => (r && typeof r === 'object' ? r : { ok: false, code: 'TIMEOUT', message: 'The server did not answer. Nothing was changed - please try again.' });

/**
 * Administrative Moderation Console connection. The admin is an invisible overseer: the server keeps the console socket out of the
 * participant list, so there is no tile, no media and no attendance entry. Every action is an acknowledged request; the screen changes
 * only when the server confirms (new roster / config / MCQ events), and each action is audited server-side.
 */
export function useAdminConsole(code: string | undefined) {
  const socket = getSocket();
  const [status, setStatus] = useState<ConsoleStatus>('connecting');
  const [message, setMessage] = useState('');
  const [online, setOnline] = useState(true);
  const [title, setTitle] = useState('');
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [waiting, setWaiting] = useState<WaitingEntry[]>([]);
  const [config, setConfig] = useState<MeetingConfig>(DEFAULT_CONFIG);
  const [stage, setStage] = useState<StageInfo | null>(null);
  const [counts, setCounts] = useState({ students: 0, waiting: 0, hostPresent: false, locked: false });
  const [consoles, setConsoles] = useState(1);
  const [stale, setStale] = useState(false);
  const [mcq, setMcq] = useState<McqUi>(IDLE);
  const [hostMcq, setHostMcq] = useState<HostMcqUi>({ correctIndex: null, progress: null, results: null, launching: false });
  const [chat, setChat] = useState<ChatItem[]>([]);
  const alive = useRef(true);

  const applySnapshot = useCallback((s: AdminSnapshot) => {
    setTitle(s.title); setParticipants(s.participants || []); setWaiting(s.waitingRoom || []); setConfig(s.config); setStage(s.stage); setCounts(s.counts); setConsoles(s.consoles || 1);
    const m: McqServerState | undefined = s.mcq;
    if (!m || m.state === 'idle' || m.state === 'ranking') {
      setMcq((cur) => (cur.phase === 'open' ? { ...IDLE } : cur.phase === 'closing' ? cur : IDLE));
    } else if (m.state === 'closing') {
      setMcq((cur) => ({ ...cur, phase: 'closing' }));
    } else {
      setMcq({ phase: 'open', question: m.mcq, deadline: deadlineFrom(m.mcq.remainingMs), submitted: false, selectedOption: null, answerTimeMs: null, submitting: false, error: null, result: null });
      setHostMcq((h) => ({ ...h, correctIndex: m.correctIndex ?? h.correctIndex, progress: m.progress ?? h.progress }));
    }
  }, []);

  const join = useCallback(() => {
    if (!code) return;
    setStatus('connecting');
    socket.emit('join-admin-console', { sessionCode: code }, (r: any) => {
      if (!alive.current) return;
      const ack = asAck(r);
      if (ack.ok) { setStale(!!ack.stale); setStatus('ready'); setMessage(''); applySnapshot(ack.snapshot); return; }
      setMessage(ack.message || 'The console could not be opened.');
      setStatus(ack.code === 'NOT_ACTIVE' ? 'not-active' : 'error');
    });
  }, [code, socket, applySnapshot]);

  useEffect(() => {
    alive.current = true;
    if (!code) return undefined;
    const offs: Array<() => void> = [];
    const on = (ev: string, fn: (...a: any[]) => void) => { socket.on(ev, fn); offs.push(() => socket.off(ev, fn)); };
    on('connect', () => { setOnline(true); join(); }); // after a reconnect the console is re-opened and the snapshot refreshed
    on('disconnect', () => setOnline(false));
    on('admin-roster', (s: AdminSnapshot) => { applySnapshot(s); setStale(false); });
    on('config-update', (p: { config: MeetingConfig; stage: StageInfo }) => { setConfig(p.config); setStage(p.stage); });
    on('waiting-room-update', (p: { waitingRoom: WaitingEntry[] }) => setWaiting(p.waitingRoom || []));
    on('participant-camera', (p: any) => setParticipants((l) => l.map((x) => (x.socketId === p.socketId ? { ...x, isCameraOn: p.isOn } : x))));
    on('participant-mic', (p: any) => setParticipants((l) => l.map((x) => (x.socketId === p.socketId ? { ...x, isMicOn: p.isOn } : x))));
    on('chat-message', (m: ChatItem) => setChat((l) => [...l.slice(-199), m]));
    on('chat-deleted', (p: { messageId: string }) => setChat((l) => l.filter((m) => m._id !== p.messageId)));
    on('session-ended', (p: any) => { setMessage(p?.message || 'The class has ended.'); setStatus('ended'); });
    on('mcq-raised', ({ mcq: q }: any) => { setMcq({ phase: 'open', question: q, deadline: deadlineFrom(q.remainingMs), submitted: false, selectedOption: null, answerTimeMs: null, submitting: false, error: null, result: null }); setHostMcq((h) => ({ ...h, results: null, progress: null, correctIndex: null, launching: false })); });
    on('mcq-closed', (p: { mcqId: string }) => setMcq((m) => (m.question && m.question.mcqId === p.mcqId ? { ...m, phase: 'closing' } : m)));
    on('mcq-ranking-ended', () => setMcq((m) => (m.phase === 'closing' ? IDLE : m)));
    on('mcq-teacher-info', (p: { correctIndex: number }) => setHostMcq((h) => ({ ...h, correctIndex: p.correctIndex })));
    on('mcq-progress', (p: McqProgress) => setHostMcq((h) => ({ ...h, progress: p })));
    on('mcq-host-results', (r: HostResults) => setHostMcq((h) => ({ ...h, results: r, launching: false })));
    if (socket.connected) { setOnline(true); join(); } else socket.connect();
    return () => { alive.current = false; offs.forEach((f) => f()); try { socket.emit('leave-admin-console'); } catch { /* ignore */ } };
  }, [code, socket, join, applySnapshot]);

  const act = useCallback((action: string, payload: any = {}): Promise<Ack> => new Promise((resolve) => {
    let done = false;
    const timer = window.setTimeout(() => { if (!done) { done = true; resolve(asAck(null)); } }, 8000);
    socket.emit('admin-action', { action, sessionCode: code, ...payload }, (r: any) => { if (done) return; done = true; window.clearTimeout(timer); resolve(asAck(r)); });
  }), [code, socket]);

  const refresh = useCallback(async () => {
    const r: Ack = await new Promise((resolve) => socket.emit('admin-refresh', { sessionCode: code }, (x: any) => resolve(asAck(x))));
    if (r.ok) { applySnapshot(r.snapshot); setStale(false); }
    return r;
  }, [code, socket, applySnapshot]);

  const manager = useMemo(() => ({
    mute: (targetSocketId: string) => act('mute', { targetSocketId }),
    permission: (targetSocketId: string, p: { mic?: boolean; camera?: boolean; present?: boolean }) => act('permissions', { targetSocketId, ...p }),
    remove: (targetSocketId: string, allowRejoin = false) => act('remove', { targetSocketId, allowRejoin }),
    spotlight: (userId: string | null) => act('spotlight', { userId }),
    select: (userIds: string[]) => act('select', { userIds }),
    lock: (locked: boolean) => act('lock', { locked }),
    approve: (targetSocketId: string) => act('approve', { targetSocketId }),
    deny: (targetSocketId: string) => act('deny', { targetSocketId }),
  }), [act]);

  const launchMcq = useCallback(async (input: { question: string; options: string[]; correctIndex: number }, requestId: string) => {
    setHostMcq((h) => ({ ...h, launching: true }));
    const r = await act('mcq-launch', { ...input, requestId });
    setHostMcq((h) => ({ ...h, launching: false }));
    return r;
  }, [act]);
  const closeMcq = useCallback(() => act('mcq-close', {}), [act]);

  return {
    status, message, online, title, participants, waiting, config, stage, counts, consoles, stale, chat, mcq, hostMcq, setMcq,
    manager,
    updateConfig: (patch: Partial<MeetingConfig>, expectedVersion?: number) => act('set-config', { patch, expectedVersion }),
    revertConfig: () => act('revert-config', {}),
    allowRejoin: (userId: string) => act('allow-rejoin', { userId }),
    endMeeting: () => act('end', {}),
    launchMcq, closeMcq, refresh, retry: join,
  };
}
